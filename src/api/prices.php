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
$userId = (int)$payload['sub'];
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;

$db = Database::getInstance();

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
    $storage = Storage::adapter();
    $ttl = (int)($storage->getSystemSetting('ticker_price_ttl') ?? 86400);

    // Check cache
    $placeholders = implode(',', array_fill(0, count($tickers), '?'));
    $stmt = $db->prepare(
        "SELECT ticker, exchange, price, currency, name, fetched_at
         FROM ticker_prices
         WHERE ticker IN ($placeholders)
         AND fetched_at > DATE_SUB(NOW(), INTERVAL ? SECOND)"
    );
    $params = array_values($tickers);
    $params[] = $ttl;
    $stmt->execute($params);
    $cached = $stmt->fetchAll(PDO::FETCH_ASSOC);

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
        $symbols = implode(',', $staleTickers);
        $url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' . urlencode($symbols);

        $ctx = stream_context_create([
            'http' => [
                'method'  => 'GET',
                'header'  => "User-Agent: Mozilla/5.0\r\n",
                'timeout' => 10,
            ],
        ]);

        $response = @file_get_contents($url, false, $ctx);

        if ($response === false) {
            // Yahoo API unreachable — return cached results + errors for stale
            foreach ($staleTickers as $t) {
                $errors[$t] = 'Price service temporarily unavailable';
            }
        } else {
            $data = json_decode($response, true);
            $quotes = $data['quoteResponse']['result'] ?? [];

            // Index quotes by symbol
            $quoteMap = [];
            foreach ($quotes as $q) {
                $quoteMap[$q['symbol']] = $q;
            }

            foreach ($staleTickers as $ticker) {
                if (!isset($quoteMap[$ticker])) {
                    $errors[$ticker] = 'Ticker not found';
                    continue;
                }

                $q = $quoteMap[$ticker];
                $price = $q['regularMarketPrice'] ?? null;
                $currency = $q['currency'] ?? 'USD';
                $exchange = $q['fullExchangeName'] ?? $q['exchange'] ?? '';
                $name = $q['shortName'] ?? $q['longName'] ?? $ticker;

                if ($price === null) {
                    $errors[$ticker] = 'No price data available';
                    continue;
                }

                // Normalize GBp (pence) to GBP
                if ($currency === 'GBp') {
                    $price = $price / 100;
                    $currency = 'GBP';
                }

                // Upsert cache
                $stmt = $db->prepare(
                    'INSERT INTO ticker_prices (ticker, exchange, price, currency, name, fetched_at)
                     VALUES (?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE exchange = VALUES(exchange), price = VALUES(price),
                     currency = VALUES(currency), name = VALUES(name), fetched_at = NOW()'
                );
                $stmt->execute([$ticker, $exchange, $price, $currency, $name]);

                // Upsert history
                $stmt = $db->prepare(
                    'INSERT INTO ticker_price_history (ticker, exchange, price, currency, recorded_at)
                     VALUES (?, ?, ?, ?, CURDATE())
                     ON DUPLICATE KEY UPDATE price = VALUES(price), exchange = VALUES(exchange)'
                );
                $stmt->execute([$ticker, $exchange, $price, $currency]);

                $results[$ticker] = [
                    'price'    => (float)$price,
                    'currency' => $currency,
                    'exchange' => $exchange,
                    'name'     => $name,
                    'cached'   => false,
                ];
            }
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

    $stmt = $db->query('SELECT * FROM ticker_prices ORDER BY fetched_at DESC');
    Response::success($stmt->fetchAll(PDO::FETCH_ASSOC));
}

// ============================================================================
// DELETE cache — Admin: clear price cache
// ============================================================================
if ($method === 'DELETE' && $action === 'cache') {
    if (!$isSiteAdmin) Response::error('Admin access required.', 403);

    $db->exec('TRUNCATE TABLE ticker_prices');
    Response::success(['cleared' => true]);
}

Response::error('Method not allowed.', 405);
