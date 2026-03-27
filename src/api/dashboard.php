<?php
/**
 * Citadel Vault — Dashboard API
 *
 * Zero-decryption dashboard stats. Counts from DB, timestamps from audit log.
 * Also serves page notices from config/notices.json.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();

$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$storage = Storage::adapter();

// ---------------------------------------------------------------------------
// GET ?action=stats — Dashboard statistics (zero blob data)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'stats') {
    $db = Database::getInstance();

    // Entry counts by type
    $stmt = $db->prepare(
        "SELECT entry_type, COUNT(*) as cnt
         FROM vault_entries
         WHERE user_id = ? AND deleted_at IS NULL
         GROUP BY entry_type"
    );
    $stmt->execute([$userId]);
    $entryCounts = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $entryCounts[$row['entry_type']] = (int)$row['cnt'];
    }

    // Shared with me count
    $stmt = $db->prepare("SELECT COUNT(*) FROM shared_items WHERE recipient_id = ?");
    $stmt->execute([$userId]);
    $sharedWithMeCount = (int)$stmt->fetchColumn();

    // Last login and last vault unlock from audit log
    $lastLogin = null;
    $lastVaultUnlock = null;
    try {
        $stmt = $db->prepare(
            "SELECT MAX(created_at) FROM audit_log WHERE user_id = ? AND action = 'login'"
        );
        $stmt->execute([$userId]);
        $lastLogin = $stmt->fetchColumn() ?: null;

        $stmt = $db->prepare(
            "SELECT MAX(created_at) FROM audit_log WHERE user_id = ? AND action = 'vault_unlock'"
        );
        $stmt->execute([$userId]);
        $lastVaultUnlock = $stmt->fetchColumn() ?: null;
    } catch (Exception $e) {
        // audit_log may not exist yet
    }

    Response::success([
        'entry_counts'        => $entryCounts,
        'shared_with_me_count' => $sharedWithMeCount,
        'last_login'          => $lastLogin,
        'last_vault_unlock'   => $lastVaultUnlock,
    ]);
}

// ---------------------------------------------------------------------------
// GET ?action=page-notices — Global page notices from config file
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'page-notices') {
    $noticesFile = __DIR__ . '/../../config/notices.json';
    if (file_exists($noticesFile)) {
        $content = file_get_contents($noticesFile);
        $notices = json_decode($content, true) ?? [];
    } else {
        $notices = [];
    }
    Response::success($notices);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
