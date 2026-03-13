<?php
/**
 * Personal Vault — Exchange Rate Helper
 * Shared logic for once-per-day forex rate refresh.
 */
class ExchangeRates {

    /**
     * Check whether rates need refreshing (last update before today UTC, or never).
     */
    public static function needsRefresh(PDO $db): bool {
        $stmt = $db->query("SELECT MAX(last_updated) AS last FROM currencies");
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $last = $row['last'] ?? null;

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
    public static function refresh(PDO $db): array {
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

        $stmt = $db->query("SELECT id, code FROM currencies");
        $currencies = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $updateStmt = $db->prepare("UPDATE currencies SET exchange_rate_to_base = ?, last_updated = NOW() WHERE id = ?");

        // History insert — degrades gracefully if migration hasn't run
        $historyStmt = null;
        try {
            $historyStmt = $db->prepare(
                "INSERT INTO currency_rate_history (currency_id, rate_to_base, base_currency, recorded_at)
                 VALUES (?, ?, ?, CURDATE())
                 ON DUPLICATE KEY UPDATE rate_to_base = VALUES(rate_to_base), base_currency = VALUES(base_currency)"
            );
        } catch (Exception $e) {
            // Table may not exist yet
        }

        foreach ($currencies as $currency) {
            $code = $currency['code'];
            if (isset($rates[$code])) {
                $rateToBase = 1 / $rates[$code];
                $updateStmt->execute([$rateToBase, $currency['id']]);
                if ($historyStmt) {
                    try {
                        $historyStmt->execute([$currency['id'], $rateToBase, $baseCurrency]);
                    } catch (Exception $e) {
                        // History table may not exist — skip silently
                        $historyStmt = null;
                    }
                }
                $updatedCount++;
            }
        }

        return ['updated' => $updatedCount, 'skipped' => false];
    }

    /**
     * Refresh only if rates are stale (not yet updated today).
     */
    public static function refreshIfStale(PDO $db): array {
        if (!self::needsRefresh($db)) {
            return ['updated' => 0, 'skipped' => true, 'reason' => 'already_fresh'];
        }
        return self::refresh($db);
    }
}
