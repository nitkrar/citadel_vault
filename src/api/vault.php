<?php
/**
 * Personal Vault — Password Vault API
 * CRUD for encrypted password entries.
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
// GET — List all entries or fetch a single entry
// ---------------------------------------------------------------------------
if ($method === 'GET') {
    $dekHex = bin2hex($dek);

    // Single entry
    if ($id) {
        $stmt = $db->prepare("SELECT * FROM password_vault WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $userId]);
        $entry = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$entry) {
            Response::error('Entry not found.', 404);
        }

        // Decrypt ALL fields for single-entry view
        $entry['title']    = Encryption::decrypt($entry['title'], $dekHex);
        $entry['website_url'] = Encryption::decrypt($entry['website_url'], $dekHex);
        $entry['username'] = Encryption::decrypt($entry['username_encrypted'], $dekHex);
        $entry['password'] = Encryption::decrypt($entry['password_encrypted'], $dekHex);
        $entry['notes']    = Encryption::decrypt($entry['notes_encrypted'], $dekHex);

        // Remove raw encrypted columns from response
        unset($entry['username_encrypted'], $entry['password_encrypted'], $entry['notes_encrypted']);

        Response::success($entry);
    }

    // List all entries (passwords excluded for security)
    $stmt = $db->prepare("SELECT * FROM password_vault WHERE user_id = ? ORDER BY is_favourite DESC, title ASC");
    $stmt->execute([$userId]);
    $entries = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($entries as &$entry) {
        // Decrypt only title and website_url for the list view
        $entry['title']       = Encryption::decrypt($entry['title'], $dekHex);
        $entry['website_url'] = Encryption::decrypt($entry['website_url'], $dekHex);

        // Remove sensitive encrypted columns from list response
        unset($entry['username_encrypted'], $entry['password_encrypted'], $entry['notes_encrypted']);
    }
    unset($entry);

    Response::success($entries);
}

// ---------------------------------------------------------------------------
// POST — Create a new password entry
// ---------------------------------------------------------------------------
if ($method === 'POST') {
    $body = Response::getBody();
    $dekHex = bin2hex($dek);

    $title       = Response::sanitize($body['title'] ?? null);
    $websiteUrl  = Response::sanitize($body['website_url'] ?? null);
    $username    = $body['username'] ?? null;
    $password    = $body['password'] ?? null;
    $notes       = $body['notes'] ?? null;
    $category    = Response::sanitize($body['category'] ?? 'General');
    $isFavourite = !empty($body['is_favourite']) ? 1 : 0;

    // Validate required fields
    if (!$title || $title === '') {
        Response::error('Title is required.', 400);
    }
    if (!$password || $password === '') {
        Response::error('Password is required.', 400);
    }

    // Encrypt fields
    $encTitle      = Encryption::encrypt($title, $dekHex);
    $encWebsiteUrl = Encryption::encrypt($websiteUrl, $dekHex);
    $encUsername    = Encryption::encrypt($username, $dekHex);
    $encPassword   = Encryption::encrypt($password, $dekHex);
    $encNotes      = Encryption::encrypt($notes, $dekHex);

    $stmt = $db->prepare(
        "INSERT INTO password_vault (user_id, title, website_url, username_encrypted, password_encrypted, notes_encrypted, category, is_favourite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->execute([
        $userId,
        $encTitle,
        $encWebsiteUrl,
        $encUsername,
        $encPassword,
        $encNotes,
        $category,
        $isFavourite,
    ]);

    $newId = (int)$db->lastInsertId();

    Response::success(['id' => $newId], 201);
}

// ---------------------------------------------------------------------------
// PUT — Update an existing password entry
// ---------------------------------------------------------------------------
if ($method === 'PUT') {
    if (!$id) {
        Response::error('Entry ID is required.', 400);
    }

    // Verify ownership
    $stmt = $db->prepare("SELECT id FROM password_vault WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        Response::error('Entry not found.', 404);
    }

    $body = Response::getBody();
    $dekHex = bin2hex($dek);

    // Build dynamic update
    $fields = [];
    $values = [];

    if (array_key_exists('title', $body)) {
        $title = Response::sanitize($body['title']);
        if (!$title || $title === '') {
            Response::error('Title cannot be empty.', 400);
        }
        $fields[] = 'title = ?';
        $values[] = Encryption::encrypt($title, $dekHex);
    }

    if (array_key_exists('website_url', $body)) {
        $fields[] = 'website_url = ?';
        $values[] = Encryption::encrypt(Response::sanitize($body['website_url']), $dekHex);
    }

    if (array_key_exists('username', $body)) {
        $fields[] = 'username_encrypted = ?';
        $values[] = Encryption::encrypt($body['username'], $dekHex);
    }

    if (array_key_exists('password', $body)) {
        if ($body['password'] === null || $body['password'] === '') {
            Response::error('Password cannot be empty.', 400);
        }
        $fields[] = 'password_encrypted = ?';
        $values[] = Encryption::encrypt($body['password'], $dekHex);
    }

    if (array_key_exists('notes', $body)) {
        $fields[] = 'notes_encrypted = ?';
        $values[] = Encryption::encrypt($body['notes'], $dekHex);
    }

    if (array_key_exists('category', $body)) {
        $fields[] = 'category = ?';
        $values[] = Response::sanitize($body['category']) ?? 'General';
    }

    if (array_key_exists('is_favourite', $body)) {
        $fields[] = 'is_favourite = ?';
        $values[] = !empty($body['is_favourite']) ? 1 : 0;
    }

    if (empty($fields)) {
        Response::error('No fields to update.', 400);
    }

    $values[] = $id;
    $values[] = $userId;

    $sql = "UPDATE password_vault SET " . implode(', ', $fields) . " WHERE id = ? AND user_id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($values);

    Response::success(['id' => $id]);
}

// ---------------------------------------------------------------------------
// DELETE — Hard-delete a password entry
// ---------------------------------------------------------------------------
if ($method === 'DELETE') {
    if (!$id) {
        Response::error('Entry ID is required.', 400);
    }

    // Verify ownership and delete
    $stmt = $db->prepare("DELETE FROM password_vault WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);

    if ($stmt->rowCount() === 0) {
        Response::error('Entry not found.', 404);
    }

    Response::success(['message' => 'Entry deleted.']);
}

// ---------------------------------------------------------------------------
// Fallback — Invalid request method
// ---------------------------------------------------------------------------
Response::error('Invalid request.', 400);
