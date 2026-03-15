<?php
/**
 * Citadel Vault — Portfolio Snapshots API
 *
 * Store and retrieve encrypted portfolio snapshots.
 * Uses split model (v3): header meta + per-entry encrypted blobs.
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
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — List snapshots with entries
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $from = Response::sanitizeDate($_GET['from'] ?? null);
    $to = Response::sanitizeDate($_GET['to'] ?? null);

    $snapshots = $storage->getSnapshotsWithEntries($userId, $from, $to);

    $result = array_map(function ($s) {
        return [
            'snapshot_date' => $s['snapshot_date'],
            'snapshot_time' => $s['snapshot_time'] ?? null,
            'data'          => $s['encrypted_data'],
            'entries'       => $s['entries'] ?? [],
        ];
    }, $snapshots);

    Response::success($result);
}

// ---------------------------------------------------------------------------
// POST — Save new snapshot (split model)
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    $body = Response::getBody();
    $date = Response::sanitizeDate($body['snapshot_date'] ?? null);

    if (!$date) {
        Response::error('Valid snapshot_date (YYYY-MM-DD) is required.', 400);
    }

    $encryptedMeta = $body['encrypted_meta'] ?? '';
    $entries = $body['entries'] ?? [];

    if (empty($encryptedMeta)) {
        Response::error('Missing encrypted_meta.', 400);
    }
    if (!is_array($entries) || empty($entries)) {
        Response::error('entries must be a non-empty array.', 400);
    }

    // Validate each entry has encrypted_data
    foreach ($entries as $entry) {
        if (empty($entry['encrypted_data'])) {
            Response::error('Each entry must have encrypted_data.', 400);
        }
    }

    $storage->createSnapshotWithEntries($userId, $date, $encryptedMeta, $entries);
    Response::success(['message' => 'Snapshot saved.'], 201);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
