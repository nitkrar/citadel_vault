<?php
/**
 * Personal Vault V2 — Assets API
 * CRUD for assets (things of value or liability) with encrypted data.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';

Response::setCors();
$payload = Auth::requireAuth();
$dek = Encryption::requireDek();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = Database::getInstance();

// =============================================================================
// Helper: Decrypt asset fields
// =============================================================================
function decryptAssetFields(array $asset, string $dek): array {
    $asset['name']     = Encryption::decrypt($asset['name'] ?? null, $dek);
    $asset['comments'] = Encryption::decrypt($asset['comments'] ?? null, $dek);

    $amountDecrypted = Encryption::decrypt($asset['amount'] ?? null, $dek);
    $asset['amount'] = $amountDecrypted !== null ? (float)$amountDecrypted : null;

    $dataDecrypted = Encryption::decrypt($asset['asset_data'] ?? null, $dek);
    $asset['asset_data'] = $dataDecrypted !== null ? json_decode($dataDecrypted, true) : null;

    return $asset;
}

// =============================================================================
// Shared SELECT columns
// =============================================================================
$selectColumns = "a.*,
    at.name AS asset_type_name, at.category AS asset_type_category, at.icon AS asset_type_icon, at.json_schema AS asset_type_schema,
    cur.name AS currency_name, cur.code AS currency_code, cur.symbol AS currency_symbol, cur.exchange_rate_to_base,
    acc.name AS account_name_enc,
    co.name AS country_name, co.code AS country_code, co.flag_emoji";

$joinClauses = "LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN currencies cur ON a.currency_id = cur.id
    LEFT JOIN accounts acc ON a.account_id = acc.id
    LEFT JOIN countries co ON a.country_id = co.id";

// =============================================================================
// GET — List assets or single asset
// =============================================================================
if ($method === 'GET') {

    // --- Single asset ---
    if ($id !== null) {
        $stmt = $db->prepare(
            "SELECT $selectColumns
             FROM assets a
             $joinClauses
             WHERE a.id = ? AND a.user_id = ? AND a.is_active = 1"
        );
        $stmt->execute([$id, $userId]);
        $asset = $stmt->fetch();

        if (!$asset) {
            Response::error('Asset not found.', 404);
        }

        $asset = decryptAssetFields($asset, $dek);
        // Decrypt account name if present
        if ($asset['account_name_enc']) {
            $asset['account_name'] = Encryption::decrypt($asset['account_name_enc'], $dek);
        } else {
            $asset['account_name'] = null;
        }
        unset($asset['account_name_enc']);

        Response::success($asset);
    }

    // --- List all assets ---
    $accountFilter = isset($_GET['account_id']) ? (int)$_GET['account_id'] : null;

    $sql = "SELECT $selectColumns
            FROM assets a
            $joinClauses
            WHERE a.user_id = ? AND a.is_active = 1";
    $params = [$userId];

    if ($accountFilter !== null) {
        $sql .= " AND a.account_id = ?";
        $params[] = $accountFilter;
    }

    $sql .= " ORDER BY a.created_at DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $assets = [];
    foreach ($rows as $row) {
        $row = decryptAssetFields($row, $dek);
        if ($row['account_name_enc']) {
            $row['account_name'] = Encryption::decrypt($row['account_name_enc'], $dek);
        } else {
            $row['account_name'] = null;
        }
        unset($row['account_name_enc']);
        $assets[] = $row;
    }

    Response::success($assets);
}

// =============================================================================
// POST — Create a new asset
// =============================================================================
if ($method === 'POST') {
    $body = Response::getBody();

    $name        = $body['name'] ?? null;
    $accountId   = isset($body['account_id']) ? (int)$body['account_id'] : null;
    $assetTypeId = isset($body['asset_type_id']) ? (int)$body['asset_type_id'] : null;
    $currencyId  = isset($body['currency_id']) ? (int)$body['currency_id'] : null;
    $countryId   = isset($body['country_id']) ? (int)$body['country_id'] : null;
    $amount      = $body['amount'] ?? null;
    $isLiquid    = isset($body['is_liquid']) ? (int)$body['is_liquid'] : 0;
    $isLiability = isset($body['is_liability']) ? (int)$body['is_liability'] : 0;
    $assetData   = $body['asset_data'] ?? null;
    $comments    = $body['comments'] ?? null;

    if (!$name) {
        Response::error('Asset name is required.', 400);
    }
    if (!$assetTypeId) {
        Response::error('Asset type is required.', 400);
    }
    if (!$currencyId) {
        Response::error('Currency is required.', 400);
    }
    if ($amount === null || $amount === '') {
        Response::error('Amount is required.', 400);
    }

    // Verify account ownership if provided
    if ($accountId) {
        $stmt = $db->prepare("SELECT id, country_id FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1");
        $stmt->execute([$accountId, $userId]);
        $account = $stmt->fetch();
        if (!$account) {
            Response::error('Account not found or not owned by you.', 400);
        }
        // Auto-infer country from account if not explicitly provided
        if (!$countryId && $account['country_id']) {
            $countryId = (int)$account['country_id'];
        }
    }

    // Auto-infer country from currency if still not set
    if (!$countryId && $currencyId) {
        $stmt = $db->prepare("SELECT id FROM countries WHERE default_currency_id = ? LIMIT 1");
        $stmt->execute([$currencyId]);
        $inferredCountry = $stmt->fetch();
        if ($inferredCountry) {
            $countryId = (int)$inferredCountry['id'];
        }
    }

    $encName     = Encryption::encrypt($name, $dek);
    $encAmount   = Encryption::encrypt((string)$amount, $dek);
    $encData     = $assetData !== null ? Encryption::encrypt(json_encode($assetData), $dek) : null;
    $encComments = Encryption::encrypt($comments, $dek);

    $stmt = $db->prepare(
        "INSERT INTO assets
            (user_id, account_id, asset_type_id, name, currency_id, country_id, amount,
             is_liquid, is_liability, asset_data, comments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $userId, $accountId, $assetTypeId, $encName, $currencyId, $countryId,
        $encAmount, $isLiquid, $isLiability, $encData, $encComments
    ]);

    $newId = (int)$db->lastInsertId();
    Response::success(['id' => $newId], 201);
}

// =============================================================================
// PUT — Update an existing asset
// =============================================================================
if ($method === 'PUT') {
    if (!$id) {
        Response::error('Asset ID is required.', 400);
    }

    $stmt = $db->prepare("SELECT id FROM assets WHERE id = ? AND user_id = ? AND is_active = 1");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Asset not found or access denied.', 404);
    }

    $body = Response::getBody();
    if (empty($body)) {
        Response::error('No fields to update.', 400);
    }

    $setClauses = [];
    $params = [];

    // Encrypted fields
    if (array_key_exists('name', $body)) {
        if ($body['name'] !== null) {
            $setClauses[] = "name = ?";
            $params[] = Encryption::encrypt($body['name'], $dek);
        }
    }
    if (array_key_exists('amount', $body)) {
        if ($body['amount'] !== null) {
            $setClauses[] = "amount = ?";
            $params[] = Encryption::encrypt((string)$body['amount'], $dek);
        }
    }
    if (array_key_exists('comments', $body)) {
        if ($body['comments'] !== null) {
            $setClauses[] = "comments = ?";
            $params[] = Encryption::encrypt($body['comments'], $dek);
        } else {
            $setClauses[] = "comments = NULL";
        }
    }
    if (array_key_exists('asset_data', $body)) {
        if ($body['asset_data'] !== null) {
            $setClauses[] = "asset_data = ?";
            $params[] = Encryption::encrypt(json_encode($body['asset_data']), $dek);
        } else {
            $setClauses[] = "asset_data = NULL";
        }
    }

    // Plain fields
    $plainFields = ['asset_type_id', 'currency_id', 'is_liquid', 'is_liability'];

    // country_id (nullable)
    if (array_key_exists('country_id', $body)) {
        if ($body['country_id'] !== null && $body['country_id'] !== '') {
            $setClauses[] = "country_id = ?";
            $params[] = (int)$body['country_id'];
        } else {
            $setClauses[] = "country_id = NULL";
        }
    }
    foreach ($plainFields as $field) {
        if (array_key_exists($field, $body)) {
            $setClauses[] = "$field = ?";
            $params[] = $body[$field];
        }
    }

    // account_id (nullable)
    if (array_key_exists('account_id', $body)) {
        if ($body['account_id'] !== null) {
            // Verify ownership
            $stmt = $db->prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1");
            $stmt->execute([(int)$body['account_id'], $userId]);
            if (!$stmt->fetch()) {
                Response::error('Account not found or not owned by you.', 400);
            }
            $setClauses[] = "account_id = ?";
            $params[] = (int)$body['account_id'];
        } else {
            $setClauses[] = "account_id = NULL";
        }
    }

    if (empty($setClauses)) {
        Response::error('No valid fields to update.', 400);
    }

    $params[] = $id;
    $params[] = $userId;
    $sql = "UPDATE assets SET " . implode(', ', $setClauses) . " WHERE id = ? AND user_id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    Response::success(['id' => $id]);
}

// =============================================================================
// DELETE — Soft-delete an asset
// =============================================================================
if ($method === 'DELETE') {
    if (!$id) {
        Response::error('Asset ID is required.', 400);
    }

    $stmt = $db->prepare("SELECT id FROM assets WHERE id = ? AND user_id = ? AND is_active = 1");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Asset not found or access denied.', 404);
    }

    $stmt = $db->prepare("UPDATE assets SET is_active = 0 WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
