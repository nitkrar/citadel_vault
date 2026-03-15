<?php
/**
 * Citadel Vault — System Settings API
 *
 * Global KV store for admin-configurable app settings.
 * GET  — Any authenticated user can read all settings.
 * PUT  — Admin only. Upsert settings from { key: value } body.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';
require_once __DIR__ . '/../core/Encryption.php';

Response::setCors();

$payload = Auth::requireAuth();
$userId = $payload['sub'];
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$storage = Storage::adapter();

// Allowlist of valid setting keys
$allowedKeys = ['ticker_price_ttl', 'default_vault_tab', 'auth_check_interval', 'self_registration', 'require_email_verification', 'invite_expiry_days', 'lockout_tier3_duration', 'worker_enabled', 'worker_threshold'];

// ---------------------------------------------------------------------------
// GET — All system settings as key-value object
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $settings = $storage->getSystemSettings();
    Response::success($settings);
}

// ---------------------------------------------------------------------------
// PUT — Upsert system settings (admin only)
// ---------------------------------------------------------------------------
if ($method === 'PUT') {
    if (!$isSiteAdmin) {
        Response::error('Admin access required.', 403);
    }

    $body = Response::getBody();

    if (empty($body)) {
        Response::error('No settings provided.', 400);
    }

    $updated = 0;
    foreach ($body as $key => $value) {
        if (!in_array($key, $allowedKeys, true)) {
            continue;
        }
        $storage->setSystemSetting($key, (string)$value, $userId);
        $updated++;
    }

    if ($updated === 0) {
        Response::error('No valid settings provided.', 400);
    }

    // Audit log
    $ipHash = Encryption::hashIp($_SERVER['REMOTE_ADDR'] ?? null);
    $storage->logAction($userId, 'system_setting_changed', null, null, $ipHash);

    Response::success(['message' => "Updated {$updated} setting(s)."]);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Method not allowed.', 405);
