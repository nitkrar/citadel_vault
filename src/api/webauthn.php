<?php
/**
 * Personal Vault — WebAuthn API
 * Handles passkey registration, authentication, and credential management.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/WebAuthn.php';

Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$db = Database::getConnection();

// ---------------------------------------------------------------------------
// POST ?action=register-options — Get registration options (JWT required)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'register-options') {
    $payload = Auth::requireAuth();
    $userId  = Auth::userId($payload);

    // Fetch username for the registration options
    $stmt = $db->prepare("SELECT username FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        Response::error('User not found.', 404);
    }

    try {
        $options = webauthnRegisterOptions($db, $userId, $user['username']);
        Response::success($options);
    } catch (Exception $e) {
        Response::error('Failed to generate registration options: ' . $e->getMessage());
    }
}

// ---------------------------------------------------------------------------
// POST ?action=register-verify — Verify registration (JWT required)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'register-verify') {
    $payload = Auth::requireAuth();
    $userId  = Auth::userId($payload);
    $body    = Response::getBody();

    $clientDataJSON    = $body['clientDataJSON'] ?? '';
    $attestationObject = $body['attestationObject'] ?? '';
    $challengeId       = (int)($body['challengeId'] ?? 0);
    $name              = Response::sanitize($body['name'] ?? '');
    $transports        = $body['transports'] ?? [];

    if (!$clientDataJSON || !$attestationObject || !$challengeId) {
        Response::error('Missing required registration fields.');
    }

    try {
        $credData = webauthnVerifyRegistration(
            $db, $userId, $clientDataJSON, $attestationObject, $challengeId
        );
    } catch (Exception $e) {
        Response::error('Registration verification failed: ' . $e->getMessage());
    }

    // Generate a display name if not provided
    if (!$name) {
        $name = 'Passkey ' . date('Y-m-d H:i');
    }

    // Serialize transports for storage
    $transportsJson = is_array($transports) ? json_encode($transports) : '[]';

    // Store the credential
    $stmt = $db->prepare(
        "INSERT INTO user_credentials_webauthn
         (user_id, credential_id, public_key, sign_count, transports, name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NULL)"
    );
    $stmt->execute([
        $userId,
        $credData['credentialId'],
        $credData['publicKeyPem'],
        $credData['signCount'],
        $transportsJson,
        $name,
    ]);

    Response::success([
        'credentialId' => $credData['credentialId'],
        'name'         => $name,
        'message'      => 'Passkey registered successfully.',
    ], 201);
}

// ---------------------------------------------------------------------------
// POST ?action=auth-options — Get authentication options (NO auth required)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'auth-options') {
    // Shared login rate limit bucket (passkey + password attempts combined)
    Auth::enforceIpRateLimit($db, 'login', RATE_LIMIT_LOGIN_IP, RATE_LIMIT_LOGIN_IP_WINDOW);

    try {
        $options = webauthnAuthOptions($db);
        Response::success($options);
    } catch (Exception $e) {
        Response::error('Failed to generate authentication options: ' . $e->getMessage());
    }
}

// ---------------------------------------------------------------------------
// POST ?action=auth-verify — Verify authentication assertion (NO auth)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'auth-verify') {
    // Shared login rate limit bucket — record on failure below
    $loginIpHash = Auth::enforceIpRateLimit($db, 'login', RATE_LIMIT_LOGIN_IP, RATE_LIMIT_LOGIN_IP_WINDOW);

    $body = Response::getBody();

    $clientDataJSON    = $body['clientDataJSON'] ?? '';
    $authenticatorData = $body['authenticatorData'] ?? '';
    $signature         = $body['signature'] ?? '';
    $challengeId       = (int)($body['challengeId'] ?? 0);
    $credentialId      = $body['credentialId'] ?? '';

    if (!$clientDataJSON || !$authenticatorData || !$signature || !$challengeId || !$credentialId) {
        Response::error('Missing required authentication fields.');
    }

    try {
        $result = webauthnVerifyAuth(
            $db, $clientDataJSON, $authenticatorData, $signature, $challengeId, $credentialId
        );
    } catch (Exception $e) {
        Auth::recordRateLimit($db, 'login', $loginIpHash);
        Response::error('Authentication failed: ' . $e->getMessage(), 401);
    }

    // Check account lockout before issuing JWT
    Auth::enforceAccountLockout($db, (int)$result['user']['id']);

    Response::success([
        'token'      => $result['user']['token'],
        'user'       => [
            'id'                   => (int)$result['user']['id'],
            'username'             => $result['user']['username'],
            'email'                => $result['user']['email'],
            'role'                 => $result['user']['role'],
            'must_change_password' => !empty($result['user']['must_reset_password']),
        ],
        'expires_in' => $result['expires_in'],
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=list — List user's passkeys (JWT required)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'list') {
    $payload = Auth::requireAuth();
    $userId  = Auth::userId($payload);

    $stmt = $db->prepare(
        "SELECT id, credential_id, name, transports, created_at, last_used_at
         FROM user_credentials_webauthn
         WHERE user_id = ?
         ORDER BY created_at DESC"
    );
    $stmt->execute([$userId]);
    $passkeys = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Parse transports JSON and cast id
    foreach ($passkeys as &$pk) {
        $pk['id'] = (int)$pk['id'];
        $pk['transports'] = json_decode($pk['transports'] ?? '[]', true) ?: [];
    }
    unset($pk);

    Response::success($passkeys);
}

// ---------------------------------------------------------------------------
// POST ?action=rename — Rename a passkey (JWT required)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'rename') {
    $payload = Auth::requireAuth();
    $userId  = Auth::userId($payload);
    $body    = Response::getBody();

    $id   = (int)($body['id'] ?? 0);
    $name = Response::sanitize($body['name'] ?? '');

    if (!$id || !$name) {
        Response::error('Passkey ID and name are required.');
    }

    // Verify ownership
    $stmt = $db->prepare(
        "SELECT id FROM user_credentials_webauthn WHERE id = ? AND user_id = ?"
    );
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Passkey not found.', 404);
    }

    $stmt = $db->prepare(
        "UPDATE user_credentials_webauthn SET name = ? WHERE id = ? AND user_id = ?"
    );
    $stmt->execute([$name, $id, $userId]);

    Response::success(['message' => 'Passkey renamed.']);
}

// ---------------------------------------------------------------------------
// POST ?action=delete — Delete a passkey (JWT required)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'delete') {
    $payload = Auth::requireAuth();
    $userId  = Auth::userId($payload);
    $body    = Response::getBody();

    $id = (int)($body['id'] ?? 0);

    if (!$id) {
        Response::error('Passkey ID is required.');
    }

    // Verify ownership
    $stmt = $db->prepare(
        "SELECT id FROM user_credentials_webauthn WHERE id = ? AND user_id = ?"
    );
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Passkey not found.', 404);
    }

    $stmt = $db->prepare(
        "DELETE FROM user_credentials_webauthn WHERE id = ? AND user_id = ?"
    );
    $stmt->execute([$id, $userId]);

    Response::success(['message' => 'Passkey deleted.']);
}

// ---------------------------------------------------------------------------
// Fallback — Invalid endpoint
// ---------------------------------------------------------------------------
Response::error('Invalid endpoint.', 404);
