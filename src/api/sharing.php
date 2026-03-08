<?php
/**
 * Personal Vault V2 — Sharing API
 * RSA-encrypted sharing with auto/approval/snapshot sync modes.
 * Supports: account, asset, license, insurance, portfolio, portfolio_snapshot.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';
require_once __DIR__ . '/../core/Portfolio.php';

Response::setCors();
$payload = Auth::requireAuth();
$dek = Encryption::requireDek();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = Database::getInstance();

$VALID_SOURCE_TYPES = ['account', 'asset', 'license', 'insurance', 'portfolio', 'portfolio_snapshot'];
$VALID_SYNC_MODES   = ['auto', 'approval', 'snapshot'];
$VALID_PORTFOLIO_MODES = ['summary', 'full_snapshot', 'saved_snapshot', 'auto', 'selective'];

// =============================================================================
// Helper: Resolve recipient by username or email, fall back to ghost user
// =============================================================================
function resolveRecipient(string $recipientStr, int $currentUserId, PDO $db): array {
    $recipientStr = trim($recipientStr);
    if (!$recipientStr) {
        throw new \Exception('Recipient is required.');
    }

    // Try to resolve by username or email
    $stmt = $db->prepare(
        "SELECT id, public_key FROM users
         WHERE is_active = 1 AND id != ?
           AND (username = ? OR email = ?)
         LIMIT 1"
    );
    $stmt->execute([$currentUserId, $recipientStr, $recipientStr]);
    $user = $stmt->fetch();

    if ($user && $user['public_key']) {
        return ['id' => (int)$user['id'], 'public_key' => $user['public_key'], 'resolved' => true];
    }

    // Backward compat: if the string is a numeric ID, try direct lookup
    if (ctype_digit($recipientStr)) {
        $stmt = $db->prepare(
            "SELECT id, public_key FROM users WHERE id = ? AND is_active = 1 AND id != ? LIMIT 1"
        );
        $stmt->execute([(int)$recipientStr, $currentUserId]);
        $user = $stmt->fetch();
        if ($user && $user['public_key']) {
            return ['id' => (int)$user['id'], 'public_key' => $user['public_key'], 'resolved' => true];
        }
    }

    // Fall back to ghost user (if migration has been run)
    $stmt = $db->prepare("SELECT id FROM users WHERE username = '__ghost__' LIMIT 1");
    $stmt->execute();
    $ghost = $stmt->fetch();
    if (!$ghost) {
        // Ghost user doesn't exist yet — migration not run.
        // Can't create a share for an unresolvable recipient without it.
        throw new \Exception('Recipient not found.');
    }
    return ['id' => (int)$ghost['id'], 'public_key' => null, 'resolved' => false];
}

// =============================================================================
// Helper: Build share data for a single source item
// =============================================================================
function buildShareData(
    string $sourceType,
    ?int $sourceId,
    int $userId,
    string $dek,
    PDO $db,
    array $extra = []
): array {
    switch ($sourceType) {
        case 'account':
            if (!$sourceId) throw new \Exception('source_id is required for account shares.');
            $stmt = $db->prepare(
                "SELECT a.*, at.name AS account_type_name,
                        c.name AS country_name, c.code AS country_code, c.flag_emoji,
                        cur.code AS currency_code, cur.symbol AS currency_symbol
                 FROM accounts a
                 LEFT JOIN account_types at ON a.account_type_id = at.id
                 LEFT JOIN countries c ON a.country_id = c.id
                 LEFT JOIN currencies cur ON a.currency_id = cur.id
                 WHERE a.id = ? AND a.user_id = ? AND a.is_active = 1"
            );
            $stmt->execute([$sourceId, $userId]);
            $account = $stmt->fetch();
            if (!$account) throw new \Exception('Account not found or not owned by you.');

            return [
                'type' => 'account',
                'name' => Encryption::decrypt($account['name'], $dek),
                'institution' => Encryption::decrypt($account['institution'], $dek),
                'customer_id' => Encryption::decrypt($account['customer_id'], $dek),
                'account_details' => json_decode(Encryption::decrypt($account['account_details'], $dek) ?? 'null', true),
                'comments' => Encryption::decrypt($account['comments'], $dek),
                'account_type_name' => $account['account_type_name'] ?? null,
                'subtype' => $account['subtype'] ?? null,
                'country_name' => $account['country_name'] ?? null,
                'country_code' => $account['country_code'] ?? null,
                'flag_emoji' => $account['flag_emoji'] ?? null,
                'currency_code' => $account['currency_code'] ?? null,
            ];

        case 'asset':
            if (!$sourceId) throw new \Exception('source_id is required for asset shares.');
            $stmt = $db->prepare(
                "SELECT a.*, at.name AS asset_type_name, at.category AS asset_type_category,
                        co.name AS country_name, co.flag_emoji,
                        cur.code AS currency_code, cur.symbol AS currency_symbol, cur.exchange_rate_to_base,
                        acc.name AS account_name_enc
                 FROM assets a
                 LEFT JOIN asset_types at ON a.asset_type_id = at.id
                 LEFT JOIN countries co ON a.country_id = co.id
                 LEFT JOIN currencies cur ON a.currency_id = cur.id
                 LEFT JOIN accounts acc ON a.account_id = acc.id
                 WHERE a.id = ? AND a.user_id = ? AND a.is_active = 1"
            );
            $stmt->execute([$sourceId, $userId]);
            $asset = $stmt->fetch();
            if (!$asset) throw new \Exception('Asset not found or not owned by you.');

            $decryptedAmount = Encryption::decrypt($asset['amount'], $dek);
            $amountFloat = $decryptedAmount !== null ? (float)$decryptedAmount : null;
            $exchangeRate = $asset['exchange_rate_to_base'] ? (float)$asset['exchange_rate_to_base'] : 1.0;
            $baseAmount = $amountFloat !== null ? round($amountFloat * $exchangeRate, 2) : null;

            $accountName = null;
            if (!empty($asset['account_name_enc'])) {
                $accountName = Encryption::decrypt($asset['account_name_enc'], $dek);
            }

            return [
                'type' => 'asset',
                'name' => Encryption::decrypt($asset['name'], $dek),
                'amount' => $decryptedAmount,
                'asset_data' => json_decode(Encryption::decrypt($asset['asset_data'], $dek) ?? 'null', true),
                'comments' => Encryption::decrypt($asset['comments'], $dek),
                'is_liquid' => (bool)$asset['is_liquid'],
                'is_liability' => (bool)$asset['is_liability'],
                'asset_type_name' => $asset['asset_type_name'] ?? null,
                'asset_type_category' => $asset['asset_type_category'] ?? null,
                'ticker_symbol' => $asset['ticker_symbol'] ?? null,
                'country_name' => $asset['country_name'] ?? null,
                'flag_emoji' => $asset['flag_emoji'] ?? null,
                'currency_code' => $asset['currency_code'] ?? null,
                'currency_symbol' => $asset['currency_symbol'] ?? null,
                'base_amount' => $baseAmount,
                'shares_quantity' => $asset['shares_quantity'] ?? null,
                'account_name' => $accountName,
            ];

        case 'license':
            if (!$sourceId) throw new \Exception('source_id is required for license shares.');
            $dekHex = bin2hex($dek);
            $stmt = $db->prepare("SELECT * FROM licenses WHERE id = ? AND user_id = ?");
            $stmt->execute([$sourceId, $userId]);
            $license = $stmt->fetch();
            if (!$license) throw new \Exception('License not found or not owned by you.');

            return [
                'type' => 'license',
                'product_name' => Encryption::decrypt($license['product_name'], $dekHex),
                'vendor' => Encryption::decrypt($license['vendor'], $dekHex),
                'license_key' => Encryption::decrypt($license['license_key_encrypted'], $dekHex),
                'notes' => Encryption::decrypt($license['notes_encrypted'], $dekHex),
                'purchase_date' => $license['purchase_date'] ?? null,
                'expiry_date' => $license['expiry_date'] ?? null,
                'seats' => (int)($license['seats'] ?? 1),
                'category' => $license['category'] ?? null,
            ];

        case 'insurance':
            if (!$sourceId) throw new \Exception('source_id is required for insurance shares.');
            $stmt = $db->prepare("SELECT * FROM insurance_policies WHERE id = ? AND user_id = ? AND is_active = 1");
            $stmt->execute([$sourceId, $userId]);
            $policy = $stmt->fetch();
            if (!$policy) throw new \Exception('Insurance policy not found or not owned by you.');

            $premium = Encryption::decrypt($policy['premium_amount'] ?? null, $dek);
            $coverage = Encryption::decrypt($policy['coverage_amount'] ?? null, $dek);
            $cashValue = Encryption::decrypt($policy['cash_value'] ?? null, $dek);

            return [
                'type' => 'insurance',
                'policy_name' => Encryption::decrypt($policy['policy_name'], $dek),
                'provider' => Encryption::decrypt($policy['provider'], $dek),
                'policy_number' => Encryption::decrypt($policy['policy_number'], $dek),
                'premium_amount' => $premium !== null ? (float)$premium : null,
                'coverage_amount' => $coverage !== null ? (float)$coverage : null,
                'cash_value' => $cashValue !== null ? (float)$cashValue : null,
                'notes' => Encryption::decrypt($policy['notes'] ?? null, $dek),
                'start_date' => $policy['start_date'] ?? null,
                'maturity_date' => $policy['maturity_date'] ?? null,
                'payment_frequency' => $policy['payment_frequency'] ?? null,
                'category' => $policy['category'] ?? null,
            ];

        case 'portfolio':
            return buildPortfolioShareData($db, $userId, $dek, $extra);

        case 'portfolio_snapshot':
            return ['type' => 'portfolio_snapshot', 'note' => 'Portfolio snapshot shared'];

        default:
            throw new \Exception("Unsupported source_type: $sourceType");
    }
}

// =============================================================================
// Helper: Build portfolio share data with mode support
// =============================================================================
function buildPortfolioShareData(PDO $db, int $userId, string $dek, array $extra): array {
    $mode = $extra['portfolio_mode'] ?? 'summary';

    $portfolio = aggregatePortfolio($db, $userId, $dek);

    $summary = [
        'net_worth' => $portfolio['netWorth'],
        'total_assets' => $portfolio['totalAssets'],
        'total_liquid' => $portfolio['totalLiquid'],
        'total_liabilities' => $portfolio['totalLiabilities'],
        'base_currency' => defined('BASE_CURRENCY') ? BASE_CURRENCY : 'GBP',
    ];

    switch ($mode) {
        case 'summary':
            return [
                'type' => 'portfolio',
                'mode' => 'summary',
                'summary' => $summary,
            ];

        case 'full_snapshot':
            return [
                'type' => 'portfolio',
                'mode' => 'full_snapshot',
                'summary' => $summary,
                'assets' => $portfolio['assets'],
                'by_country' => $portfolio['by_country'],
                'by_type' => $portfolio['by_type'],
            ];

        case 'saved_snapshot':
            $snapshotId = (int)($extra['snapshot_id'] ?? 0);
            if (!$snapshotId) throw new \Exception('snapshot_id is required for saved_snapshot mode.');

            $stmt = $db->prepare(
                "SELECT * FROM portfolio_snapshots WHERE id = ? AND user_id = ?"
            );
            $stmt->execute([$snapshotId, $userId]);
            $snap = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$snap) throw new \Exception('Snapshot not found or not owned by you.');

            $details = null;
            if (!empty($snap['details_json'])) {
                $decrypted = Encryption::decrypt($snap['details_json'], $dek);
                if ($decrypted) $details = json_decode($decrypted, true);
            }

            return [
                'type' => 'portfolio',
                'mode' => 'saved_snapshot',
                'snapshot_date' => $snap['snapshot_date'],
                'summary' => [
                    'net_worth' => (float)$snap['net_worth'],
                    'total_assets' => (float)$snap['total_assets'],
                    'total_liquid' => (float)$snap['total_liquid'],
                    'total_liabilities' => (float)$snap['total_liabilities'],
                    'base_currency' => $snap['base_currency'],
                ],
                'details' => $details,
            ];

        case 'auto':
            return [
                'type' => 'portfolio',
                'mode' => 'auto',
                'summary' => $summary,
                'assets' => $portfolio['assets'],
                'by_country' => $portfolio['by_country'],
                'by_type' => $portfolio['by_type'],
            ];

        case 'selective':
            $selectedAssetIds = $extra['selected_asset_ids'] ?? [];
            $selectedAccountIds = $extra['selected_account_ids'] ?? [];

            $filteredAssets = array_values(array_filter($portfolio['assets'], function ($a) use ($selectedAssetIds, $selectedAccountIds) {
                if (!empty($selectedAssetIds) && in_array($a['id'], $selectedAssetIds, true)) return true;
                if (!empty($selectedAccountIds) && in_array($a['account_id'], $selectedAccountIds, true)) return true;
                return false;
            }));

            // Recompute totals for filtered set
            $fTotal = 0.0; $fLiquid = 0.0; $fLiab = 0.0;
            foreach ($filteredAssets as $a) {
                $amt = (float)($a['base_amount'] ?? 0);
                if ($a['is_liability']) { $fLiab += abs($amt); }
                else { $fTotal += $amt; if ($a['is_liquid']) $fLiquid += $amt; }
            }

            return [
                'type' => 'portfolio',
                'mode' => 'selective',
                'summary' => [
                    'net_worth' => round($fTotal - $fLiab, 2),
                    'total_assets' => round($fTotal, 2),
                    'total_liquid' => round($fLiquid, 2),
                    'total_liabilities' => round($fLiab, 2),
                    'base_currency' => defined('BASE_CURRENCY') ? BASE_CURRENCY : 'GBP',
                ],
                'assets' => $filteredAssets,
            ];

        default:
            throw new \Exception("Invalid portfolio_mode: $mode");
    }
}

// =============================================================================
// GET ?action=sent — Items I've shared with others
// =============================================================================
if ($method === 'GET' && $action === 'sent') {
    $stmt = $db->prepare(
        "SELECT si.*, u.username AS recipient_username
         FROM shared_items si
         INNER JOIN users u ON u.id = si.recipient_user_id
         WHERE si.owner_user_id = ?
         ORDER BY si.shared_at DESC"
    );
    $stmt->execute([$userId]);
    Response::success($stmt->fetchAll());
}

// =============================================================================
// GET ?action=received — Items shared with me
// =============================================================================
if ($method === 'GET' && $action === 'received') {
    $stmt = $db->prepare(
        "SELECT si.*, u.username AS owner_username
         FROM shared_items si
         INNER JOIN users u ON u.id = si.owner_user_id
         WHERE si.recipient_user_id = ?
           AND (si.expires_at IS NULL OR si.expires_at > NOW())
         ORDER BY si.shared_at DESC"
    );
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll();

    // Decrypt each item's data with user's RSA private key
    $userStmt = $db->prepare("SELECT encrypted_private_key FROM users WHERE id = ?");
    $userStmt->execute([$userId]);
    $userRow = $userStmt->fetch();
    $privateKeyEnc = $userRow['encrypted_private_key'] ?? null;

    $privateKeyPem = $privateKeyEnc ? Encryption::decryptPrivateKey($privateKeyEnc, $dek) : null;

    $items = [];
    foreach ($rows as $row) {
        $item = $row;
        if ($privateKeyPem) {
            $decrypted = Encryption::rsaHybridDecrypt($row['encrypted_data'], $privateKeyPem);
            $item['decrypted_data'] = $decrypted !== null ? json_decode($decrypted, true) : null;
        }
        unset($item['encrypted_data']); // Don't expose raw encrypted blob
        $items[] = $item;
    }

    Response::success($items);
}

// =============================================================================
// GET ?action=pending-count — Count of received shares (for badge)
// =============================================================================
if ($method === 'GET' && $action === 'pending-count') {
    $stmt = $db->prepare(
        "SELECT COUNT(*) AS cnt FROM shared_items
         WHERE recipient_user_id = ?
           AND (expires_at IS NULL OR expires_at > NOW())"
    );
    $stmt->execute([$userId]);
    Response::success(['count' => (int)$stmt->fetch()['cnt']]);
}

// =============================================================================
// POST ?action=batch — Share multiple items at once
// =============================================================================
if ($method === 'POST' && $action === 'batch') {
    $body = Response::getBody();

    $recipientStr = trim($body['recipient'] ?? '');
    // Backward compat: accept recipient_user_id too
    if (!$recipientStr && !empty($body['recipient_user_id'])) {
        $recipientStr = (string)$body['recipient_user_id'];
    }
    $syncMode        = $body['sync_mode'] ?? 'snapshot';
    $label           = $body['label'] ?? null;
    $expiresAt       = $body['expires_at'] ?? null;
    $items           = $body['items'] ?? [];

    if (!$recipientStr) { Response::error('Recipient is required.', 400); }
    if (!in_array($syncMode, $VALID_SYNC_MODES, true)) {
        Response::error('sync_mode must be auto, approval, or snapshot.', 400);
    }

    try {
        $resolved = resolveRecipient($recipientStr, $userId, $db);
    } catch (\Exception $e) {
        Response::error($e->getMessage(), 400);
    }
    $recipientUserId = $resolved['id'];

    if ($recipientUserId === $userId) {
        Response::error('You cannot share with yourself.', 400);
    }
    if (!is_array($items) || empty($items)) {
        Response::error('items array is required and must not be empty.', 400);
    }
    if (count($items) > 50) {
        Response::error('Maximum 50 items per batch.', 400);
    }

    $results = [];
    $succeeded = 0;
    $failed = 0;

    $db->beginTransaction();
    try {
        foreach ($items as $index => $item) {
            $sourceType = $item['source_type'] ?? null;
            $sourceId   = isset($item['source_id']) ? (int)$item['source_id'] : null;

            if (!$sourceType || !in_array($sourceType, $VALID_SOURCE_TYPES, true)) {
                $results[] = ['index' => $index, 'success' => false, 'error' => 'Invalid source_type.'];
                $failed++;
                continue;
            }

            try {
                $dataToShare = buildShareData($sourceType, $sourceId, $userId, $dek, $db);

                if ($resolved['resolved']) {
                    $encryptedData = Encryption::rsaHybridEncrypt(json_encode($dataToShare), $resolved['public_key']);
                    if (!$encryptedData) throw new \Exception('Failed to encrypt data.');
                } else {
                    $encryptedData = '';
                }

                $insertStmt = $db->prepare(
                    "INSERT INTO shared_items
                        (owner_user_id, recipient_user_id, recipient_identifier, source_type, source_id,
                         sync_mode, encrypted_data, label, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                );
                $insertStmt->execute([
                    $userId, $recipientUserId, $recipientStr, $sourceType, $sourceId,
                    $syncMode, $encryptedData, $label, $expiresAt
                ]);

                $newId = (int)$db->lastInsertId();
                $results[] = ['index' => $index, 'success' => true, 'id' => $newId];
                $succeeded++;
            } catch (\Exception $e) {
                $results[] = ['index' => $index, 'success' => false, 'error' => $e->getMessage()];
                $failed++;
            }
        }
        $db->commit();
    } catch (\Exception $e) {
        $db->rollBack();
        Response::error('Batch share failed: ' . $e->getMessage(), 500);
    }

    Response::success([
        'total' => count($items),
        'succeeded' => $succeeded,
        'failed' => $failed,
        'results' => $results,
    ], 201);
}

// =============================================================================
// POST — Share a single item
// =============================================================================
if ($method === 'POST' && $action === '') {
    $body = Response::getBody();

    $recipientStr = trim($body['recipient'] ?? '');
    // Backward compat: accept recipient_user_id too
    if (!$recipientStr && !empty($body['recipient_user_id'])) {
        $recipientStr = (string)$body['recipient_user_id'];
    }
    $sourceType      = $body['source_type'] ?? null;
    $sourceId        = isset($body['source_id']) ? (int)$body['source_id'] : null;
    $syncMode        = $body['sync_mode'] ?? 'snapshot';
    $label           = $body['label'] ?? null;
    $expiresAt       = $body['expires_at'] ?? null;

    if (!$recipientStr) { Response::error('Recipient is required.', 400); }
    if (!$sourceType) { Response::error('source_type is required.', 400); }
    if (!in_array($sourceType, $VALID_SOURCE_TYPES, true)) {
        Response::error('Invalid source_type. Allowed: ' . implode(', ', $VALID_SOURCE_TYPES), 400);
    }
    if (!in_array($syncMode, $VALID_SYNC_MODES, true)) {
        Response::error('sync_mode must be auto, approval, or snapshot.', 400);
    }

    try {
        $resolved = resolveRecipient($recipientStr, $userId, $db);
    } catch (\Exception $e) {
        Response::error($e->getMessage(), 400);
    }
    $recipientUserId = $resolved['id'];

    if ($recipientUserId === $userId) {
        Response::error('You cannot share with yourself.', 400);
    }

    // Build extra fields for portfolio modes
    $extra = [
        'portfolio_mode'       => $body['portfolio_mode'] ?? 'summary',
        'snapshot_id'          => isset($body['snapshot_id']) ? (int)$body['snapshot_id'] : null,
        'selected_asset_ids'   => $body['selected_asset_ids'] ?? [],
        'selected_account_ids' => $body['selected_account_ids'] ?? [],
    ];

    // For portfolio with auto mode, override sync_mode
    if ($sourceType === 'portfolio' && ($extra['portfolio_mode'] ?? '') === 'auto') {
        $syncMode = 'auto';
    }

    try {
        $dataToShare = buildShareData($sourceType, $sourceId, $userId, $dek, $db, $extra);
    } catch (\Exception $e) {
        Response::error($e->getMessage(), 400);
    }

    // Encrypt with recipient's public key (or empty string for ghost user)
    if ($resolved['resolved']) {
        $encryptedData = Encryption::rsaHybridEncrypt(json_encode($dataToShare), $resolved['public_key']);
        if (!$encryptedData) {
            Response::error('Failed to encrypt data for sharing.', 500);
        }
    } else {
        $encryptedData = '';
    }

    $stmt = $db->prepare(
        "INSERT INTO shared_items
            (owner_user_id, recipient_user_id, recipient_identifier, source_type, source_id,
             sync_mode, encrypted_data, label, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $userId, $recipientUserId, $recipientStr, $sourceType, $sourceId,
        $syncMode, $encryptedData, $label, $expiresAt
    ]);

    $newId = (int)$db->lastInsertId();
    Response::success(['id' => $newId], 201);
}

// =============================================================================
// DELETE — Revoke a share
// =============================================================================
if ($method === 'DELETE') {
    if (!$id) { Response::error('Share ID is required.', 400); }

    $stmt = $db->prepare("DELETE FROM shared_items WHERE id = ? AND owner_user_id = ?");
    $stmt->execute([$id, $userId]);

    if ($stmt->rowCount() === 0) {
        Response::error('Share not found or access denied.', 404);
    }

    Response::success(['message' => 'Share revoked.']);
}

Response::error('Invalid request.', 400);
