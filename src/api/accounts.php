<?php
/**
 * Personal Vault V2 — Accounts API
 * CRUD for financial accounts (container-only, no amounts/investments).
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
// Helper: Decrypt sensitive account fields
// =============================================================================
function decryptAccountFields(array $account, string $dek): array {
    $account['name']        = Encryption::decrypt($account['name'] ?? null, $dek);
    $account['institution'] = Encryption::decrypt($account['institution'] ?? null, $dek);
    $account['customer_id'] = Encryption::decrypt($account['customer_id'] ?? null, $dek);
    $account['comments']    = Encryption::decrypt($account['comments'] ?? null, $dek);

    $detailsDecrypted = Encryption::decrypt($account['account_details'] ?? null, $dek);
    $account['account_details'] = $detailsDecrypted !== null ? json_decode($detailsDecrypted, true) : null;

    return $account;
}

// =============================================================================
// Shared SELECT columns and JOIN clauses
// =============================================================================
$selectColumns = "a.*,
    at.name AS account_type_name, at.icon AS account_type_icon,
    c.name AS country_name, c.code AS country_code, c.flag_emoji,
    cur.name AS currency_name, cur.code AS currency_code, cur.symbol AS currency_symbol, cur.exchange_rate_to_base";

$joinClauses = "LEFT JOIN account_types at ON a.account_type_id = at.id
    LEFT JOIN countries c ON a.country_id = c.id
    LEFT JOIN currencies cur ON a.currency_id = cur.id";

// =============================================================================
// GET — List all accounts or single account
// =============================================================================
if ($method === 'GET') {

    // --- Single account ---
    if ($id !== null) {
        $stmt = $db->prepare(
            "SELECT $selectColumns
             FROM accounts a
             $joinClauses
             WHERE a.id = ? AND a.user_id = ? AND a.is_active = 1"
        );
        $stmt->execute([$id, $userId]);
        $account = $stmt->fetch();

        if (!$account) {
            Response::error('Account not found.', 404);
        }

        $account = decryptAccountFields($account, $dek);

        // Include asset count and total for this account
        $assetStmt = $db->prepare(
            "SELECT COUNT(*) AS asset_count FROM assets WHERE account_id = ? AND user_id = ? AND is_active = 1"
        );
        $assetStmt->execute([$id, $userId]);
        $account['asset_count'] = (int)$assetStmt->fetch()['asset_count'];

        Response::success($account);
    }

    // --- List all owned accounts ---
    $stmt = $db->prepare(
        "SELECT $selectColumns
         FROM accounts a
         $joinClauses
         WHERE a.user_id = ? AND a.is_active = 1
         ORDER BY a.created_at DESC"
    );
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll();

    // Get asset counts per account
    $assetCountStmt = $db->prepare(
        "SELECT account_id, COUNT(*) AS cnt FROM assets WHERE user_id = ? AND is_active = 1 AND account_id IS NOT NULL GROUP BY account_id"
    );
    $assetCountStmt->execute([$userId]);
    $assetCounts = [];
    foreach ($assetCountStmt->fetchAll() as $ac) {
        $assetCounts[(int)$ac['account_id']] = (int)$ac['cnt'];
    }

    $accounts = [];
    foreach ($rows as $row) {
        $row = decryptAccountFields($row, $dek);
        $row['asset_count'] = $assetCounts[(int)$row['id']] ?? 0;
        $accounts[] = $row;
    }

    Response::success($accounts);
}

// =============================================================================
// POST — Create a new account
// =============================================================================
if ($method === 'POST') {
    $body = Response::getBody();

    $name           = $body['name'] ?? null;
    $institution    = $body['institution'] ?? null;
    $accountTypeId  = isset($body['account_type_id']) ? (int)$body['account_type_id'] : null;
    $subtype        = $body['subtype'] ?? null;
    $countryId      = isset($body['country_id']) ? (int)$body['country_id'] : null;
    $currencyId     = isset($body['currency_id']) ? (int)$body['currency_id'] : null;
    $customerId     = $body['customer_id'] ?? null;
    $accountDetails = $body['account_details'] ?? null;
    $comments       = $body['comments'] ?? null;

    if (!$name) {
        Response::error('Account name is required.', 400);
    }
    if (!$accountTypeId) {
        Response::error('Account type is required.', 400);
    }
    if (!$currencyId) {
        Response::error('Currency is required.', 400);
    }

    // Encrypt sensitive fields
    $encName        = Encryption::encrypt($name, $dek);
    $encInstitution = Encryption::encrypt($institution, $dek);
    $encCustomerId  = Encryption::encrypt($customerId, $dek);
    $encComments    = Encryption::encrypt($comments, $dek);
    $encDetails     = $accountDetails !== null ? Encryption::encrypt(json_encode($accountDetails), $dek) : null;

    $stmt = $db->prepare(
        "INSERT INTO accounts
            (user_id, account_type_id, subtype, name, institution, country_id, currency_id,
             customer_id, account_details, comments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $userId, $accountTypeId, $subtype, $encName, $encInstitution,
        $countryId, $currencyId, $encCustomerId, $encDetails, $encComments
    ]);

    $newId = (int)$db->lastInsertId();
    Response::success(['id' => $newId], 201);
}

// =============================================================================
// PUT — Update an existing account
// =============================================================================
if ($method === 'PUT') {
    if (!$id) {
        Response::error('Account ID is required.', 400);
    }

    // Verify ownership
    $stmt = $db->prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Account not found or access denied.', 404);
    }

    $body = Response::getBody();
    if (empty($body)) {
        Response::error('No fields to update.', 400);
    }

    $encryptedFields = [
        'name'        => 'name',
        'institution' => 'institution',
        'customer_id' => 'customer_id',
        'comments'    => 'comments',
    ];

    $plainFields = [
        'account_type_id' => 'account_type_id',
        'subtype'         => 'subtype',
        'country_id'      => 'country_id',
        'currency_id'     => 'currency_id',
    ];

    $setClauses = [];
    $params = [];

    foreach ($encryptedFields as $bodyKey => $dbColumn) {
        if (array_key_exists($bodyKey, $body)) {
            $value = $body[$bodyKey];
            if ($value !== null) {
                $setClauses[] = "$dbColumn = ?";
                $params[] = Encryption::encrypt($value, $dek);
            } else {
                $setClauses[] = "$dbColumn = NULL";
            }
        }
    }

    foreach ($plainFields as $bodyKey => $dbColumn) {
        if (array_key_exists($bodyKey, $body)) {
            $setClauses[] = "$dbColumn = ?";
            $params[] = $body[$bodyKey];
        }
    }

    if (array_key_exists('account_details', $body)) {
        if ($body['account_details'] !== null) {
            $setClauses[] = "account_details = ?";
            $params[] = Encryption::encrypt(json_encode($body['account_details']), $dek);
        } else {
            $setClauses[] = "account_details = NULL";
        }
    }

    if (empty($setClauses)) {
        Response::error('No valid fields to update.', 400);
    }

    $params[] = $id;
    $params[] = $userId;
    $sql = "UPDATE accounts SET " . implode(', ', $setClauses) . " WHERE id = ? AND user_id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    Response::success(['id' => $id]);
}

// =============================================================================
// DELETE — Soft-delete an account
// =============================================================================
if ($method === 'DELETE') {
    if (!$id) {
        Response::error('Account ID is required.', 400);
    }

    $stmt = $db->prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Account not found or access denied.', 404);
    }

    $stmt = $db->prepare("UPDATE accounts SET is_active = 0 WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
