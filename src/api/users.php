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
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();
$payload = Auth::requireAuth();
$userId = Auth::userId($payload);
$isSiteAdmin = $payload['role'] === 'admin';
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int)$_GET['id'] : null;
$action = $_GET['action'] ?? '';
$adapter = Storage::adapter();

// =============================================================================
// GET
// =============================================================================
if ($method === 'GET') {

    // List active users for sharing dropdowns (any user)
    if ($action === 'list-simple') {
        Response::success($adapter->getActiveUsersSimple($userId));
    }

    // List all users (admin only)
    if (!$action && !$id) {
        if (!$isSiteAdmin) {
            Response::error('Admin access required.', 403);
        }

        Response::success($adapter->getAllUsersWithVaultKeyStatus());
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
    $username    = Response::sanitize($body['username'] ?? null);
    $displayName = Response::sanitize($body['display_name'] ?? null);
    $email       = Response::sanitize($body['email'] ?? null);
    $password    = $body['password'] ?? null;
    $role        = $body['role'] ?? 'user';

    if (!$username || !$email || !$password) {
        Response::error('username, email, and password are required.', 400);
    }
    Auth::validatePassword($password);
    if (!in_array($role, ['admin', 'user'], true)) {
        Response::error('Invalid role.', 400);
    }

    $passwordHash = Auth::hashPassword($password);

    try {
        $newId = $adapter->createUserByAdmin([
            'username'      => $username,
            'display_name'  => $displayName,
            'email'         => $email,
            'password_hash' => $passwordHash,
            'role'          => $role,
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            Response::error('Username or email already exists.', 409);
        }
        throw $e;
    }

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
        Auth::validatePassword($newPassword);

        $adapter->updateUser($id, [
            'password_hash'       => Auth::hashPassword($newPassword),
            'must_reset_password' => 1,
        ]);
        Response::success(['message' => 'Password reset. User will be forced to change on next login.']);
    }

    // --- Admin action: force-change-password (no temp password, just force change) ---
    if ($action === 'force-change-password') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        $body = Response::getBody();
        $message = $body['message'] ?? null;

        $adapter->updateUser($id, ['must_reset_password' => 1]);
        Response::success(['message' => 'User will be forced to change their password on next login.']);
    }

    // --- Admin action: force-reset-vault (safe — preserves data) ---
    if ($action === 'force-reset-vault') {
        if (!$isSiteAdmin) { Response::error('Admin access required.', 403); }
        $body = Response::getBody();
        $message = $body['message'] ?? null;

        // must_reset_vault_key is on user_vault_keys table, not users
        $adapter->setVaultKeys($id, [
            'must_reset_vault_key'  => 1,
            'admin_action_message'  => $message,
        ]);
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

    $updateFields = [];

    if (isset($body['username'])) { $updateFields['username'] = Response::sanitize($body['username']); }
    if (isset($body['email'])) { $updateFields['email'] = Response::sanitize($body['email']); }

    if (isset($body['password'])) {
        Auth::validatePassword($body['password']);
        $updateFields['password_hash'] = Auth::hashPassword($body['password']);
    }

    if (isset($body['role'])) {
        if (!$isSiteAdmin) { Response::error('Only admins can change roles.', 403); }
        if (!in_array($body['role'], ['admin', 'user'], true)) { Response::error('Invalid role.', 400); }
        if ($id === $userId && $body['role'] !== 'admin') { Response::error('Cannot demote your own admin account.', 400); }
        $updateFields['role'] = $body['role'];
    }

    if (array_key_exists('is_active', $body)) {
        if (!$isSiteAdmin) { Response::error('Only admins can change active status.', 403); }
        if ($id === $userId && !$body['is_active']) { Response::error('Cannot deactivate your own account.', 400); }
        $updateFields['is_active'] = (int)$body['is_active'];
    }

    if (empty($updateFields)) { Response::error('No valid fields to update.', 400); }

    try {
        $adapter->updateUser($id, $updateFields);
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

    $deleted = $adapter->deleteUser($id);

    if (!$deleted) { Response::error('User not found.', 404); }

    Response::success(['id' => $id]);
}

Response::error('Invalid request.', 400);
