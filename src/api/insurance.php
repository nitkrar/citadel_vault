<?php
/**
 * Personal Vault V2 — Insurance Policies API
 * CRUD for insurance policies with encryption.
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
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$db = Database::getInstance();

// =============================================================================
// Helper: Decrypt insurance fields
// =============================================================================
function decryptInsuranceFields(array $row, string $dek): array {
    $row['policy_name']     = Encryption::decrypt($row['policy_name'] ?? null, $dek);
    $row['provider']        = Encryption::decrypt($row['provider'] ?? null, $dek);
    $row['policy_number']   = Encryption::decrypt($row['policy_number'] ?? null, $dek);
    $row['notes']           = Encryption::decrypt($row['notes'] ?? null, $dek);

    $premium = Encryption::decrypt($row['premium_amount'] ?? null, $dek);
    $row['premium_amount'] = $premium !== null ? (float)$premium : null;

    $cashValue = Encryption::decrypt($row['cash_value'] ?? null, $dek);
    $row['cash_value'] = $cashValue !== null ? (float)$cashValue : null;

    $coverage = Encryption::decrypt($row['coverage_amount'] ?? null, $dek);
    $row['coverage_amount'] = $coverage !== null ? (float)$coverage : null;

    return $row;
}

// =============================================================================
// GET — List or single policy
// =============================================================================
if ($method === 'GET') {

    if ($id !== null) {
        $stmt = $db->prepare("SELECT * FROM insurance_policies WHERE id = ? AND user_id = ? AND is_active = 1");
        $stmt->execute([$id, $userId]);
        $row = $stmt->fetch();
        if (!$row) {
            Response::error('Policy not found.', 404);
        }
        Response::success(decryptInsuranceFields($row, $dek));
    }

    $stmt = $db->prepare("SELECT * FROM insurance_policies WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC");
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll();

    $policies = [];
    foreach ($rows as $row) {
        $policies[] = decryptInsuranceFields($row, $dek);
    }
    Response::success($policies);
}

// =============================================================================
// POST — Create
// =============================================================================
if ($method === 'POST') {
    $body = Response::getBody();

    $policyName = $body['policy_name'] ?? null;
    if (!$policyName) {
        Response::error('Policy name is required.', 400);
    }

    $encPolicyName  = Encryption::encrypt($policyName, $dek);
    $encProvider    = Encryption::encrypt($body['provider'] ?? null, $dek);
    $encPolicyNum   = Encryption::encrypt($body['policy_number'] ?? null, $dek);
    $encPremium     = isset($body['premium_amount']) ? Encryption::encrypt((string)$body['premium_amount'], $dek) : null;
    $encCashValue   = isset($body['cash_value']) ? Encryption::encrypt((string)$body['cash_value'], $dek) : null;
    $encCoverage    = isset($body['coverage_amount']) ? Encryption::encrypt((string)$body['coverage_amount'], $dek) : null;
    $encNotes       = Encryption::encrypt($body['notes'] ?? null, $dek);

    $startDate        = Response::sanitizeDate($body['start_date'] ?? null);
    $maturityDate     = Response::sanitizeDate($body['maturity_date'] ?? null);
    $paymentFrequency = $body['payment_frequency'] ?? null;
    $category         = $body['category'] ?? 'Life';

    $stmt = $db->prepare(
        "INSERT INTO insurance_policies
            (user_id, policy_name, provider, policy_number, premium_amount,
             cash_value, coverage_amount, start_date, maturity_date,
             payment_frequency, category, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $userId, $encPolicyName, $encProvider, $encPolicyNum, $encPremium,
        $encCashValue, $encCoverage, $startDate, $maturityDate,
        $paymentFrequency, $category, $encNotes
    ]);

    $newId = (int)$db->lastInsertId();
    Response::success(['id' => $newId], 201);
}

// =============================================================================
// PUT — Update
// =============================================================================
if ($method === 'PUT') {
    if (!$id) {
        Response::error('Policy ID is required.', 400);
    }

    $stmt = $db->prepare("SELECT id FROM insurance_policies WHERE id = ? AND user_id = ? AND is_active = 1");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Policy not found or access denied.', 404);
    }

    $body = Response::getBody();
    if (empty($body)) {
        Response::error('No fields to update.', 400);
    }

    $setClauses = [];
    $params = [];

    // Encrypted text fields
    $encTextFields = ['policy_name', 'provider', 'policy_number', 'notes'];
    foreach ($encTextFields as $field) {
        if (array_key_exists($field, $body)) {
            if ($body[$field] !== null) {
                $setClauses[] = "$field = ?";
                $params[] = Encryption::encrypt($body[$field], $dek);
            } else {
                $setClauses[] = "$field = NULL";
            }
        }
    }

    // Encrypted numeric fields
    $encNumFields = ['premium_amount', 'cash_value', 'coverage_amount'];
    foreach ($encNumFields as $field) {
        if (array_key_exists($field, $body)) {
            if ($body[$field] !== null) {
                $setClauses[] = "$field = ?";
                $params[] = Encryption::encrypt((string)$body[$field], $dek);
            } else {
                $setClauses[] = "$field = NULL";
            }
        }
    }

    // Date fields — sanitize to valid YYYY-MM-DD or null
    foreach (['start_date', 'maturity_date'] as $field) {
        if (array_key_exists($field, $body)) {
            $setClauses[] = "$field = ?";
            $params[] = Response::sanitizeDate($body[$field]);
        }
    }

    // Other plain fields
    foreach (['payment_frequency', 'category'] as $field) {
        if (array_key_exists($field, $body)) {
            $setClauses[] = "$field = ?";
            $params[] = $body[$field];
        }
    }

    if (empty($setClauses)) {
        Response::error('No valid fields to update.', 400);
    }

    $params[] = $id;
    $params[] = $userId;
    $sql = "UPDATE insurance_policies SET " . implode(', ', $setClauses) . " WHERE id = ? AND user_id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    Response::success(['id' => $id]);
}

// =============================================================================
// DELETE — Soft-delete
// =============================================================================
if ($method === 'DELETE') {
    if (!$id) {
        Response::error('Policy ID is required.', 400);
    }

    $stmt = $db->prepare("SELECT id FROM insurance_policies WHERE id = ? AND user_id = ? AND is_active = 1");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Policy not found or access denied.', 404);
    }

    $stmt = $db->prepare("UPDATE insurance_policies SET is_active = 0 WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
