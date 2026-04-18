<?php
/**
 * Prices API — Unified market data refresh and ticker price management.
 *
 * POST /prices.php?action=refresh — Refresh market data
 *   body.type = "all"     — refresh forex + all stale tickers (default)
 *   body.type = "forex"   — refresh exchange rates only
 *   body.type = "ticker"  — refresh tickers only
 *     body.tickers = [...]  — optional: specific tickers (cache-aware, fetches stale/missing)
 *                             omit for all stale cached tickers
 *
 * GET  /prices.php?action=cache — Admin: view cached prices
 * DELETE /prices.php?action=cache — Admin: clear price cache
 */

require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';
require_once __DIR__ . '/../core/Storage.php';
require_once __DIR__ . '/../core/TickerPrices.php';
require_once __DIR__ . '/../core/ExchangeRates.php';

function marketRefreshPdo(): ?PDO {
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

function marketRefreshStateTableExists(): bool {
    static $exists = null;

    if ($exists !== null) {
        return $exists;
    }

    $pdo = marketRefreshPdo();
    if (!$pdo) {
        $exists = false;
        return false;
    }

    try {
        $stmt = $pdo->prepare(
            "SELECT 1
               FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'market_refresh_state'
              LIMIT 1"
        );
        $stmt->execute();
        $exists = (bool)$stmt->fetchColumn();
    } catch (Throwable $e) {
        $exists = false;
    }

    return $exists;
}

function marketRefreshRecentlyAttempted(int $windowSeconds = 60): bool {
    if (!marketRefreshStateTableExists()) {
        return false;
    }

    $pdo = marketRefreshPdo();
    if (!$pdo) {
        return false;
    }

    try {
        $stmt = $pdo->prepare(
            "SELECT last_refresh_attempt
               FROM market_refresh_state
              WHERE state_key = 'global'
              LIMIT 1"
        );
        $stmt->execute();
        $lastAttempt = $stmt->fetchColumn();

        if (!$lastAttempt) {
            return false;
        }

        return strtotime((string)$lastAttempt) >= (time() - $windowSeconds);
    } catch (Throwable $e) {
        return false;
    }
}

function recordMarketRefreshAttempt(): void {
    if (!marketRefreshStateTableExists()) {
        return;
    }

    $pdo = marketRefreshPdo();
    if (!$pdo) {
        return;
    }

    try {
        $stmt = $pdo->prepare(
            "INSERT INTO market_refresh_state (state_key, last_refresh_attempt)
             VALUES ('global', NOW())
             ON DUPLICATE KEY UPDATE last_refresh_attempt = VALUES(last_refresh_attempt)"
        );
        $stmt->execute();
    } catch (Throwable $e) {
        // Migration may not be deployed yet — fail open.
    }
}

function recentRefreshResponse(string $type): array {
    $segment = ['updated' => 0, 'skipped' => true, 'reason' => 'recent_refresh'];

    return match ($type) {
        'forex' => ['forex' => $segment],
        'ticker' => ['ticker' => $segment],
        default => ['forex' => $segment, 'ticker' => $segment],
    };
}

function cronRefreshSummaryFromResponse(array $response): string {
    foreach (['forex', 'ticker'] as $segment) {
        if (!isset($response[$segment]) || !is_array($response[$segment])) {
            continue;
        }

        if (($response[$segment]['reason'] ?? null) === 'recent_refresh') {
            return 'recent_refresh';
        }

        if (($response[$segment]['reason'] ?? null) === 'concurrent_refresh_in_progress') {
            return 'concurrent_refresh_in_progress';
        }
    }

    return 'success';
}

function logCronRefreshAudit(string $summary): void {
    $pdo = marketRefreshPdo();
    if (!$pdo) {
        return;
    }

    try {
        $stmt = $pdo->prepare(
            'INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip_hash)
             VALUES (NULL, ?, ?, NULL, ?)'
        );
        $stmt->execute(['cron_refresh', substr($summary, 0, 100), Auth::clientIpHash()]);
    } catch (Throwable $e) {
        // Audit log is best-effort.
    }
}

function nullableFloat(mixed $value): ?float {
    return is_numeric($value) ? (float)$value : null;
}

function percentChange(float $price, ?float $baseline): ?float {
    if ($baseline === null || abs($baseline) < 0.00000001) {
        return null;
    }

    return (($price - $baseline) / $baseline) * 100;
}

function findPreviousCloseFromHistory($storage, string $ticker): ?float {
    for ($daysAgo = 1; $daysAgo <= 4; $daysAgo++) {
        $row = $storage->getPriceHistoryNear($ticker, $daysAgo, 0);
        if ($row && is_numeric($row['price'] ?? null)) {
            return (float)$row['price'];
        }
    }

    return null;
}

function enrichTickerPriceRow($storage, string $ticker, array $row): array {
    $price = (float)$row['price'];
    $previousClose = nullableFloat($row['previous_close'] ?? null);

    if ($previousClose === null) {
        $previousClose = findPreviousCloseFromHistory($storage, $ticker);
    }

    $weekHistory = $storage->getPriceHistoryNear($ticker, 7, 3);
    $weekBaseline = nullableFloat($weekHistory['price'] ?? null);

    $row['previous_close'] = $previousClose;
    $row['change_1d_pct'] = percentChange($price, $previousClose);
    $row['change_1w_pct'] = percentChange($price, $weekBaseline);
    $row['after_hours'] = !empty($row['after_hours']);

    return $row;
}

Response::setCors();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$body = ($method === 'POST' && $action === 'refresh') ? Response::getBody() : [];
$expectedCronToken = (string)env('CRON_TOKEN', '');
$cronToken = (string)($_SERVER['HTTP_X_CRON_TOKEN'] ?? '');
$hasTickerList = is_array($body['tickers'] ?? null) && !empty($body['tickers']);
$isCronRefreshRequest = $action === 'refresh'
    && $expectedCronToken !== ''
    && hash_equals($expectedCronToken, $cronToken)
    && !$hasTickerList;

$userId = null;
$isSiteAdmin = false;

if ($isCronRefreshRequest) {
    $storage = Storage::adapter();
} else {
    $payload = Auth::requireAuth();
    $userId = Auth::userId($payload);
    $isSiteAdmin = $payload['role'] === 'admin';
    $storage = Storage::adapter();
}

// ============================================================================
// POST ?action=refresh — Unified market data refresh
// ============================================================================
if ($method === 'POST' && $action === 'refresh') {
    $type = $body['type'] ?? 'all';
    $force = !empty($body['force']);

    if (!in_array($type, ['all', 'forex', 'ticker'], true)) {
        if ($isCronRefreshRequest) {
            logCronRefreshAudit('invalid_type');
        }
        Response::error('Invalid type. Must be: all, forex, or ticker.', 400);
    }

    $rateLimitKey = Auth::enforceIpRateLimit('market_refresh', 20, 3600);
    Auth::recordRateLimit('market_refresh', $rateLimitKey);

    if (!$force && !$hasTickerList && marketRefreshRecentlyAttempted()) {
        recordMarketRefreshAttempt();
        $response = recentRefreshResponse($type);
        if ($isCronRefreshRequest) {
            logCronRefreshAudit(cronRefreshSummaryFromResponse($response));
        }
        Response::success($response);
    }

    $response = [];

    // ── Forex refresh ──
    if ($type === 'all' || $type === 'forex') {
        try {
            $response['forex'] = $force ? ExchangeRates::refresh() : ExchangeRates::refreshIfStale();
        } catch (Exception $e) {
            $response['forex'] = ['updated' => 0, 'skipped' => true, 'reason' => $e->getMessage()];
        }
    }

    // ── Ticker refresh ──
    if ($type === 'all' || $type === 'ticker') {
        $tickers = $body['tickers'] ?? null;

        if (is_array($tickers) && !empty($tickers)) {
            // Specific tickers requested — cache-aware fetch (stale/missing only)
            $tickers = array_values(array_slice(array_unique(array_map('trim', $tickers)), 0, 50));
            $tickers = array_values(array_filter($tickers, fn($t) => preg_match('/^[A-Za-z0-9.\-^=]+$/', $t)));

            if (empty($tickers)) {
                if ($isCronRefreshRequest) {
                    logCronRefreshAudit('no_valid_tickers');
                }
                Response::error('No valid tickers provided.', 400);
            }

            $requestedToCanonical = [];
            $canonicalTickers = [];
            foreach ($tickers as $requestedTicker) {
                $canonicalTicker = TickerPrices::normalize($requestedTicker);
                $requestedToCanonical[$requestedTicker] = $canonicalTicker;
                $canonicalTickers[$canonicalTicker] = true;
            }

            $ttl = (int)($storage->getSystemSetting('ticker_price_ttl') ?? 86400);
            $cached = $storage->getCachedPrices(array_keys($canonicalTickers), $ttl);

            $canonicalResults = [];
            $cachedTickers = [];
            foreach ($cached as $row) {
                $canonicalResults[$row['ticker']] = enrichTickerPriceRow($storage, $row['ticker'], [
                    'price'            => (float)$row['price'],
                    'currency'         => $row['currency'],
                    'exchange'         => $row['exchange'],
                    'name'             => $row['name'],
                    'previous_close'   => $row['previous_close'] ?? null,
                    'after_hours'      => $row['after_hours'] ?? false,
                    'cached'           => true,
                    'canonical_ticker' => $row['ticker'],
                ]);
                $cachedTickers[] = $row['ticker'];
            }

            $staleTickers = array_values(array_diff(array_keys($canonicalTickers), $cachedTickers));
            $canonicalErrors = [];

            if (!empty($staleTickers)) {
                $fetched = TickerPrices::fetch($staleTickers);
                foreach ($fetched['results'] as $ticker => $data) {
                    $canonicalResults[$ticker] = enrichTickerPriceRow($storage, $ticker, $data + [
                        'cached' => false,
                        'canonical_ticker' => $ticker,
                    ]);
                }
                $canonicalErrors = $fetched['errors'];
            }

            $results = [];
            $errors = [];
            foreach ($requestedToCanonical as $requestedTicker => $canonicalTicker) {
                if (isset($canonicalResults[$canonicalTicker])) {
                    $results[$requestedTicker] = $canonicalResults[$canonicalTicker];
                    continue;
                }

                if (isset($canonicalErrors[$canonicalTicker])) {
                    $errors[$requestedTicker] = $canonicalErrors[$canonicalTicker];
                }
            }

            $response['ticker'] = [
                'prices'     => $results,
                'errors'     => $errors,
                'fetched_at' => date('c'),
            ];
        } else {
            // No tickers specified — refresh all cached tickers (force) or stale only
            try {
                $response['ticker'] = $force ? TickerPrices::refreshAll() : TickerPrices::refreshIfStale();
            } catch (Exception $e) {
                $response['ticker'] = ['updated' => 0, 'skipped' => true, 'reason' => $e->getMessage()];
            }
        }
    }

    if (!$hasTickerList) {
        recordMarketRefreshAttempt();
    }
    if ($isCronRefreshRequest) {
        logCronRefreshAudit(cronRefreshSummaryFromResponse($response));
    }
    Response::success($response);
}

// ============================================================================
// GET cache — Admin: view cached ticker prices
// ============================================================================
if ($method === 'GET' && $action === 'cache') {
    if (!$isSiteAdmin) {
        Response::error('Admin access required.', 403);
    }

    Response::success($storage->getAllCachedPrices());
}

// ============================================================================
// DELETE cache — Admin: clear price cache
// ============================================================================
if ($method === 'DELETE' && $action === 'cache') {
    if (!$isSiteAdmin) {
        Response::error('Admin access required.', 403);
    }

    $storage->clearPriceCache();
    Response::success(['cleared' => true]);
}

if ($action === 'refresh' && $isCronRefreshRequest) {
    logCronRefreshAudit('method_not_allowed');
}

Response::error('Method not allowed.', 405);
