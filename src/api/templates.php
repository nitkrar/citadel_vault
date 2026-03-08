<?php
/**
 * Citadel Vault — Templates API
 *
 * Manages global and custom entry templates.
 * Global templates (owner_id = NULL) are visible to all users.
 * Custom templates (owner_id = user_id) are private to their creator.
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

// ---------------------------------------------------------------------------
// GET — All templates visible to user (global + own custom)
// ---------------------------------------------------------------------------
if ($method === 'GET' && !$action) {
    $templates = $storage->getTemplates($userId);
    Response::success($templates);
}

// ---------------------------------------------------------------------------
// POST ?action=create — Create custom template
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'create') {
    $body = Response::getBody();

    $templateKey = Response::sanitize($body['template_key'] ?? '');
    $name = Response::sanitize($body['name'] ?? '');

    if (empty($templateKey) || empty($name)) {
        Response::error('template_key and name are required.', 400);
    }

    if (empty($body['fields']) || !is_array($body['fields'])) {
        Response::error('fields must be a non-empty array.', 400);
    }

    $newId = $storage->createTemplate($userId, [
        'template_key'  => $templateKey,
        'name'          => $name,
        'icon'          => Response::sanitize($body['icon'] ?? null),
        'country_code'  => Response::sanitize($body['country_code'] ?? null),
        'subtype'       => Response::sanitize($body['subtype'] ?? null),
        'fields'        => json_encode($body['fields']),
    ]);

    Response::success(['id' => $newId], 201);
}

// ---------------------------------------------------------------------------
// PUT ?action=update&id=X — Update own custom template
// ---------------------------------------------------------------------------
if ($method === 'PUT' && $action === 'update' && $id) {
    $body = Response::getBody();

    $data = [];
    if (isset($body['name']))      $data['name'] = Response::sanitize($body['name']);
    if (isset($body['icon']))      $data['icon'] = Response::sanitize($body['icon']);
    if (isset($body['fields']))    $data['fields'] = json_encode($body['fields']);
    if (isset($body['is_active'])) $data['is_active'] = $body['is_active'] ? 1 : 0;

    if (empty($data)) {
        Response::error('No fields to update.', 400);
    }

    // Admins can edit global templates, regular users can only edit their own
    $isAdmin = $payload['role'] === 'admin';
    $updated = $storage->updateTemplate($userId, $id, $data);

    if (!$updated && $isAdmin) {
        // Try updating global template (owner_id IS NULL)
        $db = Database::getInstance();
        $fields = [];
        $values = [];
        $allowed = ['name', 'icon', 'fields', 'is_active'];
        foreach ($data as $k => $v) {
            if (in_array($k, $allowed, true)) { $fields[] = "`$k` = ?"; $values[] = $v; }
        }
        if (!empty($fields)) {
            $values[] = $id;
            $stmt = $db->prepare("UPDATE entry_templates SET " . implode(', ', $fields) . " WHERE id = ? AND owner_id IS NULL");
            $stmt->execute($values);
            $updated = $stmt->rowCount() > 0;
        }
    }

    if (!$updated) {
        Response::error('Template not found or not owned by you.', 404);
    }

    Response::success(['message' => 'Template updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=relink — Move entries from one template to another
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'relink') {
    $body = Response::getBody();
    $oldTemplateId = isset($body['old_template_id']) ? (int)$body['old_template_id'] : null;
    $newTemplateId = isset($body['new_template_id']) ? (int)$body['new_template_id'] : null;

    if (!$oldTemplateId || !$newTemplateId) {
        Response::error('old_template_id and new_template_id are required.', 400);
    }

    $db = Database::getInstance();
    $stmt = $db->prepare(
        "UPDATE vault_entries SET template_id = ? WHERE template_id = ? AND user_id = ?"
    );
    $stmt->execute([$newTemplateId, $oldTemplateId, $userId]);

    Response::success(['updated' => $stmt->rowCount()]);
}

// ---------------------------------------------------------------------------
// POST ?action=request-promotion&id=X — Request template promotion to global
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'request-promotion' && $id) {
    $db = Database::getInstance();

    // Verify ownership
    $stmt = $db->prepare("SELECT owner_id FROM entry_templates WHERE id = ?");
    $stmt->execute([$id]);
    $template = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$template || (int)$template['owner_id'] !== $userId) {
        Response::error('Template not found or not owned by you.', 404);
    }

    $stmt = $db->prepare(
        "UPDATE entry_templates SET promotion_requested = 1, promotion_requested_at = NOW() WHERE id = ?"
    );
    $stmt->execute([$id]);

    Response::success(['message' => 'Promotion requested.']);
}

// ---------------------------------------------------------------------------
// POST ?action=approve-promotion&id=X — Admin: approve template promotion
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'approve-promotion' && $id) {
    if ($payload['role'] !== 'admin') {
        Response::error('Admin access required.', 403);
    }

    $db = Database::getInstance();

    // Fetch the template
    $stmt = $db->prepare("SELECT * FROM entry_templates WHERE id = ? AND promotion_requested = 1");
    $stmt->execute([$id]);
    $template = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$template) {
        Response::error('Template not found or not pending promotion.', 404);
    }

    // Create a global copy (owner_id = NULL)
    $stmt = $db->prepare(
        "INSERT INTO entry_templates (template_key, owner_id, name, icon, country_code, subtype, schema_version, fields)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $template['template_key'],
        $template['name'],
        $template['icon'],
        $template['country_code'],
        $template['subtype'],
        $template['schema_version'],
        $template['fields'],
    ]);
    $globalId = (int)$db->lastInsertId();

    // Reset flag on the original
    $db->prepare(
        "UPDATE entry_templates SET promotion_requested = 0, promotion_requested_at = NULL WHERE id = ?"
    )->execute([$id]);

    Response::success(['global_template_id' => $globalId, 'message' => 'Template promoted to global.']);
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
