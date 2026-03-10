<?php
/**
 * Citadel Vault — Vault Entries API (Client-Side Encryption)
 *
 * Unified CRUD for all entry types. The server stores opaque encrypted blobs.
 * Replaces: accounts.php, assets.php, licenses.php, insurance.php, vault.php (old).
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();

$payload = Auth::requireAuth();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$storage = Storage::adapter();

$validTypes = ['password', 'account', 'asset', 'license', 'insurance', 'custom'];

// ---------------------------------------------------------------------------
// GET ?action=counts — Entry counts by type (for dashboard, no blobs)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'counts') {
    $entries = $storage->getEntries($userId);
    $counts = array_fill_keys($validTypes, 0);
    foreach ($entries as $entry) {
        $type = $entry['entry_type'];
        if (isset($counts[$type])) {
            $counts[$type]++;
        }
    }
    Response::success($counts);
}

// ---------------------------------------------------------------------------
// GET ?action=deleted — List soft-deleted entries
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'deleted') {
    $db = Database::getInstance();
    $stmt = $db->prepare(
        "SELECT ve.id, ve.entry_type, ve.encrypted_data, ve.deleted_at, ve.created_at, ve.updated_at,
                et.name AS template_name, et.icon AS template_icon, et.fields AS template_fields
         FROM vault_entries ve
         LEFT JOIN entry_templates et ON ve.template_id = et.id
         WHERE ve.user_id = ? AND ve.deleted_at IS NOT NULL
           AND ve.deleted_at >= NOW() - INTERVAL 1 DAY
         ORDER BY ve.deleted_at DESC"
    );
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $result = array_map(function ($row) {
        $template = null;
        if ($row['template_name']) {
            $template = [
                'name'   => $row['template_name'],
                'icon'   => $row['template_icon'],
                'fields' => json_decode($row['template_fields'], true) ?? [],
            ];
        }
        return [
            'id'             => (int)$row['id'],
            'entry_type'     => $row['entry_type'],
            'template'       => $template,
            'data'           => $row['encrypted_data'],
            'deleted_at'     => $row['deleted_at'],
            'created_at'     => $row['created_at'],
            'updated_at'     => $row['updated_at'],
        ];
    }, $rows);

    Response::success($result);
}

// ---------------------------------------------------------------------------
// GET ?id=X — Single entry
// ---------------------------------------------------------------------------
if ($method === 'GET' && $id) {
    $entry = $storage->getEntry($userId, $id);
    if (!$entry) {
        Response::error('Entry not found.', 404);
    }

    Response::success([
        'id'         => (int)$entry['id'],
        'entry_type' => $entry['entry_type'],
        'template'   => $entry['template'] ?? null,
        'data'       => $entry['encrypted_data'],
        'created_at' => $entry['created_at'],
        'updated_at' => $entry['updated_at'],
    ]);
}

// ---------------------------------------------------------------------------
// GET — List entries (optional ?type= filter)
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $typeFilter = $_GET['type'] ?? null;
    if ($typeFilter && !in_array($typeFilter, $validTypes, true)) {
        Response::error("Invalid type filter: $typeFilter", 400);
    }

    $entries = $storage->getEntries($userId, $typeFilter);
    $result = array_map(function ($entry) {
        return [
            'id'         => (int)$entry['id'],
            'entry_type' => $entry['entry_type'],
            'template'   => $entry['template'] ?? null,
            'data'       => $entry['encrypted_data'],
            'created_at' => $entry['created_at'],
            'updated_at' => $entry['updated_at'],
        ];
    }, $entries);

    Response::success($result);
}

// ---------------------------------------------------------------------------
// POST ?action=restore&id=X — Restore soft-deleted entry
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'restore' && $id) {
    $db = Database::getInstance();
    $stmt = $db->prepare(
        "UPDATE vault_entries SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL"
    );
    $stmt->execute([$id, $userId]);

    if ($stmt->rowCount() === 0) {
        Response::error('Entry not found or not deleted.', 404);
    }

    Response::success(['message' => 'Entry restored.']);
}

// ---------------------------------------------------------------------------
// POST ?action=bulk-create — Batch insert entries
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'bulk-create') {
    $body = Response::getBody();
    $entries = $body['entries'] ?? [];

    if (!is_array($entries) || empty($entries)) {
        Response::error('No entries provided.', 400);
    }

    $ids = [];
    foreach ($entries as $entry) {
        $type = $entry['entry_type'] ?? '';
        if (!in_array($type, $validTypes, true)) {
            Response::error("Invalid entry type: $type", 400);
        }
        if (empty($entry['encrypted_data'])) {
            Response::error('Missing encrypted_data.', 400);
        }
        $ids[] = $storage->createEntry(
            $userId,
            $type,
            $entry['encrypted_data'],
            isset($entry['template_id']) ? (int)$entry['template_id'] : null
        );
    }

    Response::success(['ids' => $ids, 'count' => count($ids)]);
}

// ---------------------------------------------------------------------------
// POST ?action=bulk-update — Batch update entries
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'bulk-update') {
    $body = Response::getBody();
    $entries = $body['entries'] ?? [];

    if (!is_array($entries) || empty($entries)) {
        Response::error('No entries provided.', 400);
    }

    $updated = 0;
    foreach ($entries as $entry) {
        if (empty($entry['id']) || empty($entry['encrypted_data'])) {
            Response::error('Each entry requires id and encrypted_data.', 400);
        }
        $bulkType = $entry['entry_type'] ?? null;
        $bulkTpl  = isset($entry['template_id']) ? (int)$entry['template_id'] : null;
        if ($storage->updateEntry($userId, (int)$entry['id'], $entry['encrypted_data'], $bulkType, $bulkTpl)) {
            $updated++;
        }
    }

    Response::success(['updated' => $updated]);
}

// ---------------------------------------------------------------------------
// POST — Create single entry
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    $body = Response::getBody();
    $entryType = $body['entry_type'] ?? '';
    $encryptedData = $body['encrypted_data'] ?? '';
    $templateId = isset($body['template_id']) ? (int)$body['template_id'] : null;

    if (!in_array($entryType, $validTypes, true)) {
        Response::error("Invalid entry type: $entryType", 400);
    }
    if (empty($encryptedData)) {
        Response::error('Missing encrypted_data.', 400);
    }

    $newId = $storage->createEntry($userId, $entryType, $encryptedData, $templateId);
    Response::success(['id' => $newId], 201);
}

// ---------------------------------------------------------------------------
// PUT ?id=X — Update entry
// ---------------------------------------------------------------------------
if ($method === 'PUT' && $id) {
    $body = Response::getBody();
    $encryptedData = $body['encrypted_data'] ?? '';

    if (empty($encryptedData)) {
        Response::error('Missing encrypted_data.', 400);
    }

    $entryType  = $body['entry_type'] ?? null;
    $templateId = isset($body['template_id']) ? (int)$body['template_id'] : null;

    if ($entryType !== null && !in_array($entryType, $validTypes, true)) {
        Response::error("Invalid entry type: $entryType", 400);
    }

    if (!$storage->updateEntry($userId, $id, $encryptedData, $entryType, $templateId)) {
        Response::error('Entry not found.', 404);
    }

    Response::success(['message' => 'Entry updated.']);
}

// ---------------------------------------------------------------------------
// DELETE ?id=X — Soft delete entry
// ---------------------------------------------------------------------------
if ($method === 'DELETE' && $id) {
    // Check share count first to warn client
    $db = Database::getInstance();
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM shared_items WHERE source_entry_id = ? AND sender_id = ?"
    );
    $stmt->execute([$id, $userId]);
    $shareCount = (int)$stmt->fetchColumn();

    if (!$storage->deleteEntry($userId, $id)) {
        Response::error('Entry not found.', 404);
    }

    Response::success([
        'message'     => 'Entry deleted.',
        'share_count' => $shareCount,
    ]);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
