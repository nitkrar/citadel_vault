<?php
/**
 * Personal Vault V2 — Portfolio API
 * Aggregates from the assets table, manages snapshots.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';
require_once __DIR__ . '/../core/Portfolio.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = Database::getInstance();

// ============================================================================
// ENDPOINTS
// ============================================================================

// --- GET /portfolio.php?action=snapshots (JWT only, no DEK required) ---
if ($method === 'GET' && $action === 'snapshots') {
    $stmt = $db->prepare("
        SELECT id, snapshot_date, total_assets, total_liquid, total_liabilities,
               net_worth, base_currency, created_at
          FROM portfolio_snapshots
         WHERE user_id = ?
         ORDER BY snapshot_date DESC
    ");
    $stmt->execute([$userId]);
    $snapshots = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($snapshots as &$s) {
        $s['id'] = (int)$s['id'];
        $s['total_assets'] = (float)$s['total_assets'];
        $s['total_liquid'] = (float)$s['total_liquid'];
        $s['total_liabilities'] = (float)$s['total_liabilities'];
        $s['net_worth'] = (float)$s['net_worth'];
    }
    unset($s);

    Response::success($snapshots);
}

// All remaining endpoints require DEK
$dek = Encryption::requireDek();

// --- GET /portfolio.php (full portfolio aggregation) ---
if ($method === 'GET' && $action === '') {
    $portfolio = aggregatePortfolio($db, $userId, $dek);

    $currStmt = $db->prepare("SELECT id, name, code, symbol, exchange_rate_to_base FROM currencies WHERE IFNULL(is_active, 1) = 1 ORDER BY display_order ASC, name ASC");
    $currStmt->execute();
    $currencies = $currStmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($currencies as &$cur) {
        $cur['id'] = (int)$cur['id'];
        $cur['exchange_rate_to_base'] = (float)$cur['exchange_rate_to_base'];
    }
    unset($cur);

    $ratesLastUpdated = null;
    $rlStmt = $db->query("SELECT MAX(last_updated) AS last FROM currencies");
    $rlRow = $rlStmt->fetch(PDO::FETCH_ASSOC);
    if ($rlRow && $rlRow['last']) {
        $ratesLastUpdated = $rlRow['last'];
    }

    Response::success([
        'summary' => [
            'total_assets'      => $portfolio['totalAssets'],
            'total_liquid'      => $portfolio['totalLiquid'],
            'total_liabilities' => $portfolio['totalLiabilities'],
            'net_worth'         => $portfolio['netWorth'],
            'base_currency'     => BASE_CURRENCY,
        ],
        'by_country'          => $portfolio['by_country'],
        'by_type'             => $portfolio['by_type'],
        'by_account'          => $portfolio['by_account'],
        'assets'              => $portfolio['assets'],
        'currencies'          => $currencies,
        'rates_last_updated'  => $ratesLastUpdated,
    ]);
}

// --- GET /portfolio.php?action=rates ---
if ($method === 'GET' && $action === 'rates') {
    $stmt = $db->prepare("SELECT code, exchange_rate_to_base, last_updated FROM currencies ORDER BY display_order ASC, name ASC");
    $stmt->execute();
    $dbRates = [];
    $lastUpdated = null;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $dbRates[$r['code']] = [
            'rate'         => (float)$r['exchange_rate_to_base'],
            'last_updated' => $r['last_updated'],
        ];
        if ($r['last_updated'] && ($lastUpdated === null || $r['last_updated'] > $lastUpdated)) {
            $lastUpdated = $r['last_updated'];
        }
    }

    Response::success([
        'base_currency' => BASE_CURRENCY,
        'rates'         => $dbRates,
        'last_updated'  => $lastUpdated,
    ]);
}

// --- POST /portfolio.php?action=snapshot ---
if ($method === 'POST' && $action === 'snapshot') {
    $body = Response::getBody();
    $snapshotDate = $body['date'] ?? date('Y-m-d');

    $parsed = date_create_from_format('Y-m-d', $snapshotDate);
    if (!$parsed || $parsed->format('Y-m-d') !== $snapshotDate) {
        Response::error('Invalid date format. Use YYYY-MM-DD.', 400);
    }

    $portfolio = aggregatePortfolio($db, $userId, $dek);

    $details = json_encode([
        'by_country' => $portfolio['by_country'],
        'by_type'    => $portfolio['by_type'],
    ]);
    $encryptedDetails = Encryption::encrypt($details, $dek);

    $stmt = $db->prepare("
        INSERT INTO portfolio_snapshots
            (user_id, snapshot_date, total_assets, total_liquid, total_liabilities, net_worth, base_currency, details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            total_assets = VALUES(total_assets),
            total_liquid = VALUES(total_liquid),
            total_liabilities = VALUES(total_liabilities),
            net_worth = VALUES(net_worth),
            base_currency = VALUES(base_currency),
            details_json = VALUES(details_json)
    ");
    $stmt->execute([
        $userId, $snapshotDate,
        $portfolio['totalAssets'], $portfolio['totalLiquid'],
        $portfolio['totalLiabilities'], $portfolio['netWorth'],
        BASE_CURRENCY, $encryptedDetails,
    ]);

    Response::success([
        'snapshot_date'     => $snapshotDate,
        'total_assets'      => $portfolio['totalAssets'],
        'total_liquid'      => $portfolio['totalLiquid'],
        'total_liabilities' => $portfolio['totalLiabilities'],
        'net_worth'         => $portfolio['netWorth'],
        'base_currency'     => BASE_CURRENCY,
    ], 201);
}

// --- GET /portfolio.php?action=snapshot&date=YYYY-MM-DD ---
if ($method === 'GET' && $action === 'snapshot') {
    $date = trim($_GET['date'] ?? '');
    if ($date === '') {
        Response::error('Date parameter is required (YYYY-MM-DD).', 400);
    }

    $parsed = date_create_from_format('Y-m-d', $date);
    if (!$parsed || $parsed->format('Y-m-d') !== $date) {
        Response::error('Invalid date format. Use YYYY-MM-DD.', 400);
    }

    $stmt = $db->prepare("
        SELECT id, snapshot_date, total_assets, total_liquid, total_liabilities,
               net_worth, base_currency, details_json, created_at
          FROM portfolio_snapshots
         WHERE user_id = ? AND snapshot_date = ?
    ");
    $stmt->execute([$userId, $date]);
    $snapshot = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$snapshot) {
        Response::error('Snapshot not found for date: ' . $date, 404);
    }

    $details = null;
    if ($snapshot['details_json']) {
        $decrypted = Encryption::decrypt($snapshot['details_json'], $dek);
        if ($decrypted) {
            $details = json_decode($decrypted, true);
        }
    }

    Response::success([
        'id'                => (int)$snapshot['id'],
        'snapshot_date'     => $snapshot['snapshot_date'],
        'total_assets'      => (float)$snapshot['total_assets'],
        'total_liquid'      => (float)$snapshot['total_liquid'],
        'total_liabilities' => (float)$snapshot['total_liabilities'],
        'net_worth'         => (float)$snapshot['net_worth'],
        'base_currency'     => $snapshot['base_currency'],
        'details'           => $details,
        'created_at'        => $snapshot['created_at'],
    ]);
}

Response::error('Invalid request.', 400);
