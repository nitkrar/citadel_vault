<?php
/**
 * Personal Vault — Ticker Price Helper
 * Shared logic for refreshing cached stock/crypto prices via Yahoo Finance.
 * Parallel fetching via curl_multi, with sequential file_get_contents fallback.
 */
require_once __DIR__ . '/Storage.php';

class TickerPrices {

    /**
     * Parse Yahoo Finance v8 chart API response.
     * @return array{price:float,currency:string,exchange:string,name:string}|string — result or error string
     */
    public static function parseResponse(string $ticker, string $body): array|string {
        $data = json_decode($body, true);
        $meta = $data['chart']['result'][0]['meta'] ?? null;

        if (!$meta || !isset($meta['regularMarketPrice'])) {
            return 'Ticker not found';
        }

        $price = $meta['regularMarketPrice'];
        $currency = $meta['currency'] ?? 'USD';
        $exchange = $meta['fullExchangeName'] ?? $meta['exchangeName'] ?? '';
        $name = $meta['longName'] ?? $meta['shortName'] ?? $ticker;

        // Normalize GBp (pence) to GBP
        if ($currency === 'GBp') {
            $price = $price / 100;
            $currency = 'GBP';
        }

        return [
            'price'    => (float)$price,
            'currency' => $currency,
            'exchange' => $exchange,
            'name'     => $name,
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
                if ($active) curl_multi_select($mh);
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
        $storage = Storage::adapter();
        $ttl = (int)($storage->getSystemSetting('ticker_price_ttl') ?? 86400);
        $stale = $storage->getStaleTickers($ttl);

        if (empty($stale)) {
            return ['updated' => 0, 'skipped' => true, 'reason' => 'already_fresh'];
        }

        $result = self::fetch($stale);
        return ['updated' => count($result['results']), 'skipped' => false, 'errors' => $result['errors']];
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
