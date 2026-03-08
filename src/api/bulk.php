<?php
/**
 * Personal Vault — Bulk Operations API
 * Handles bulk update, create, and delete for all entity types.
 *
 * POST /bulk.php?action=update  — bulk update selected items
 * POST /bulk.php?action=create  — bulk create items
 * POST /bulk.php?action=delete  — bulk delete items
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';

Response::setCors();
$payload = Auth::requireAuth();
$dek = Encryption::requireDek();
$userId = $payload['sub'];
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$db = Database::getInstance();

if ($method !== 'POST') {
    Response::error('Only POST is allowed.', 405);
}

if (!in_array($action, ['update', 'create', 'delete'], true)) {
    Response::error('Invalid action. Use update, create, or delete.', 400);
}

$body = Response::getBody();
$entity = $body['entity'] ?? null;

// =============================================================================
// Entity Configuration Map
// =============================================================================
// dek_mode: 'raw' = use $dek directly, 'hex' = use bin2hex($dek)
// delete_mode: 'soft' = SET is_active=0, 'hard' = DELETE
// encrypted_fields: fields stored encrypted (text)
// encrypted_numeric_fields: fields stored as encrypted strings of numbers
// plain_fields: fields stored as-is
// nullable_fields: fields that can be set to NULL
// date_fields: fields that should be sanitized as dates
// active_filter: SQL fragment for active records (empty for hard-delete entities)
// =============================================================================
$entityConfigs = [
    'assets' => [
        'table' => 'assets',
        'dek_mode' => 'raw',
        'delete_mode' => 'soft',
        'encrypted_fields' => ['name', 'comments'],
        'encrypted_numeric_fields' => ['amount'],
        'encrypted_json_fields' => ['asset_data'],
        'plain_fields' => ['asset_type_id', 'currency_id', 'is_liquid', 'is_liability'],
        'nullable_fields' => ['account_id', 'country_id', 'comments', 'asset_data'],
        'date_fields' => [],
        'active_filter' => 'AND is_active = 1',
        'required_create' => ['name', 'asset_type_id', 'currency_id', 'amount'],
        'fk_validations' => [
            'account_id' => ['table' => 'accounts', 'active_filter' => 'AND is_active = 1'],
        ],
    ],
    'accounts' => [
        'table' => 'accounts',
        'dek_mode' => 'raw',
        'delete_mode' => 'soft',
        'encrypted_fields' => ['name', 'institution', 'customer_id', 'comments'],
        'encrypted_numeric_fields' => [],
        'encrypted_json_fields' => ['account_details'],
        'plain_fields' => ['account_type_id', 'subtype', 'country_id', 'currency_id'],
        'nullable_fields' => ['institution', 'subtype', 'country_id', 'customer_id', 'account_details', 'comments'],
        'date_fields' => [],
        'active_filter' => 'AND is_active = 1',
        'required_create' => ['name', 'account_type_id', 'currency_id'],
        'fk_validations' => [],
    ],
    'licenses' => [
        'table' => 'licenses',
        'dek_mode' => 'hex',
        'delete_mode' => 'hard',
        'encrypted_fields' => ['product_name', 'vendor'],
        'encrypted_numeric_fields' => [],
        'encrypted_json_fields' => [],
        'plain_fields' => ['seats', 'category'],
        'nullable_fields' => ['vendor', 'category'],
        // license_key and notes map to different DB columns
        'column_map' => [
            'license_key' => 'license_key_encrypted',
            'notes' => 'notes_encrypted',
        ],
        'extra_encrypted_fields' => ['license_key', 'notes'],
        'date_fields' => ['purchase_date', 'expiry_date'],
        'active_filter' => '',
        'required_create' => ['product_name'],
        'fk_validations' => [],
    ],
    'insurance' => [
        'table' => 'insurance_policies',
        'dek_mode' => 'raw',
        'delete_mode' => 'soft',
        'encrypted_fields' => ['policy_name', 'provider', 'policy_number', 'notes'],
        'encrypted_numeric_fields' => ['premium_amount', 'cash_value', 'coverage_amount'],
        'encrypted_json_fields' => [],
        'plain_fields' => ['payment_frequency', 'category'],
        'nullable_fields' => ['provider', 'policy_number', 'premium_amount', 'cash_value', 'coverage_amount', 'payment_frequency', 'notes'],
        'date_fields' => ['start_date', 'maturity_date'],
        'active_filter' => 'AND is_active = 1',
        'required_create' => ['policy_name'],
        'fk_validations' => [],
    ],
    'vault' => [
        'table' => 'password_vault',
        'dek_mode' => 'hex',
        'delete_mode' => 'hard',
        'encrypted_fields' => ['title', 'website_url'],
        'encrypted_numeric_fields' => [],
        'encrypted_json_fields' => [],
        'plain_fields' => ['category', 'is_favourite'],
        'nullable_fields' => ['website_url', 'category'],
        // username, password, notes map to different DB columns
        'column_map' => [
            'username' => 'username_encrypted',
            'password' => 'password_encrypted',
            'notes' => 'notes_encrypted',
        ],
        'extra_encrypted_fields' => ['username', 'password', 'notes'],
        'date_fields' => [],
        'active_filter' => '',
        'required_create' => ['title', 'password'],
        'fk_validations' => [],
    ],
];

if (!$entity || !isset($entityConfigs[$entity])) {
    Response::error('Invalid entity. Use: assets, accounts, licenses, insurance, vault.', 400);
}

$config = $entityConfigs[$entity];
$table = $config['table'];
$dekKey = $config['dek_mode'] === 'hex' ? bin2hex($dek) : $dek;

/**
 * Get the actual DB column name for a field, using column_map if defined.
 */
function getDbColumn(string $field, array $config): string {
    return $config['column_map'][$field] ?? $field;
}

/**
 * Check if a field is an encrypted field (text or numeric or extra).
 */
function isEncryptedField(string $field, array $config): bool {
    return in_array($field, $config['encrypted_fields'], true)
        || in_array($field, $config['encrypted_numeric_fields'] ?? [], true)
        || in_array($field, $config['extra_encrypted_fields'] ?? [], true);
}

/**
 * Check if a field is an encrypted numeric field.
 */
function isEncryptedNumeric(string $field, array $config): bool {
    return in_array($field, $config['encrypted_numeric_fields'] ?? [], true);
}

/**
 * Check if a field is an encrypted JSON field.
 */
function isEncryptedJson(string $field, array $config): bool {
    return in_array($field, $config['encrypted_json_fields'] ?? [], true);
}

/**
 * Get all valid updatable fields for the entity.
 */
function getAllFields(array $config): array {
    return array_merge(
        $config['encrypted_fields'],
        $config['encrypted_numeric_fields'] ?? [],
        $config['encrypted_json_fields'] ?? [],
        $config['extra_encrypted_fields'] ?? [],
        $config['plain_fields'],
        $config['nullable_fields'],
        $config['date_fields']
    );
}

/**
 * Build SET clause and params for a single item's fields.
 */
function buildUpdateParams(array $fields, array $config, string $dekKey): array {
    $setClauses = [];
    $params = [];
    $allValid = array_unique(getAllFields($config));

    foreach ($fields as $field => $value) {
        if (!in_array($field, $allValid, true)) {
            continue; // skip unknown fields
        }

        $dbCol = getDbColumn($field, $config);

        // Date fields
        if (in_array($field, $config['date_fields'], true)) {
            $setClauses[] = "$dbCol = ?";
            $params[] = Response::sanitizeDate($value);
            continue;
        }

        // Nullable handling
        $isNullable = in_array($field, $config['nullable_fields'], true);
        if ($value === null && $isNullable) {
            $setClauses[] = "$dbCol = NULL";
            continue;
        }

        // Encrypted JSON fields
        if (isEncryptedJson($field, $config)) {
            if ($value !== null) {
                $jsonStr = is_string($value) ? $value : json_encode($value);
                $setClauses[] = "$dbCol = ?";
                $params[] = Encryption::encrypt($jsonStr, $dekKey);
            } elseif ($isNullable) {
                $setClauses[] = "$dbCol = NULL";
            }
            continue;
        }

        // Encrypted numeric fields
        if (isEncryptedNumeric($field, $config)) {
            if ($value !== null && $value !== '') {
                $setClauses[] = "$dbCol = ?";
                $params[] = Encryption::encrypt((string)$value, $dekKey);
            } elseif ($isNullable) {
                $setClauses[] = "$dbCol = NULL";
            }
            continue;
        }

        // Encrypted text fields
        if (isEncryptedField($field, $config)) {
            $setClauses[] = "$dbCol = ?";
            $params[] = Encryption::encrypt($value, $dekKey);
            continue;
        }

        // Plain fields
        $setClauses[] = "$dbCol = ?";
        $params[] = $value;
    }

    return [$setClauses, $params];
}


// =============================================================================
// ACTION: UPDATE
// =============================================================================
// Supports two formats:
//   1. Per-item fields: { "entity": "...", "items": [{ "id": 1, "fields": {...} }, ...] }
//   2. Same fields for all: { "entity": "...", "ids": [1,2,3], "fields": {...} }
// =============================================================================
if ($action === 'update') {
    $items = $body['items'] ?? null;
    $ids = $body['ids'] ?? null;
    $sharedFields = $body['fields'] ?? null;

    // Normalise into items array
    if ($items !== null && is_array($items)) {
        // Format 1: per-item fields
        if (count($items) > 100) {
            Response::error('Maximum 100 items per request.', 400);
        }
    } elseif ($ids !== null && is_array($ids) && $sharedFields !== null && is_array($sharedFields)) {
        // Format 2: same fields for all IDs — convert to items format
        $items = array_map(fn($id) => ['id' => $id, 'fields' => $sharedFields], $ids);
        if (count($items) > 100) {
            Response::error('Maximum 100 items per request.', 400);
        }
    } else {
        Response::error('Provide either items array or ids+fields.', 400);
    }

    if (empty($items)) {
        Response::error('No items to update.', 400);
    }

    $results = [];
    $succeeded = 0;
    $failed = 0;

    $db->beginTransaction();
    try {
        foreach ($items as $item) {
            $id = (int)($item['id'] ?? 0);
            $itemFields = $item['fields'] ?? [];

            if (!$id || !is_array($itemFields) || empty($itemFields)) {
                $results[] = ['id' => $id, 'success' => false, 'error' => 'Missing id or fields.'];
                $failed++;
                continue;
            }

            try {
                // Verify ownership
                $checkStmt = $db->prepare(
                    "SELECT id FROM $table WHERE id = ? AND user_id = ? {$config['active_filter']}"
                );
                $checkStmt->execute([$id, $userId]);
                if (!$checkStmt->fetch()) {
                    $results[] = ['id' => $id, 'success' => false, 'error' => 'Not found or access denied.'];
                    $failed++;
                    continue;
                }

                // FK validations for this item's fields
                foreach ($config['fk_validations'] ?? [] as $fkField => $fkConfig) {
                    if (isset($itemFields[$fkField]) && $itemFields[$fkField] !== null) {
                        $fkStmt = $db->prepare(
                            "SELECT id FROM {$fkConfig['table']} WHERE id = ? AND user_id = ? {$fkConfig['active_filter']}"
                        );
                        $fkStmt->execute([(int)$itemFields[$fkField], $userId]);
                        if (!$fkStmt->fetch()) {
                            throw new \Exception("Invalid {$fkField}: not found or access denied.");
                        }
                    }
                }

                [$setClauses, $params] = buildUpdateParams($itemFields, $config, $dekKey);

                if (empty($setClauses)) {
                    $results[] = ['id' => $id, 'success' => false, 'error' => 'No valid fields to update.'];
                    $failed++;
                    continue;
                }

                $updateParams = array_merge($params, [$id, $userId]);
                $sql = "UPDATE $table SET " . implode(', ', $setClauses)
                     . " WHERE id = ? AND user_id = ?";
                $stmt = $db->prepare($sql);
                $stmt->execute($updateParams);

                $results[] = ['id' => $id, 'success' => true];
                $succeeded++;
            } catch (\Exception $e) {
                $results[] = ['id' => $id, 'success' => false, 'error' => $e->getMessage()];
                $failed++;
            }
        }
        $db->commit();
    } catch (\Exception $e) {
        $db->rollBack();
        Response::error('Bulk update failed: ' . $e->getMessage(), 500);
    }

    Response::success([
        'total' => count($items),
        'succeeded' => $succeeded,
        'failed' => $failed,
        'results' => $results,
    ]);
}

// =============================================================================
// ACTION: CREATE
// =============================================================================
if ($action === 'create') {
    $items = $body['items'] ?? [];

    if (!is_array($items) || empty($items)) {
        Response::error('items array is required.', 400);
    }
    if (count($items) > 100) {
        Response::error('Maximum 100 items per request.', 400);
    }

    $results = [];
    $succeeded = 0;
    $failed = 0;

    $db->beginTransaction();
    try {
        foreach ($items as $index => $item) {
            try {
                // Validate required fields
                foreach ($config['required_create'] as $reqField) {
                    if (!isset($item[$reqField]) || $item[$reqField] === '' || $item[$reqField] === null) {
                        throw new \Exception("Missing required field: $reqField");
                    }
                }

                // FK validations
                foreach ($config['fk_validations'] ?? [] as $fkField => $fkConfig) {
                    if (isset($item[$fkField]) && $item[$fkField] !== null && $item[$fkField] !== '') {
                        $fkStmt = $db->prepare(
                            "SELECT id FROM {$fkConfig['table']} WHERE id = ? AND user_id = ? {$fkConfig['active_filter']}"
                        );
                        $fkStmt->execute([(int)$item[$fkField], $userId]);
                        if (!$fkStmt->fetch()) {
                            throw new \Exception("Invalid {$fkField}: not found or access denied.");
                        }
                    }
                }

                // Build column list and values
                $columns = ['user_id'];
                $placeholders = ['?'];
                $values = [$userId];
                $allValid = array_unique(getAllFields($config));

                foreach ($item as $field => $value) {
                    if (!in_array($field, $allValid, true)) {
                        continue;
                    }

                    $dbCol = getDbColumn($field, $config);
                    $isNullable = in_array($field, $config['nullable_fields'], true);

                    // Date fields
                    if (in_array($field, $config['date_fields'], true)) {
                        $columns[] = $dbCol;
                        $placeholders[] = '?';
                        $values[] = Response::sanitizeDate($value);
                        continue;
                    }

                    // Null handling
                    if (($value === null || $value === '') && $isNullable) {
                        $columns[] = $dbCol;
                        $placeholders[] = 'NULL';
                        continue;
                    }

                    // Encrypted JSON fields
                    if (isEncryptedJson($field, $config)) {
                        $columns[] = $dbCol;
                        if ($value !== null) {
                            $jsonStr = is_string($value) ? $value : json_encode($value);
                            $placeholders[] = '?';
                            $values[] = Encryption::encrypt($jsonStr, $dekKey);
                        } else {
                            $placeholders[] = 'NULL';
                        }
                        continue;
                    }

                    // Encrypted numeric
                    if (isEncryptedNumeric($field, $config)) {
                        $columns[] = $dbCol;
                        if ($value !== null && $value !== '') {
                            $placeholders[] = '?';
                            $values[] = Encryption::encrypt((string)$value, $dekKey);
                        } else {
                            $placeholders[] = 'NULL';
                        }
                        continue;
                    }

                    // Encrypted text
                    if (isEncryptedField($field, $config)) {
                        $columns[] = $dbCol;
                        $placeholders[] = '?';
                        $values[] = Encryption::encrypt($value, $dekKey);
                        continue;
                    }

                    // Plain
                    $columns[] = $dbCol;
                    $placeholders[] = '?';
                    $values[] = $value;
                }

                $sql = "INSERT INTO $table (" . implode(', ', $columns) . ") VALUES (" . implode(', ', $placeholders) . ")";
                $stmt = $db->prepare($sql);
                $stmt->execute($values);

                $newId = (int)$db->lastInsertId();
                $results[] = ['index' => $index, 'success' => true, 'id' => $newId];
                $succeeded++;
            } catch (\Exception $e) {
                $results[] = ['index' => $index, 'success' => false, 'error' => $e->getMessage()];
                $failed++;
            }
        }
        $db->commit();
    } catch (\Exception $e) {
        $db->rollBack();
        Response::error('Bulk create failed: ' . $e->getMessage(), 500);
    }

    Response::success([
        'total' => count($items),
        'succeeded' => $succeeded,
        'failed' => $failed,
        'results' => $results,
    ]);
}

// =============================================================================
// ACTION: DELETE
// =============================================================================
if ($action === 'delete') {
    $ids = $body['ids'] ?? [];

    if (!is_array($ids) || empty($ids)) {
        Response::error('ids array is required.', 400);
    }
    if (count($ids) > 100) {
        Response::error('Maximum 100 items per request.', 400);
    }

    $results = [];
    $succeeded = 0;
    $failed = 0;

    $db->beginTransaction();
    try {
        foreach ($ids as $id) {
            $id = (int)$id;
            try {
                if ($config['delete_mode'] === 'soft') {
                    // Verify existence
                    $checkStmt = $db->prepare(
                        "SELECT id FROM $table WHERE id = ? AND user_id = ? {$config['active_filter']}"
                    );
                    $checkStmt->execute([$id, $userId]);
                    if (!$checkStmt->fetch()) {
                        $results[] = ['id' => $id, 'success' => false, 'error' => 'Not found or access denied.'];
                        $failed++;
                        continue;
                    }

                    $stmt = $db->prepare("UPDATE $table SET is_active = 0 WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $userId]);
                } else {
                    // Hard delete
                    $stmt = $db->prepare("DELETE FROM $table WHERE id = ? AND user_id = ?");
                    $stmt->execute([$id, $userId]);

                    if ($stmt->rowCount() === 0) {
                        $results[] = ['id' => $id, 'success' => false, 'error' => 'Not found.'];
                        $failed++;
                        continue;
                    }
                }

                $results[] = ['id' => $id, 'success' => true];
                $succeeded++;
            } catch (\Exception $e) {
                $results[] = ['id' => $id, 'success' => false, 'error' => 'Delete failed.'];
                $failed++;
            }
        }
        $db->commit();
    } catch (\Exception $e) {
        $db->rollBack();
        Response::error('Bulk delete failed: ' . $e->getMessage(), 500);
    }

    Response::success([
        'total' => count($ids),
        'succeeded' => $succeeded,
        'failed' => $failed,
        'results' => $results,
    ]);
}

Response::error('Invalid request.', 400);
