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
require_once __DIR__ . '/../core/Storage.php';
require_once __DIR__ . '/../core/TickerPrices.php';
require_once __DIR__ . '/../core/ExchangeRates.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;

$storage = Storage::adapter();

// ============================================================================
// POST ?action=refresh — Unified market data refresh
// ============================================================================
if ($method === 'POST' && $action === 'refresh') {
    $body = Response::getBody();
    $type = $body['type'] ?? 'all';
    $force = !empty($body['force']);

    if (!in_array($type, ['all', 'forex', 'ticker'], true)) {
        Response::error('Invalid type. Must be: all, forex, or ticker.', 400);
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
            $tickers = array_slice(array_unique(array_map('trim', $tickers)), 0, 50);
            $tickers = array_filter($tickers, fn($t) => preg_match('/^[A-Za-z0-9.\-^=]+$/', $t));

            if (empty($tickers)) {
                Response::error('No valid tickers provided.', 400);
            }

            $ttl = (int)($storage->getSystemSetting('ticker_price_ttl') ?? 86400);
            $cached = $storage->getCachedPrices(array_values($tickers), $ttl);

            $results = [];
            $cachedTickers = [];
            foreach ($cached as $row) {
                $results[$row['ticker']] = [
                    'price'    => (float)$row['price'],
                    'currency' => $row['currency'],
                    'exchange' => $row['exchange'],
                    'name'     => $row['name'],
                    'cached'   => true,
                ];
                $cachedTickers[] = $row['ticker'];
            }

            $staleTickers = array_values(array_diff($tickers, $cachedTickers));
            $errors = [];

            if (!empty($staleTickers)) {
                $fetched = TickerPrices::fetch($staleTickers);
                foreach ($fetched['results'] as $ticker => $data) {
                    $results[$ticker] = $data + ['cached' => false];
                }
                $errors = $fetched['errors'];
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

    Response::success($response);
}

// ============================================================================
// GET cache — Admin: view cached ticker prices
// ============================================================================
if ($method === 'GET' && $action === 'cache') {
    if (!$isSiteAdmin) Response::error('Admin access required.', 403);

    Response::success($storage->getAllCachedPrices());
}

// ============================================================================
// DELETE cache — Admin: clear price cache
// ============================================================================
if ($method === 'DELETE' && $action === 'cache') {
    if (!$isSiteAdmin) Response::error('Admin access required.', 403);

    $storage->clearPriceCache();
    Response::success(['cleared' => true]);
}

Response::error('Method not allowed.', 405);
