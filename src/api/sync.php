<?php
/**
 * Cross-Device Sync — Change Detection Endpoint
 * Returns which data categories have changed since a given timestamp.
 * Lightweight: single UNION ALL query against existing updated_at columns.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$storage = Storage::adapter();

$since = $_GET['since'] ?? null;
$pollInterval = (int)env('SYNC_POLL_INTERVAL', 900);

// If no since provided, return current server time as baseline
if (!$since) {
    Response::success([
        'changes'       => false,
        'categories'    => [],
        'server_time'   => gmdate('Y-m-d\TH:i:s\Z'),
        'poll_interval' => $pollInterval,
    ]);
}

// Validate timestamp format
$sinceTime = strtotime($since);
if ($sinceTime === false) {
    Response::error('Invalid since timestamp.', 400);
}
$sinceFormatted = gmdate('Y-m-d H:i:s', $sinceTime);

// Check MAX(updated_at) per category via adapter
$categories = [
    ['name' => 'vault_entries',  'method' => fn() => $storage->getMaxEntryUpdatedAt($userId)],
    ['name' => 'currencies',     'method' => fn() => $storage->getLastCurrencyUpdate()],
    ['name' => 'countries',      'method' => fn() => $storage->getMaxCountryUpdatedAt()],
    ['name' => 'templates',      'method' => fn() => $storage->getMaxTemplateUpdatedAt($userId)],
];

$changed = [];
foreach ($categories as $cat) {
    try {
        $maxTime = ($cat['method'])();
        if ($maxTime && $maxTime > $sinceFormatted) {
            $changed[] = $cat['name'];
        }
    } catch (Exception $e) {
        // Skip category if table doesn't exist or query fails
    }
}

Response::success([
    'changes'       => count($changed) > 0,
    'categories'    => $changed,
    'server_time'   => gmdate('Y-m-d\TH:i:s\Z'),
    'poll_interval' => $pollInterval,
]);
