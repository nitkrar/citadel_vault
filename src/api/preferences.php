<?php
/**
 * Citadel Vault — User Preferences API
 *
 * KV store for user settings. Defaults managed client-side in defaults.js.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';
require_once __DIR__ . '/../core/Encryption.php';

Response::setCors();

$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$method = $_SERVER['REQUEST_METHOD'];
$storage = Storage::adapter();

// ---------------------------------------------------------------------------
// GET — All preferences as key-value object
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $prefs = $storage->getPreferences($userId);
    Response::success($prefs);
}

// ---------------------------------------------------------------------------
// PUT — Upsert preferences { key: value, key: value }
// ---------------------------------------------------------------------------
if ($method === 'PUT') {
    $body = Response::getBody();

    if (empty($body)) {
        Response::error('No preferences provided.', 400);
    }

    $allowedKeys = [
        'vault_key_type', 'auto_lock_mode', 'auto_lock_timeout', 'audit_ip_mode',
        'vault_persist_session', 'display_currency', 'sync_interval', 'default_vault_tab',
    ];

    // Track if audit_ip_mode changed for security logging
    $ipModeChanged = false;
    $oldPrefs = null;

    if (isset($body['audit_ip_mode'])) {
        $oldPrefs = $storage->getPreferences($userId);
        $oldIpMode = $oldPrefs['audit_ip_mode'] ?? 'hashed';
        if ($body['audit_ip_mode'] !== $oldIpMode) {
            $ipModeChanged = true;
        }
    }

    foreach ($body as $key => $value) {
        if (!in_array($key, $allowedKeys, true)) {
            continue; // Skip unknown keys silently
        }
        $storage->setPreference($userId, $key, (string)$value);
    }

    // Log security action if IP mode changed
    if ($ipModeChanged) {
        $ipHash = Auth::clientIpHash();
        $storage->logAction($userId, 'audit_ip_mode_changed', null, null, $ipHash);
    }

    Response::success(['message' => 'Preferences updated.']);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
