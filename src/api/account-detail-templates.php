<?php
/**
 * Account Detail Templates API
 * Per-user and global templates for account detail field suggestions,
 * keyed on (user_id, account_type_id, subtype, country_id, is_global).
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$method = $_SERVER['REQUEST_METHOD'];
$db = Database::getInstance();

/**
 * Standardize a field key for consistent storage.
 * Splits camelCase, replaces all non-alphanumeric with underscore, lowercases.
 * "Sort Code", "sort-code", "sortCode", "sort_code" all become "sort_code".
 */
function standardizeKey(string $key): string {
    $key = trim($key);
    // Insert underscore at camelCase boundaries
    $key = preg_replace('/([a-z])([A-Z])/', '$1_$2', $key);
    // Replace all non-alphanumeric characters with underscores
    $key = preg_replace('/[^a-zA-Z0-9]+/', '_', $key);
    $key = strtolower($key);
    // Collapse multiple underscores and trim leading/trailing
    $key = preg_replace('/_+/', '_', $key);
    return trim($key, '_');
}

// =============================================================================
// GET — List personal templates + global templates
// =============================================================================
if ($method === 'GET') {
    $stmt = $db->prepare(
        "SELECT id, user_id, account_type_id, subtype, country_id,
                IFNULL(is_global, 0) AS is_global, field_keys
         FROM account_detail_templates
         WHERE user_id = ? OR (IFNULL(is_global, 0) = 1)
         ORDER BY is_global ASC, updated_at DESC"
    );
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll();

    $templates = [];
    foreach ($rows as $row) {
        $row['account_type_id'] = (int)$row['account_type_id'];
        $row['country_id'] = (int)$row['country_id'];
        $row['id'] = (int)$row['id'];
        $row['is_global'] = (int)$row['is_global'];
        $row['field_keys'] = json_decode($row['field_keys'], true) ?: [];
        unset($row['user_id']);
        $templates[] = $row;
    }

    Response::success($templates);
}

// =============================================================================
// POST — Save / upsert a template (personal or global)
// =============================================================================
if ($method === 'POST') {
    $body = Response::getBody();

    $accountTypeId = isset($body['account_type_id']) ? (int)$body['account_type_id'] : null;
    $subtype       = $body['subtype'] ?? '';
    $countryId     = isset($body['country_id']) ? (int)$body['country_id'] : null;
    $fieldKeys     = $body['field_keys'] ?? null;
    $scope         = $body['scope'] ?? 'personal';

    if (!$accountTypeId) {
        Response::error('Account type is required.', 400);
    }
    if (!$countryId) {
        Response::error('Country is required.', 400);
    }
    if (!is_array($fieldKeys) || count($fieldKeys) === 0) {
        Response::error('field_keys must be a non-empty array of strings.', 400);
    }

    // Filter to non-empty strings and normalize to snake_case
    $fieldKeys = array_values(array_filter(
        array_map(function ($k) {
            return is_string($k) ? standardizeKey($k) : '';
        }, $fieldKeys),
        function ($k) { return $k !== ''; }
    ));
    if (count($fieldKeys) === 0) {
        Response::error('field_keys must contain at least one non-empty string.', 400);
    }
    // Deduplicate while preserving order
    $fieldKeys = array_values(array_unique($fieldKeys));

    if ($scope === 'global') {
        // Only admins can save global templates
        if (($payload['role'] ?? '') !== 'admin') {
            Response::error('Only admins can save global templates.', 403);
        }

        // Check if a global row already exists for this combo
        $stmt = $db->prepare(
            "SELECT id FROM account_detail_templates
             WHERE user_id = 0 AND account_type_id = ? AND subtype = ? AND country_id = ? AND IFNULL(is_global, 0) = 1"
        );
        $stmt->execute([$accountTypeId, $subtype, $countryId]);
        $existing = $stmt->fetch();

        if ($existing) {
            // Admin overwrites existing global template
            $stmt = $db->prepare(
                "UPDATE account_detail_templates SET field_keys = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            );
            $stmt->execute([json_encode($fieldKeys), (int)$existing['id']]);
            $id = (int)$existing['id'];
        } else {
            // New global template
            $stmt = $db->prepare(
                "INSERT INTO account_detail_templates
                    (user_id, account_type_id, subtype, country_id, is_global, field_keys)
                 VALUES (0, ?, ?, ?, 1, ?)"
            );
            $stmt->execute([$accountTypeId, $subtype, $countryId, json_encode($fieldKeys)]);
            $id = (int)$db->lastInsertId();
        }
    } else {
        // Personal template: user_id = actual user, is_global = 0
        $fieldKeysJson = json_encode($fieldKeys);

        $stmt = $db->prepare(
            "INSERT INTO account_detail_templates
                (user_id, account_type_id, subtype, country_id, is_global, field_keys)
             VALUES (?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE field_keys = VALUES(field_keys), updated_at = CURRENT_TIMESTAMP"
        );
        $stmt->execute([$userId, $accountTypeId, $subtype, $countryId, $fieldKeysJson]);
        $id = (int)$db->lastInsertId();
    }

    Response::success(['id' => $id], 201);
}

// =============================================================================
// DELETE — Remove a template (ownership check or admin for global)
// =============================================================================
if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : null;
    if (!$id) {
        Response::error('Template ID is required.', 400);
    }

    // Look up the template to check ownership / global status
    $stmt = $db->prepare("SELECT id, user_id, IFNULL(is_global, 0) AS is_global FROM account_detail_templates WHERE id = ?");
    $stmt->execute([$id]);
    $tpl = $stmt->fetch();

    if (!$tpl) {
        Response::error('Template not found.', 404);
    }

    if ((int)$tpl['is_global'] === 1) {
        // Global templates can only be deleted by admins
        if (($payload['role'] ?? '') !== 'admin') {
            Response::error('Only admins can delete global templates.', 403);
        }
    } else {
        // Personal templates: must be owned by the current user
        if ((int)$tpl['user_id'] !== (int)$userId) {
            Response::error('Template not found or access denied.', 404);
        }
    }

    $stmt = $db->prepare("DELETE FROM account_detail_templates WHERE id = ?");
    $stmt->execute([$id]);

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
