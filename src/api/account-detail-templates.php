<?php
/**
 * Account Detail Templates API
 * Per-user and global templates for account detail field suggestions,
 * keyed on (user_id, account_type_id, subtype, country_id, is_global).
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$method = $_SERVER['REQUEST_METHOD'];

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
    $rows = Storage::adapter()->getAccountDetailTemplates($userId);

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
    }

    $id = Storage::adapter()->upsertAccountDetailTemplate($userId, [
        'account_type_id' => $accountTypeId,
        'subtype'         => $subtype,
        'country_id'      => $countryId,
        'field_keys'      => json_encode($fieldKeys),
        'scope'           => $scope,
    ]);

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
    $tpl = Storage::adapter()->getAccountDetailTemplate($id);

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

    Storage::adapter()->deleteAccountDetailTemplate($id);

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
