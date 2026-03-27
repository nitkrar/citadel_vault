<?php
/**
 * Cross-Device Sync — Change Detection Endpoint
 * Returns which data categories have changed since a given timestamp.
 * Lightweight: single UNION ALL query against existing updated_at columns.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$db = Database::getInstance();

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

// Single query: check MAX(updated_at) per category
$categories = [
    ['name' => 'vault_entries',  'sql' => "SELECT MAX(updated_at) FROM vault_entries WHERE user_id = ?",   'params' => [$userId]],
    ['name' => 'currencies',     'sql' => "SELECT MAX(last_updated) FROM currencies",                      'params' => []],
    ['name' => 'countries',      'sql' => "SELECT MAX(updated_at) FROM countries",                         'params' => []],
    ['name' => 'templates',      'sql' => "SELECT MAX(updated_at) FROM entry_templates WHERE owner_id IS NULL OR owner_id = ?", 'params' => [$userId]],
];

$changed = [];
foreach ($categories as $cat) {
    try {
        $stmt = $db->prepare($cat['sql']);
        $stmt->execute($cat['params']);
        $maxTime = $stmt->fetchColumn();
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
