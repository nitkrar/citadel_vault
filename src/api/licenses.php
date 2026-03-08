<?php
/**
 * Personal Vault — Licenses API
 * CRUD for encrypted software license entries.
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

// ---------------------------------------------------------------------------
// GET — List all licenses or fetch a single license
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $dekHex = bin2hex($dek);

    // Single license
    if ($id) {
        $stmt = $db->prepare("SELECT * FROM licenses WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $userId]);
        $entry = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$entry) {
            Response::error('License not found.', 404);
        }

        // Decrypt ALL fields for single-entry view
        $entry['product_name'] = Encryption::decrypt($entry['product_name'], $dekHex);
        $entry['vendor']       = Encryption::decrypt($entry['vendor'], $dekHex);
        $entry['license_key']  = Encryption::decrypt($entry['license_key_encrypted'], $dekHex);
        $entry['notes']        = Encryption::decrypt($entry['notes_encrypted'], $dekHex);

        // Remove raw encrypted columns from response
        unset($entry['license_key_encrypted'], $entry['notes_encrypted']);

        Response::success($entry);
    }

    // List all licenses (license_key and notes excluded for security)
    $stmt = $db->prepare("SELECT * FROM licenses WHERE user_id = ? ORDER BY product_name ASC");
    $stmt->execute([$userId]);
    $entries = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($entries as &$entry) {
        // Decrypt only product_name and vendor for the list view
        $entry['product_name'] = Encryption::decrypt($entry['product_name'], $dekHex);
        $entry['vendor']       = Encryption::decrypt($entry['vendor'], $dekHex);

        // Remove sensitive encrypted columns from list response
        unset($entry['license_key_encrypted'], $entry['notes_encrypted']);
    }
    unset($entry);

    Response::success($entries);
}

// ---------------------------------------------------------------------------
// POST — Create a new license entry
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    $body = Response::getBody();
    $dekHex = bin2hex($dek);

    $productName  = Response::sanitize($body['product_name'] ?? null);
    $vendor       = Response::sanitize($body['vendor'] ?? null);
    $licenseKey   = $body['license_key'] ?? null;
    $purchaseDate = Response::sanitizeDate($body['purchase_date'] ?? null);
    $expiryDate   = Response::sanitizeDate($body['expiry_date'] ?? null);
    $seats        = isset($body['seats']) ? (int)$body['seats'] : 1;
    $notes        = $body['notes'] ?? null;
    $category     = Response::sanitize($body['category'] ?? 'Software');

    // Validate required fields
    if (!$productName || $productName === '') {
        Response::error('Product name is required.', 400);
    }

    // Encrypt fields
    $encProductName = Encryption::encrypt($productName, $dekHex);
    $encVendor      = Encryption::encrypt($vendor, $dekHex);
    $encLicenseKey  = Encryption::encrypt($licenseKey, $dekHex);
    $encNotes       = Encryption::encrypt($notes, $dekHex);

    $stmt = $db->prepare(
        "INSERT INTO licenses (user_id, product_name, vendor, license_key_encrypted, purchase_date, expiry_date, seats, notes_encrypted, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $userId,
        $encProductName,
        $encVendor,
        $encLicenseKey,
        $purchaseDate,
        $expiryDate,
        $seats,
        $encNotes,
        $category,
    ]);

    $newId = (int)$db->lastInsertId();

    Response::success(['id' => $newId], 201);
}

// ---------------------------------------------------------------------------
// PUT — Update an existing license entry
// ---------------------------------------------------------------------------
if ($method === 'PUT') {
    if (!$id) {
        Response::error('License ID is required.', 400);
    }

    // Verify ownership
    $stmt = $db->prepare("SELECT id FROM licenses WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('License not found.', 404);
    }

    $body = Response::getBody();
    $dekHex = bin2hex($dek);

    // Build dynamic update
    $fields = [];
    $values = [];

    if (array_key_exists('product_name', $body)) {
        $productName = Response::sanitize($body['product_name']);
        if (!$productName || $productName === '') {
            Response::error('Product name cannot be empty.', 400);
        }
        $fields[] = 'product_name = ?';
        $values[] = Encryption::encrypt($productName, $dekHex);
    }

    if (array_key_exists('vendor', $body)) {
        $fields[] = 'vendor = ?';
        $values[] = Encryption::encrypt(Response::sanitize($body['vendor']), $dekHex);
    }

    if (array_key_exists('license_key', $body)) {
        $fields[] = 'license_key_encrypted = ?';
        $values[] = Encryption::encrypt($body['license_key'], $dekHex);
    }

    if (array_key_exists('purchase_date', $body)) {
        $fields[] = 'purchase_date = ?';
        $values[] = Response::sanitizeDate($body['purchase_date']);
    }

    if (array_key_exists('expiry_date', $body)) {
        $fields[] = 'expiry_date = ?';
        $values[] = Response::sanitizeDate($body['expiry_date']);
    }

    if (array_key_exists('seats', $body)) {
        $fields[] = 'seats = ?';
        $values[] = (int)$body['seats'];
    }

    if (array_key_exists('notes', $body)) {
        $fields[] = 'notes_encrypted = ?';
        $values[] = Encryption::encrypt($body['notes'], $dekHex);
    }

    if (array_key_exists('category', $body)) {
        $fields[] = 'category = ?';
        $values[] = Response::sanitize($body['category']) ?? 'Software';
    }

    if (empty($fields)) {
        Response::error('No fields to update.', 400);
    }

    $values[] = $id;
    $values[] = $userId;

    $sql = "UPDATE licenses SET " . implode(', ', $fields) . " WHERE id = ? AND user_id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($values);

    Response::success(['id' => $id]);
}

// ---------------------------------------------------------------------------
// DELETE — Hard-delete a license entry
// ---------------------------------------------------------------------------
if ($method === 'DELETE') {
    if (!$id) {
        Response::error('License ID is required.', 400);
    }

    // Verify ownership and delete
    $stmt = $db->prepare("DELETE FROM licenses WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);

    if ($stmt->rowCount() === 0) {
        Response::error('License not found.', 404);
    }

    Response::success(['message' => 'License deleted.']);
}

// ---------------------------------------------------------------------------
// Fallback — Invalid request method
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
