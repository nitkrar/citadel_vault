<?php
/**
 * Personal Vault — Ticker Price Helper
 * Shared logic for refreshing cached stock/crypto prices via Yahoo Finance.
 * Parallel fetching via curl_multi, with sequential file_get_contents fallback.
 */
require_once __DIR__ . '/Storage.php';

class TickerPrices {
    private const TICKER_ALIASES = [
        'BRK.B' => 'BRK-B', 'BRKB' => 'BRK-B',
        'BF.B'  => 'BF-B',  'BFB'  => 'BF-B',
        'FB'    => 'META',
        'TWTR'  => 'X',
        'HCN'   => 'WELL',
    ];

    public static function normalize(string $ticker): string {
        $normalized = strtoupper(trim($ticker));
        return self::TICKER_ALIASES[$normalized] ?? $normalized;
    }

    private static function lockConnection(): ?PDO {
        static $pdo = null;
        static $connectFailed = false;

        if ($pdo instanceof PDO) {
            return $pdo;
        }

        if ($connectFailed || (defined('STORAGE_ADAPTER') && STORAGE_ADAPTER !== 'mariadb')) {
            return null;
        }

        try {
            $pdo = new PDO(
                sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME),
                DB_USER,
                DB_PASS,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]
            );
            return $pdo;
        } catch (Throwable $e) {
            $connectFailed = true;
            return null;
        }
    }

    private static function withRefreshLock(callable $callback): array {
        $pdo = self::lockConnection();
        if (!$pdo) {
            return $callback();
        }

        $lockAcquired = false;

        try {
            $lockAcquired = (int)$pdo->query("SELECT GET_LOCK('citadel_market_refresh', 0)")->fetchColumn() === 1;
            if (!$lockAcquired) {
                return ['updated' => 0, 'skipped' => true, 'reason' => 'concurrent_refresh_in_progress'];
            }
        } catch (Throwable $e) {
            return $callback();
        }

        try {
            return $callback();
        } finally {
            if ($lockAcquired) {
                try {
                    $pdo->query("DO RELEASE_LOCK('citadel_market_refresh')");
                } catch (Throwable $e) {
                    // Best-effort unlock.
                }
            }
        }
    }

    /**
     * Parse Yahoo Finance v8 chart API response.
     * @return array{price:float,currency:string,exchange:string,name:string,after_hours:bool}|string — result or error string
     */
    public static function parseResponse(string $ticker, string $body): array|string {
        $data = json_decode($body, true);
        $meta = $data['chart']['result'][0]['meta'] ?? null;

        if (!$meta || !isset($meta['regularMarketPrice'])) {
            return 'Ticker not found';
        }

        $regular = $meta['regularMarketPrice'] ?? null;
        $post = $meta['postMarketPrice'] ?? null;
        $marketState = $meta['marketState'] ?? '';
        $postTime = $meta['postMarketTime'] ?? 0;
        $regularTime = $meta['regularMarketTime'] ?? 0;

        // After-hours preference is opt-in via system setting (default off).
        // Citadel uses a once-per-day refresh model, so extended-hours quotes
        // are relevant only when the admin explicitly enables them.
        $preferAfterHours = false;
        try {
            $setting = Storage::adapter()->getSystemSetting('prefer_after_hours');
            $preferAfterHours = ($setting === 'true' || $setting === '1');
        } catch (Throwable $e) {
            // Setting not present (pre-migration) → stay off.
        }

        $useAfterHours = $preferAfterHours
            && $post !== null
            && in_array($marketState, ['POST', 'CLOSED'], true)
            && $postTime > $regularTime
            && abs($post - $regular) / max($regular, 0.01) < 0.30;
        $price = $useAfterHours ? $post : $regular;
        $currency = $meta['currency'] ?? 'USD';
        $exchange = $meta['fullExchangeName'] ?? $meta['exchangeName'] ?? '';
        $name = $meta['longName'] ?? $meta['shortName'] ?? $ticker;

        // Normalize GBp (pence) to GBP
        if ($currency === 'GBp') {
            $price = $price / 100;
            $currency = 'GBP';
        }

        return [
            'price'       => (float)$price,
            'currency'    => $currency,
            'exchange'    => $exchange,
            'name'        => $name,
            'after_hours' => $useAfterHours,
        ];
    }

    /**
     * Fetch prices for a list of tickers from Yahoo Finance.
     * Uses curl_multi for parallel requests, falls back to sequential file_get_contents.
     *
     * @param string[] $tickers — ticker symbols to fetch
     * @return array{results: array, errors: array}
     */
    public static function fetch(array $tickers): array {
        $tickers = array_values(array_unique(array_map([self::class, 'normalize'], $tickers)));
        $results = [];
        $errors = [];
        $storage = Storage::adapter();

        if (function_exists('curl_multi_init')) {
            $mh = curl_multi_init();
            $handles = [];

            foreach ($tickers as $ticker) {
                $url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
                     . urlencode($ticker) . '?interval=1d&range=1d';
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT        => 10,
                    CURLOPT_USERAGENT      => 'Mozilla/5.0',
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_SSL_VERIFYPEER => true,
                ]);
                curl_multi_add_handle($mh, $ch);
                $handles[$ticker] = $ch;
            }

            do {
                $status = curl_multi_exec($mh, $active);
                if ($active) {
                    curl_multi_select($mh);
                }
            } while ($active && $status === CURLM_OK);

            foreach ($handles as $ticker => $ch) {
                $response = curl_errno($ch) ? false : curl_multi_getcontent($ch);
                curl_multi_remove_handle($mh, $ch);

                if ($response === false) {
                    $errors[$ticker] = 'Price service temporarily unavailable';
                    continue;
                }

                $parsed = self::parseResponse($ticker, $response);
                if (is_string($parsed)) {
                    $errors[$ticker] = $parsed;
                    continue;
                }

                $storage->upsertPrice($ticker, $parsed['exchange'], $parsed['price'], $parsed['currency'], $parsed['name']);
                $storage->addPriceHistory($ticker, $parsed['exchange'], $parsed['price'], $parsed['currency']);
                $results[$ticker] = $parsed;
            }

            curl_multi_close($mh);
        } else {
            foreach ($tickers as $ticker) {
                $url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
                     . urlencode($ticker) . '?interval=1d&range=1d';
                $ctx = stream_context_create([
                    'http' => [
                        'method'  => 'GET',
                        'header'  => "User-Agent: Mozilla/5.0\r\n",
                        'timeout' => 10,
                    ],
                ]);
                $response = @file_get_contents($url, false, $ctx);

                if ($response === false) {
                    $errors[$ticker] = 'Price service temporarily unavailable';
                    continue;
                }

                $parsed = self::parseResponse($ticker, $response);
                if (is_string($parsed)) {
                    $errors[$ticker] = $parsed;
                    continue;
                }

                $storage->upsertPrice($ticker, $parsed['exchange'], $parsed['price'], $parsed['currency'], $parsed['name']);
                $storage->addPriceHistory($ticker, $parsed['exchange'], $parsed['price'], $parsed['currency']);
                $results[$ticker] = $parsed;
            }
        }

        return ['results' => $results, 'errors' => $errors];
    }

    /**
     * Refresh cached tickers whose fetched_at is older than TTL.
     * No ticker list needed — uses what's already in the cache.
     */
    public static function refreshIfStale(): array {
        return self::withRefreshLock(function (): array {
            $storage = Storage::adapter();
            $ttl = (int)($storage->getSystemSetting('ticker_price_ttl') ?? 86400);
            $stale = $storage->getStaleTickers($ttl);

            if (empty($stale)) {
                return ['updated' => 0, 'skipped' => true, 'reason' => 'already_fresh'];
            }

            $result = self::fetch($stale);
            return ['updated' => count($result['results']), 'skipped' => false, 'errors' => $result['errors']];
        });
    }

    /**
     * Force-refresh all cached tickers regardless of staleness.
     */
    public static function refreshAll(): array {
        $storage = Storage::adapter();
        $all = $storage->getAllCachedPrices();
        $tickers = array_column($all, 'ticker');

        if (empty($tickers)) {
            return ['updated' => 0, 'skipped' => true, 'reason' => 'no_cached_tickers'];
        }

        $result = self::fetch($tickers);
        return ['updated' => count($result['results']), 'skipped' => false, 'errors' => $result['errors']];
    }
}
