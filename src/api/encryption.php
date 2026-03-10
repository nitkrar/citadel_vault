<?php
/**
 * Citadel Vault — Encryption API (Client-Side Encryption)
 *
 * Blob pass-through: stores and retrieves opaque key material.
 * The server NEVER sees plaintext vault keys, DEKs, or data.
 * All crypto operations happen in the browser.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';
require_once __DIR__ . '/../core/Encryption.php';
Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$storage = Storage::adapter();

// ---------------------------------------------------------------------------
// GET ?action=key-material — Vault key blobs for unlock
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'key-material') {
    $payload = Auth::requireAuth();
    $keys = $storage->getVaultKeys($payload['sub']);

    if (!$keys || empty($keys['vault_key_salt'])) {
        Response::success([
            'has_vault_key' => false,
        ]);
    }

    Response::success([
        'has_vault_key'       => true,
        'vault_key_salt'      => $keys['vault_key_salt'],
        'encrypted_dek'       => $keys['encrypted_dek'],
        'must_reset_vault_key' => (bool)($keys['must_reset_vault_key'] ?? false),
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=recovery-material — Recovery blobs for recovery flow
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'recovery-material') {
    $payload = Auth::requireAuth();
    $keys = $storage->getVaultKeys($payload['sub']);

    if (!$keys || empty($keys['recovery_key_salt'])) {
        Response::error('No recovery key configured.', 404);
    }

    Response::success([
        'recovery_key_salt'      => $keys['recovery_key_salt'],
        'encrypted_dek_recovery' => $keys['encrypted_dek_recovery'],
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=recovery-key-encrypted — Encrypted recovery key (for viewing)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'recovery-key-encrypted') {
    $payload = Auth::requireAuth();
    $keys = $storage->getVaultKeys($payload['sub']);

    if (!$keys || empty($keys['recovery_key_encrypted'])) {
        Response::error('No recovery key configured.', 404);
    }

    Response::success([
        'recovery_key_encrypted' => $keys['recovery_key_encrypted'],
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=public-key — Get user's public key (for sharing)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'public-key') {
    $payload = Auth::requireAuth();
    $keys = $storage->getVaultKeys($payload['sub']);

    if (!$keys || empty($keys['public_key'])) {
        Response::error('Vault not set up.', 404);
    }

    Response::success([
        'public_key' => $keys['public_key'],
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=private-key-encrypted — Encrypted private key (for sharing decrypt)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'private-key-encrypted') {
    $payload = Auth::requireAuth();
    $keys = $storage->getVaultKeys($payload['sub']);

    if (!$keys || empty($keys['encrypted_private_key'])) {
        Response::error('Vault not set up.', 404);
    }

    Response::success([
        'encrypted_private_key' => $keys['encrypted_private_key'],
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=setup — First-time vault key setup (store all blobs)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'setup') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    // Check not already set up
    $existing = $storage->getVaultKeys($userId);
    if ($existing && !empty($existing['vault_key_salt'])) {
        Response::error('Vault already set up.', 400);
    }

    // Validate required fields
    $required = ['vault_key_salt', 'encrypted_dek', 'recovery_key_salt',
                  'encrypted_dek_recovery', 'recovery_key_encrypted',
                  'public_key', 'encrypted_private_key'];
    foreach ($required as $field) {
        if (empty($body[$field])) {
            Response::error("Missing required field: $field", 400);
        }
    }

    $storage->setVaultKeys($userId, [
        'vault_key_salt'         => $body['vault_key_salt'],
        'encrypted_dek'          => $body['encrypted_dek'],
        'recovery_key_salt'      => $body['recovery_key_salt'],
        'encrypted_dek_recovery' => $body['encrypted_dek_recovery'],
        'recovery_key_encrypted' => $body['recovery_key_encrypted'],
        'public_key'             => $body['public_key'],
        'encrypted_private_key'  => $body['encrypted_private_key'],
    ]);

    // Log security action
    $ipHash = Encryption::hashIp($_SERVER['REMOTE_ADDR'] ?? null);
    $storage->logAction($userId, 'vault_setup', null, null, $ipHash);

    Response::success(['message' => 'Vault configured.']);
}

// ---------------------------------------------------------------------------
// POST ?action=update-vault-key — Swap vault key blobs (vault key changed)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'update-vault-key') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    if (empty($body['vault_key_salt']) || empty($body['encrypted_dek'])) {
        Response::error('Missing vault_key_salt or encrypted_dek.', 400);
    }

    $storage->setVaultKeys($userId, [
        'vault_key_salt'       => $body['vault_key_salt'],
        'encrypted_dek'        => $body['encrypted_dek'],
        'must_reset_vault_key' => 0,
        'admin_action_message' => null,
    ]);

    $ipHash = Encryption::hashIp($_SERVER['REMOTE_ADDR'] ?? null);
    $storage->logAction($userId, 'vault_key_changed', null, null, $ipHash);

    Response::success(['message' => 'Vault key updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=update-recovery — Swap recovery blobs
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'update-recovery') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $required = ['recovery_key_salt', 'encrypted_dek_recovery', 'recovery_key_encrypted'];
    foreach ($required as $field) {
        if (empty($body[$field])) {
            Response::error("Missing required field: $field", 400);
        }
    }

    $storage->setVaultKeys($userId, [
        'recovery_key_salt'      => $body['recovery_key_salt'],
        'encrypted_dek_recovery' => $body['encrypted_dek_recovery'],
        'recovery_key_encrypted' => $body['recovery_key_encrypted'],
    ]);

    Response::success(['message' => 'Recovery key updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=update-all — Swap all vault key material (after recovery)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'update-all') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $required = ['vault_key_salt', 'encrypted_dek', 'recovery_key_salt',
                  'encrypted_dek_recovery', 'recovery_key_encrypted'];
    foreach ($required as $field) {
        if (empty($body[$field])) {
            Response::error("Missing required field: $field", 400);
        }
    }

    $storage->setVaultKeys($userId, [
        'vault_key_salt'         => $body['vault_key_salt'],
        'encrypted_dek'          => $body['encrypted_dek'],
        'recovery_key_salt'      => $body['recovery_key_salt'],
        'encrypted_dek_recovery' => $body['encrypted_dek_recovery'],
        'recovery_key_encrypted' => $body['recovery_key_encrypted'],
        'must_reset_vault_key'   => 0,
        'admin_action_message'   => null,
    ]);

    $ipHash = Encryption::hashIp($_SERVER['REMOTE_ADDR'] ?? null);
    $storage->logAction($userId, 'recovery_key_used', null, null, $ipHash);

    Response::success(['message' => 'All vault key material updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=setup-rsa — Generate RSA keys for sharing (for accounts without them)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'setup-rsa') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    if (empty($body['public_key']) || empty($body['encrypted_private_key'])) {
        Response::error('public_key and encrypted_private_key are required.', 400);
    }

    $storage->setVaultKeys($userId, [
        'public_key'             => $body['public_key'],
        'encrypted_private_key'  => $body['encrypted_private_key'],
    ]);

    Response::success(['message' => 'RSA keys configured.']);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
