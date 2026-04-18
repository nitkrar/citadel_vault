<?php
/**
 * Personal Vault — Exchange Rate Helper
 * Shared logic for once-per-day forex rate refresh.
 */
require_once __DIR__ . '/Storage.php';

class ExchangeRates {
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
     * Check whether rates need refreshing (last update before today UTC, or never).
     */
    public static function needsRefresh(): bool {
        $last = Storage::adapter()->getLastCurrencyUpdate();

        if ($last === null) {
            return true;
        }

        $lastDate = (new DateTimeImmutable($last, new DateTimeZone('UTC')))->format('Y-m-d');
        $today = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d');

        return $lastDate < $today;
    }

    /**
     * Fetch latest rates from ExchangeRate API and update all matching currencies.
     * Returns ['updated' => count, 'skipped' => false].
     */
    public static function refresh(): array {
        $apiKey = EXCHANGE_RATE_API_KEY;
        if (empty($apiKey)) {
            return ['updated' => 0, 'skipped' => true, 'reason' => 'no_api_key'];
        }

        $baseCurrency = BASE_CURRENCY;
        $url = "https://v6.exchangerate-api.com/v6/{$apiKey}/latest/{$baseCurrency}";

        $context = stream_context_create(['http' => ['timeout' => 15, 'ignore_errors' => true]]);
        $response = @file_get_contents($url, false, $context);

        if ($response === false) {
            return ['updated' => 0, 'skipped' => true, 'reason' => 'api_unreachable'];
        }

        $data = json_decode($response, true);
        if (!$data || ($data['result'] ?? '') !== 'success' || !isset($data['conversion_rates'])) {
            return ['updated' => 0, 'skipped' => true, 'reason' => $data['error-type'] ?? 'unknown'];
        }

        $rates = $data['conversion_rates'];
        $updatedCount = 0;
        $storage = Storage::adapter();

        $currencies = $storage->getAllCurrenciesForUpdate();

        foreach ($currencies as $currency) {
            $code = $currency['code'];
            if (isset($rates[$code])) {
                $rateToBase = 1 / $rates[$code];
                $storage->updateExchangeRate($currency['id'], $rateToBase);
                try {
                    $storage->addCurrencyRateHistory($currency['id'], $rateToBase, $baseCurrency);
                } catch (Exception $e) {
                    // History table may not exist — skip silently
                }
                $updatedCount++;
            }
        }

        return ['updated' => $updatedCount, 'skipped' => false];
    }

    /**
     * Refresh only if rates are stale (not yet updated today).
     */
    public static function refreshIfStale(): array {
        return self::withRefreshLock(function (): array {
            if (!self::needsRefresh()) {
                return ['updated' => 0, 'skipped' => true, 'reason' => 'already_fresh'];
            }
            return self::refresh();
        });
    }
}
