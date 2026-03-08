<?php
/**
 * Personal Vault V2 — Users API
 * User management (admin only) and simple user listing.
 * Sharing is now handled by sharing.php via shared_items table.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Mailer.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = $payload['sub'];
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$action = $_GET['action'] ?? '';
$db = Database::getConnection();

// =============================================================================
// GET
// =============================================================================
if ($method === 'GET') {

    // List active users for sharing dropdowns (any user)
    if ($action === 'list-simple') {
        $stmt = $db->prepare(
            "SELECT id, username FROM users WHERE is_active = 1 AND id != ? ORDER BY username"
        );
        $stmt->execute([$userId]);
        Response::success($stmt->fetchAll());
    }

    // List all users (admin only)
    if (!$action && !$id) {
        if (!$isSiteAdmin) {
            Response::error('Admin access required.', 403);
        }

        $stmt = $db->query(
            "SELECT id, username, display_name, email, role, is_active, created_at FROM users ORDER BY id"
        );
        Response::success($stmt->fetchAll());
    }
}

// =============================================================================
// POST — Create user (admin only)
// =============================================================================
if ($method === 'POST') {
    if (!$isSiteAdmin) {
        Response::error('Admin access required.', 403);
    }

    $body = Response::getBody();
    $username = Response::sanitize($body['username'] ?? null);
    $email    = Response::sanitize($body['email'] ?? null);
    $password = $body['password'] ?? null;
    $role     = $body['role'] ?? 'user';

    if (!$username || !$email || !$password) {
        Response::error('username, email, and password are required.', 400);
    }
    if (strlen($password) < 8) {
        Response::error('Password must be at least 8 characters.', 400);
    }
    if (!in_array($role, ['admin', 'user'], true)) {
        Response::error('Invalid role.', 400);
    }

    $passwordHash = Auth::hashPassword($password);

    $stmt = $db->prepare(
        "INSERT INTO users (username, email, password_hash, role, must_reset_password) VALUES (?, ?, ?, ?, 1)"
    );

    try {
        $stmt->execute([$username, $email, $passwordHash, $role]);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            Response::error('Username or email already exists.', 409);
        }
        throw $e;
    }

    $newId = (int)$db->lastInsertId();

    // Send welcome email with credentials
    $emailSent = false;
    if (defined('SMTP_ENABLED') && SMTP_ENABLED && $email) {
        $origin = defined('WEBAUTHN_ORIGIN') ? WEBAUTHN_ORIGIN : 'http://localhost:8080';
        $result = Mailer::sendWelcome($email, $username, $password, $origin);
        $emailSent = $result['success'];
    }

    Response::success(['id' => $newId, 'email_sent' => $emailSent], 201);
}

// =============================================================================
// PUT — Update user / Admin actions
// =============================================================================
if ($method === 'PUT') {
    if (!$id) {
        Response::error('User ID is required.', 400);
    }

    // --- Admin action: force-reset-password (set temp password) ---
    if ($action === 'force-reset-password') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        $body = Response::getBody();
        $newPassword = $body['password'] ?? '';
        $message = $body['message'] ?? null;
        if (strlen($newPassword) < 8) { Response::error('Password must be at least 8 characters.', 400); }

        $stmt = $db->prepare("UPDATE users SET password_hash = ?, must_reset_password = 1 WHERE id = ?");
        $stmt->execute([Auth::hashPassword($newPassword), $id]);
        Response::success(['message' => 'Password reset. User will be forced to change on next login.']);
    }

    // --- Admin action: force-change-password (no temp password, just force change) ---
    if ($action === 'force-change-password') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        $body = Response::getBody();
        $message = $body['message'] ?? null;

        $stmt = $db->prepare("UPDATE users SET must_reset_password = 1 WHERE id = ?");
        $stmt->execute([$id]);
        Response::success(['message' => 'User will be forced to change their password on next login.']);
    }

    // --- Admin action: force-reset-vault (safe — preserves data) ---
    if ($action === 'force-reset-vault') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        $body = Response::getBody();
        $message = $body['message'] ?? null;

        // must_reset_vault_key is on user_vault_keys table, not users
        $stmt = $db->prepare("UPDATE user_vault_keys SET must_reset_vault_key = 1 WHERE user_id = ?");
        $stmt->execute([$id]);
        Response::success(['message' => 'User will be forced to change their vault key on next session.']);
    }

    // --- Standard user update ---
    if (!$isSiteAdmin && $id !== $userId) {
        Response::error('Access denied.', 403);
    }

    $body = Response::getBody();
    if (empty($body)) {
        Response::error('No fields to update.', 400);
    }

    $setClauses = [];
    $params = [];

    if (isset($body['username'])) { $setClauses[] = "username = ?"; $params[] = Response::sanitize($body['username']); }
    if (isset($body['email'])) { $setClauses[] = "email = ?"; $params[] = Response::sanitize($body['email']); }

    if (isset($body['password'])) {
        if (strlen($body['password']) < 8) { Response::error('Password must be at least 8 characters.', 400); }
        $setClauses[] = "password_hash = ?";
        $params[] = Auth::hashPassword($body['password']);
    }

    if (isset($body['role'])) {
        if (!$isSiteAdmin) { Response::error('Only admins can change roles.', 403); }
        if (!in_array($body['role'], ['admin', 'user'], true)) { Response::error('Invalid role.', 400); }
        $setClauses[] = "role = ?";
        $params[] = $body['role'];
    }

    if (array_key_exists('is_active', $body)) {
        if (!$isSiteAdmin) { Response::error('Only admins can change active status.', 403); }
        $setClauses[] = "is_active = ?";
        $params[] = (int)$body['is_active'];
    }

    if (empty($setClauses)) { Response::error('No valid fields to update.', 400); }

    $params[] = $id;
    $sql = "UPDATE users SET " . implode(', ', $setClauses) . " WHERE id = ?";
    $stmt = $db->prepare($sql);

    try {
        $stmt->execute($params);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) { Response::error('Username or email already exists.', 409); }
        throw $e;
    }

    Response::success(['id' => $id]);
}

// =============================================================================
// DELETE — Delete user (admin only)
// =============================================================================
if ($method === 'DELETE') {
    if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
    if (!$id) { Response::error('User ID is required.', 400); }
    if ($id === $userId) { Response::error('Cannot delete your own account.', 400); }

    $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$id]);

    if ($stmt->rowCount() === 0) { Response::error('User not found.', 404); }

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
