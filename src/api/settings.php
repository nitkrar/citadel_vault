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
$userId = Auth::userId($payload);
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$storage = Storage::adapter();

// ---------------------------------------------------------------------------
// GET — All system settings with metadata (enriched)
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $settings = $storage->getSystemSettingsEnriched();
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

    // Validate against existing DB keys (no hardcoded allowlist)
    $existingKeys = array_keys($storage->getSystemSettings());

    $updated = 0;
    foreach ($body as $key => $value) {
        if (!in_array($key, $existingKeys, true)) {
            continue;
        }
        $storage->setSystemSetting($key, (string)$value, $userId);
        $updated++;
    }

    if ($updated === 0) {
        Response::error('No valid settings provided.', 400);
    }

    // Audit log
    $ipHash = Auth::clientIpHash();
    $storage->logAction($userId, 'system_setting_changed', null, null, $ipHash);

    Response::success(['message' => "Updated {$updated} setting(s)."]);
}

// ---------------------------------------------------------------------------
// POST ?action=cleanup — Purge stale security data (admin only)
// ---------------------------------------------------------------------------
if ($method === 'POST' && ($_GET['action'] ?? null) === 'cleanup') {
    if (!$isSiteAdmin) {
        Response::error('Admin access required.', 403);
    }

    $db = Database::getInstance();
    $purged = [];

    // Rate limits — older than 7 days (windows are 1hr max, stale data is useless)
    $stmt = $db->prepare("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL 7 DAY");
    $stmt->execute();
    $purged['rate_limits'] = $stmt->rowCount();

    // Invite requests — rejected/ignored older than 30 days
    $stmt = $db->prepare("DELETE FROM invite_requests WHERE status IN ('rejected','ignored') AND created_at < NOW() - INTERVAL 30 DAY");
    $stmt->execute();
    $purged['invite_requests'] = $stmt->rowCount();

    // Audit log — high-volume operational entries older than 30 days
    // Keeps security events (vault_*, account_locked_*, login) for 90 days
    $stmt = $db->prepare(
        "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL 30 DAY
         AND action IN ('share_created', 'share_revoked', 'system_setting_changed')"
    );
    $stmt->execute();
    $purged['audit_log_operational'] = $stmt->rowCount();

    $stmt = $db->prepare(
        "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL 90 DAY"
    );
    $stmt->execute();
    $purged['audit_log_old'] = $stmt->rowCount();

    Response::success([
        'message' => 'Cleanup complete.',
        'purged' => $purged,
    ]);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Method not allowed.', 405);
