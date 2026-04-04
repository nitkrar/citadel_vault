<?php
/**
 * Personal Vault — Exchange Rate Helper
 * Shared logic for once-per-day forex rate refresh.
 */
require_once __DIR__ . '/Storage.php';

class ExchangeRates {

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
        if (!self::needsRefresh()) {
            return ['updated' => 0, 'skipped' => true, 'reason' => 'already_fresh'];
        }
        return self::refresh();
    }
}
