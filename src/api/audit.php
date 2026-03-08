<?php
/**
 * Citadel Vault — Audit Log API
 *
 * Security-only audit log. Logs actions like login, vault unlock, key changes.
 * Never logs entry CRUD, snapshots, or preference changes.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();

$payload = Auth::requireAuth();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$storage = Storage::adapter();

// ---------------------------------------------------------------------------
// GET — User's security log (optional date range)
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $from = Response::sanitizeDate($_GET['from'] ?? null);
    $to = Response::sanitizeDate($_GET['to'] ?? null);

    $log = $storage->getAuditLog($userId, $from, $to);

    // Return action + timestamp only. No IPs (they're hashed, useless to display).
    $result = array_map(function ($entry) {
        return [
            'action'     => $entry['action'],
            'created_at' => $entry['created_at'],
        ];
    }, $log);

    Response::success($result);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
