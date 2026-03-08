<?php
/**
 * Citadel Vault — Portfolio Snapshots API
 *
 * Store and retrieve encrypted portfolio snapshots.
 * Snapshots are point-in-time records, manually saved by the user.
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
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — List snapshots in date range
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $from = Response::sanitizeDate($_GET['from'] ?? null);
    $to = Response::sanitizeDate($_GET['to'] ?? null);

    $snapshots = $storage->getSnapshots($userId, $from, $to);

    // Strip IDs per design doc — return only date + data
    $result = array_map(function ($s) {
        return [
            'snapshot_date' => $s['snapshot_date'],
            'snapshot_time' => $s['snapshot_time'] ?? null,
            'data'          => $s['encrypted_data'],
        ];
    }, $snapshots);

    Response::success($result);
}

// ---------------------------------------------------------------------------
// POST — Save new snapshot
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    $body = Response::getBody();
    $date = Response::sanitizeDate($body['snapshot_date'] ?? null);
    $encryptedData = $body['encrypted_data'] ?? '';

    if (!$date) {
        Response::error('Valid snapshot_date (YYYY-MM-DD) is required.', 400);
    }
    if (empty($encryptedData)) {
        Response::error('Missing encrypted_data.', 400);
    }

    $storage->createSnapshot($userId, $date, $encryptedData);
    Response::success(['message' => 'Snapshot saved.'], 201);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
