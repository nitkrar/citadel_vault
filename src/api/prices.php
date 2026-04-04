<?php
/**
 * Prices API — Fetch, cache, and serve stock/crypto prices from Yahoo Finance.
 *
 * POST /prices.php           — Fetch prices for given tickers (batch)
 * GET  /prices.php?action=cache — Admin: view cached prices
 * DELETE /prices.php?action=cache — Admin: clear price cache
 */

require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;

$storage = Storage::adapter();

// ============================================================================
// POST — Fetch prices for tickers
// ============================================================================
if ($method === 'POST' && !$action) {
    $body = Response::getBody();
    $tickers = $body['tickers'] ?? [];

    if (!is_array($tickers) || empty($tickers)) {
        Response::error('tickers array is required.', 400);
    }

    // Sanitize + limit
    $tickers = array_slice(array_unique(array_map('trim', $tickers)), 0, 50);
    $tickers = array_filter($tickers, fn($t) => preg_match('/^[A-Za-z0-9.\-^=]+$/', $t));

    if (empty($tickers)) {
        Response::error('No valid tickers provided.', 400);
    }

    // Get TTL from system settings
    $ttl = (int)($storage->getSystemSetting('ticker_price_ttl') ?? 86400);

    // Check cache
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

    // Fetch stale/missing from Yahoo
    $staleTickers = array_diff($tickers, $cachedTickers);
    $errors = [];

    if (!empty($staleTickers)) {
        foreach ($staleTickers as $ticker) {
            // Use v8 chart API (v7 quote API now requires auth)
            $url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
                 . urlencode($ticker) . '?interval=1d&range=1d';

            $response = false;
            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_TIMEOUT        => 10,
                    CURLOPT_USERAGENT      => 'Mozilla/5.0',
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_SSL_VERIFYPEER => true,
                ]);
                $response = curl_exec($ch);
                if (curl_errno($ch)) $response = false;
                curl_close($ch);
            }

            if ($response === false) {
                $ctx = stream_context_create([
                    'http' => [
                        'method'  => 'GET',
                        'header'  => "User-Agent: Mozilla/5.0\r\n",
                        'timeout' => 10,
                    ],
                ]);
                $response = @file_get_contents($url, false, $ctx);
            }

            if ($response === false) {
                $errors[$ticker] = 'Price service temporarily unavailable';
                continue;
            }

            $data = json_decode($response, true);
            $meta = $data['chart']['result'][0]['meta'] ?? null;

            if (!$meta || !isset($meta['regularMarketPrice'])) {
                $errors[$ticker] = 'Ticker not found';
                continue;
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

            // Upsert cache
            $storage->upsertPrice($ticker, $exchange, $price, $currency, $name);

            // Upsert history
            $storage->addPriceHistory($ticker, $exchange, $price, $currency);

            $results[$ticker] = [
                'price'    => (float)$price,
                'currency' => $currency,
                'exchange' => $exchange,
                'name'     => $name,
                'cached'   => false,
            ];
        }
    }

    Response::success([
        'prices'     => $results,
        'errors'     => $errors,
        'fetched_at' => date('c'),
    ]);
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
