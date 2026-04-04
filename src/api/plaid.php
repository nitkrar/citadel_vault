<?php
/**
 * Plaid API — Bank connection proxy.
 *
 * POST ?action=create-link-token  — Create Plaid Link token
 * POST ?action=exchange-token     — Exchange public_token for access_token + accounts
 * POST ?action=refresh            — Refresh balances for connected items
 * POST ?action=create-update-link-token — Re-auth token (UK PSD2)
 * DELETE ?action=disconnect&item_id=xxx — Remove connection
 * GET  ?action=status             — List user's Plaid connections
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/PlaidEncryption.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Check gatekeeper
$storage = Storage::adapter();
if ($storage->getSystemSetting('plaid_enabled') !== 'true') {
    Response::error('Plaid integration is not enabled.', 403);
}

// Check Plaid is configured
if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    Response::error('Plaid is not configured on this server.', 500);
}

/**
 * Call Plaid API via cURL.
 */
function plaidRequest(string $endpoint, array $body): array {
    $body['client_id'] = PLAID_CLIENT_ID;
    $body['secret'] = PLAID_SECRET;

    $ch = curl_init(PLAID_BASE_URL . $endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    // curl_close() removed — deprecated since PHP 8.0, no-op since 8.5

    if ($response === false) {
        throw new RuntimeException("Plaid API error: $error");
    }

    $data = json_decode($response, true);
    if ($httpCode >= 400) {
        $msg = $data['error_message'] ?? $data['display_message'] ?? 'Plaid API error';
        throw new RuntimeException($msg);
    }

    return $data;
}

// ============================================================================
// POST create-link-token
// ============================================================================
if ($method === 'POST' && $action === 'create-link-token') {
    $body = Response::getBody();
    $countryCodes = $body['country_codes'] ?? ['US', 'GB'];

    try {
        $result = plaidRequest('/link/token/create', [
            'user' => ['client_user_id' => hash('sha256', (string)$userId)],
            'client_name' => 'Citadel Vault',
            'products' => ['auth'],
            'country_codes' => $countryCodes,
            'language' => 'en',
        ]);
        Response::success(['link_token' => $result['link_token']]);
    } catch (Exception $e) {
        Response::error($e->getMessage(), 502);
    }
}

// ============================================================================
// POST exchange-token
// ============================================================================
if ($method === 'POST' && $action === 'exchange-token') {
    $body = Response::getBody();
    $publicToken = $body['public_token'] ?? '';
    if (!$publicToken) Response::error('public_token is required.', 400);

    try {
        // Exchange token
        $exchange = plaidRequest('/item/public_token/exchange', [
            'public_token' => $publicToken,
        ]);

        $accessToken = $exchange['access_token'];
        $itemId = $exchange['item_id'];

        // Encrypt and store
        $encrypted = PlaidEncryption::encrypt($accessToken);
        $storage->upsertPlaidItem($userId, $itemId, $encrypted);

        // Fetch accounts with balances
        $accounts = plaidRequest('/accounts/balance/get', [
            'access_token' => $accessToken,
        ]);

        $result = [];
        foreach ($accounts['accounts'] as $acct) {
            $result[] = [
                'account_id' => $acct['account_id'],
                'name'       => $acct['name'],
                'type'       => $acct['type'],
                'subtype'    => $acct['subtype'],
                'balance'    => $acct['balances']['current'] ?? 0,
                'currency'   => $acct['balances']['iso_currency_code'] ?? 'USD',
            ];
        }

        Response::success([
            'item_id'  => $itemId,
            'accounts' => $result,
        ]);
    } catch (Exception $e) {
        Response::error($e->getMessage(), 502);
    }
}

// ============================================================================
// POST refresh
// ============================================================================
if ($method === 'POST' && $action === 'refresh') {
    $body = Response::getBody();
    $itemIds = $body['item_ids'] ?? [];
    if (!is_array($itemIds) || empty($itemIds)) {
        Response::error('item_ids array is required.', 400);
    }

    // Load access tokens for requested items (owned by this user)
    $items = $storage->getPlaidItems($userId, $itemIds);

    $results = [];
    $errors = [];

    foreach ($items as $item) {
        try {
            $accessToken = PlaidEncryption::decrypt($item['access_token']);
            $accounts = plaidRequest('/accounts/balance/get', [
                'access_token' => $accessToken,
            ]);

            $balances = [];
            foreach ($accounts['accounts'] as $acct) {
                $balances[$acct['account_id']] = [
                    'balance'  => $acct['balances']['current'] ?? 0,
                    'currency' => $acct['balances']['iso_currency_code'] ?? 'USD',
                ];
            }
            $results[$item['item_id']] = $balances;
        } catch (Exception $e) {
            $errors[$item['item_id']] = $e->getMessage();
            // Update status if re-auth needed
            if (strpos($e->getMessage(), 'ITEM_LOGIN_REQUIRED') !== false) {
                $storage->updatePlaidItemStatus($item['item_id'], $userId, 'reauth_required');
            }
        }
    }

    Response::success(['balances' => $results, 'errors' => $errors]);
}

// ============================================================================
// POST create-update-link-token (re-auth)
// ============================================================================
if ($method === 'POST' && $action === 'create-update-link-token') {
    $body = Response::getBody();
    $itemId = $body['item_id'] ?? '';
    if (!$itemId) Response::error('item_id is required.', 400);

    // Verify ownership
    $row = $storage->getPlaidItem($userId, $itemId);
    if (!$row) Response::error('Item not found.', 404);

    try {
        $accessToken = PlaidEncryption::decrypt($row['access_token']);
        $result = plaidRequest('/link/token/create', [
            'user' => ['client_user_id' => hash('sha256', (string)$userId)],
            'client_name' => 'Citadel Vault',
            'access_token' => $accessToken,
            'country_codes' => ['US', 'GB'],
            'language' => 'en',
        ]);
        Response::success(['link_token' => $result['link_token']]);
    } catch (Exception $e) {
        Response::error($e->getMessage(), 502);
    }
}

// ============================================================================
// DELETE disconnect
// ============================================================================
if ($method === 'DELETE' && $action === 'disconnect') {
    $itemId = $_GET['item_id'] ?? '';
    if (!$itemId) Response::error('item_id is required.', 400);

    $row = $storage->getPlaidItem($userId, $itemId);
    if (!$row) Response::error('Item not found.', 404);

    // Remove from Plaid
    try {
        $accessToken = PlaidEncryption::decrypt($row['access_token']);
        plaidRequest('/item/remove', ['access_token' => $accessToken]);
    } catch (Exception $e) {
        // Continue even if Plaid fails — remove locally
    }

    $storage->deletePlaidItem($userId, $itemId);

    Response::success(['disconnected' => true]);
}

// ============================================================================
// GET status
// ============================================================================
if ($method === 'GET' && $action === 'status') {
    Response::success([
        'enabled' => true,
        'items' => $storage->getPlaidItemsByUser($userId),
    ]);
}

Response::error('Method not allowed.', 405);
