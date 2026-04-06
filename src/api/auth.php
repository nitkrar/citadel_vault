<?php
/**
 * Personal Vault — Authentication API
 * Handles login, registration, profile, and password management.
 */
require_once __DIR__ . '/../core/Response.php';
require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../core/Auth.php';
require_once __DIR__ . '/../core/Encryption.php';
require_once __DIR__ . '/../core/ExchangeRates.php';
require_once __DIR__ . '/../core/Mailer.php';
require_once __DIR__ . '/../core/Storage.php';

Response::setCors();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
// Load registration settings from system_settings, falling back to .env constants
$selfRegistration = SELF_REGISTRATION;
$requireEmailVerification = REQUIRE_EMAIL_VERIFICATION;
try {
    $storage = Storage::adapter();
    $sr = $storage->getSystemSetting('self_registration');
    $ev = $storage->getSystemSetting('require_email_verification');
    if ($sr !== null) $selfRegistration = filter_var($sr, FILTER_VALIDATE_BOOLEAN);
    if ($ev !== null) $requireEmailVerification = filter_var($ev, FILTER_VALIDATE_BOOLEAN);
} catch (Exception $e) {}

// ---------------------------------------------------------------------------
// GET ?action=registration-status — Public: check if self-registration is open
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'registration-status') {
    $inviteRequestsEnabled = false;
    $sr = $storage->getSystemSetting('invite_requests_enabled');
    if ($sr !== null) $inviteRequestsEnabled = ($sr === 'true');

    Response::success([
        'self_registration' => $selfRegistration,
        'require_email_verification' => $requireEmailVerification,
        'invite_requests_enabled' => $inviteRequestsEnabled,
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=login — Authenticate user and return JWT
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'login') {
    $body = Response::getBody();
    $username = Response::sanitize($body['username'] ?? '');
    $password = $body['password'] ?? '';

    if (!$username || !$password) {
        Response::error('Username and password are required.');
    }

    // --- IP-based rate limiting (cross-account credential stuffing protection) ---
    $loginIpHash = Auth::enforceIpRateLimit('login', RATE_LIMIT_LOGIN_IP, RATE_LIMIT_LOGIN_IP_WINDOW);

    $user = Storage::adapter()->getUserByIdentifier($username);

    // --- Account lockout check (before password verification) ---
    if ($user) {
        Auth::enforceAccountLockout((int)$user['id']);
    }

    // --- Verify credentials ---
    if (!$user || !Auth::verifyPassword($password, $user['password_hash'])) {
        if ($user) {
            Auth::recordFailedLogin((int)$user['id'], $user['username']);
        }
        Auth::recordRateLimit('login', $loginIpHash);
        Response::error('Invalid credentials.', 401);
    }

    if (!$user['is_active']) {
        Response::error('Account has been deactivated.', 403);
    }

    // --- Successful login: reset lockout counters ---
    Auth::resetLoginLockout((int)$user['id']);

    // Check email verification (DB migration resilience)
    if ($requireEmailVerification) {
        try {
            $emailVerified = Storage::adapter()->getEmailVerifiedStatus((int)$user['id']);
            if ($emailVerified === false) {
                Response::error('Please verify your email address before signing in. Check your inbox for the verification link.', 403);
            }
        } catch (Exception $e) {
            // Column may not exist — skip check
        }
    }

    // Check must_reset_password from users, must_reset_vault_key from user_vault_keys
    $mustChangePassword = (bool)($user['must_reset_password'] ?? false);
    $mustChangeVaultKey = false;
    $adminActionMessage = null;
    try {
        $vkRow = Storage::adapter()->getVaultKeys((int)$user['id']);
        if ($vkRow) {
            $mustChangeVaultKey = (bool)($vkRow['must_reset_vault_key'] ?? false);
            $adminActionMessage = $vkRow['admin_action_message'] ?? null;
        }
    } catch (Exception $e) {
        // Table may not exist — default to false
    }

    $authUser = Auth::issueAuthToken((int)$user['id']);

    try { Storage::adapter()->logAction((int)$user['id'], 'login', 'users', null, Auth::clientIpHash()); } catch (Exception $e) {}

    // Once-per-day exchange rate refresh on first login of the day
    try {
        ExchangeRates::refreshIfStale();
    } catch (Exception $e) {
        // Silent failure — login must never break due to rate refresh
    }

    Response::success([
        'token' => $authUser['token'],
        'user' => [
            'id'                    => (int)$user['id'],
            'username'              => $user['username'],
            'email'                 => $user['email'],
            'role'                  => $user['role'],
            'must_change_password'  => $mustChangePassword,
            'must_change_vault_key' => $mustChangeVaultKey,
            'admin_action_message'  => $adminActionMessage,
        ],
        'expires_in' => JWT_EXPIRY,
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=register — Create a new user account
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'register') {
    $body = Response::getBody();
    $inviteToken = $body['invite_token'] ?? '';
    $username = Response::sanitize($body['username'] ?? '');
    $email    = Response::sanitize($body['email'] ?? '');
    $password = $body['password'] ?? '';

    // Rate limiting — 5 attempts per hour per IP, 5 per hour per email
    $ipHash = Auth::enforceIpRateLimit('register', RATE_LIMIT_REGISTER, RATE_LIMIT_REGISTER_WINDOW);
    Auth::recordRateLimit('register', $ipHash);
    if ($email) {
        $emailHash = Auth::hashForRateLimit('register_email', strtolower(trim($email)));
        Auth::enforceRateLimit('register', $emailHash, RATE_LIMIT_REGISTER, RATE_LIMIT_REGISTER_WINDOW);
        Auth::recordRateLimit('register', $emailHash);
    }

    // Gate: either self-registration is enabled OR a valid invite token is provided
    $inviteRow = null;
    if ($inviteToken) {
        $inviteRow = Storage::adapter()->validateInviteToken($inviteToken);

        if (!$inviteRow) {
            Response::error('Invalid invite link.', 403);
        }
        if ($inviteRow['used_at']) {
            Response::error('This invite has already been used.', 410);
        }
        if (strtotime($inviteRow['expires_at']) < time()) {
            Response::error('This invite has expired.', 410);
        }
        // Email must match the invite
        if (strtolower(trim($email)) !== strtolower(trim($inviteRow['email']))) {
            Response::error('Email does not match the invite. You must register with: ' . $inviteRow['email'], 403);
        }
    } elseif (!$selfRegistration) {
        Response::error('Self-registration is currently disabled. Access is by invitation only.', 403);
    }

    // Validate inputs
    if (!$username || !$email || !$password) {
        Response::error('Username, email, and password are required.');
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        Response::error('Invalid email address.');
    }

    Auth::validatePassword($password);

    // Always assign role = 'user'
    $role = 'user';

    // Check for duplicate username or email
    if (Storage::adapter()->checkDuplicateUser($username, $email)) {
        Response::error('Username or email already exists.');
    }

    // Hash password and insert
    $hash = Auth::hashPassword($password);

    // Invited users are automatically email-verified (they clicked an invite link)
    // Self-registered users need verification if require_email_verification is on
    $emailVerified = 1;
    $emailVerifyToken = null;
    if ($requireEmailVerification && !$inviteRow) {
        $emailVerified = 0;
        $emailVerifyToken = bin2hex(random_bytes(32));
    }

    $emailVerifyExpires = ($emailVerifyToken) ? date('Y-m-d H:i:s', time() + 86400) : null; // 24 hours
    $newId = Storage::adapter()->createUserFromRegistration([
        'username'             => $username,
        'email'                => $email,
        'password_hash'        => $hash,
        'role'                 => $role,
        'email_verified'       => $emailVerified,
        'email_verify_token'   => $emailVerifyToken,
        'email_verify_expires' => $emailVerifyExpires,
    ]);

    // Mark invite as used
    if ($inviteRow) {
        Storage::adapter()->markInvitationUsed($inviteRow['id']);
    }

    // If email verification is required and not coming from an invite, send verification email
    if ($requireEmailVerification && !$inviteRow) {
        $verifyUrl = (defined('APP_URL') ? APP_URL : WEBAUTHN_ORIGIN) . "/verify-email?token=" . $emailVerifyToken;
        $emailResult = ['success' => false];
        if (defined('SMTP_ENABLED') && SMTP_ENABLED) {
            $emailResult = Mailer::sendVerification($email, $verifyUrl, $username);
        }
        Response::success([
            'message' => 'Account created. Please check your email to verify your account before signing in.',
            'requires_verification' => true,
            'email_sent' => $emailResult['success'],
        ], 201);
    }

    $user = Auth::issueAuthToken($newId);

    Response::success([
        'token' => $user['token'],
        'user' => [
            'id'                   => (int)$user['id'],
            'username'             => $user['username'],
            'email'                => $user['email'],
            'role'                 => $user['role'],
            'must_reset_password'  => !empty($user['must_reset_password']),
        ],
        'expires_in' => JWT_EXPIRY,
    ], 201);
}

// ---------------------------------------------------------------------------
// GET ?action=verify-email — Verify email address (infrastructure, not active)
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'verify-email') {
    $token = $_GET['token'] ?? '';
    if (!$token) {
        Response::error('Verification token is required.', 400);
    }

    try {
        $user = Storage::adapter()->getUserByEmailVerifyToken($token);

        if (!$user) {
            Response::error('Invalid or expired verification token.', 400);
        }

        if ($user['email_verify_expires'] && strtotime($user['email_verify_expires']) < time()) {
            Response::error('Verification token has expired. Please register again.', 400);
        }

        Storage::adapter()->markEmailVerified($user['id']);

        Response::success(['message' => 'Email verified successfully. You can now sign in.']);
    } catch (PDOException $e) {
        Response::error('Email verification is not available.', 400);
    }
}

// ---------------------------------------------------------------------------
// GET ?action=me — Return current user profile
// ---------------------------------------------------------------------------
if ($method === 'GET' && $action === 'me') {
    $payload = Auth::requireAuth(allowMustResetPassword: true);
    $userId = Auth::userId($payload);

    $user = Storage::adapter()->getUserById($userId);

    if (!$user) {
        Response::error('User not found.', 404);
    }

    // Map DB column to what the client expects
    $user['must_change_password'] = (bool)($user['must_reset_password'] ?? false);
    unset($user['must_reset_password']);

    // Check vault key status from user_vault_keys table
    $user['must_change_vault_key'] = false;
    $user['admin_action_message'] = null;
    try {
        $vkRow = Storage::adapter()->getVaultKeys($userId);
        if ($vkRow) {
            $user['must_change_vault_key'] = (bool)($vkRow['must_reset_vault_key'] ?? false);
            $user['admin_action_message'] = $vkRow['admin_action_message'] ?? null;
        }
    } catch (Exception $e) {
        // Table may not exist — defaults already set
    }

    $user['id'] = (int)$user['id'];

    // Add display_currency preference
    try {
        $storage = \Storage::adapter();
        $prefs = $storage->getPreferences($userId);
        $user['display_currency'] = $prefs['display_currency'] ?? null;
    } catch (Exception $e) {
        $user['display_currency'] = null;
    }

    // Add RSA key status flags for profile display
    try {
        $keyStatus = Storage::adapter()->getUserRsaKeyStatus($userId);
        $user['has_public_key'] = $keyStatus['has_public_key'];
        $user['has_encrypted_private_key'] = $keyStatus['has_encrypted_private_key'];
    } catch (Exception $e) {
        $user['has_public_key'] = false;
        $user['has_encrypted_private_key'] = false;
    }

    Response::success($user);
}

// ---------------------------------------------------------------------------
// PUT ?action=profile — Update username and/or email
// ---------------------------------------------------------------------------
if ($method === 'PUT' && $action === 'profile') {
    $payload = Auth::requireAuth();
    $userId = Auth::userId($payload);
    $body = Response::getBody();

    $username     = Response::sanitize($body['username'] ?? '');
    $displayName  = Response::sanitize($body['display_name'] ?? '');
    $email        = Response::sanitize($body['email'] ?? '');

    if (!$username && !$email && !$displayName) {
        Response::error('At least one field is required.');
    }

    // Build dynamic update
    $updateFields = [];

    if ($displayName !== '') {
        $updateFields['display_name'] = $displayName;
    }

    if ($username) {
        // Check for duplicate username excluding current user (R2-S2: separate check)
        if (Storage::adapter()->checkDuplicateUser($username, '', $userId)) {
            Response::error('Username already taken.');
        }
        $updateFields['username'] = $username;
    }

    if ($email) {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email address.');
        }
        // Check for duplicate email excluding current user (R2-S2: separate check)
        if (Storage::adapter()->checkDuplicateUser('', $email, $userId)) {
            Response::error('Email already taken.');
        }
        $updateFields['email'] = $email;
    }

    Storage::adapter()->updateUserProfile($userId, $updateFields);

    Response::success(['message' => 'Profile updated.']);
}

// ---------------------------------------------------------------------------
// PUT ?action=password — Change password (requires current password)
// ---------------------------------------------------------------------------
if ($method === 'PUT' && $action === 'password') {
    $payload = Auth::requireAuth();
    $userId = Auth::userId($payload);
    $ipHash = Auth::enforceIpRateLimit('password_change', RATE_LIMIT_LOGIN_IP, RATE_LIMIT_LOGIN_IP_WINDOW);
    $body = Response::getBody();

    $currentPassword = $body['current_password'] ?? '';
    $newPassword     = $body['new_password'] ?? '';

    if (!$currentPassword || !$newPassword) {
        Response::error('Current password and new password are required.');
    }

    Auth::validatePassword($newPassword);

    // Verify current password
    $currentHash = Storage::adapter()->getPasswordHash($userId);

    if (!$currentHash || !Auth::verifyPassword($currentPassword, $currentHash)) {
        Auth::recordRateLimit('password_change', $ipHash);
        Response::error('Current password is incorrect.', 401);
    }

    // Check password reuse
    if (Auth::isPasswordReused($userId, $newPassword)) {
        Response::error('You cannot reuse a recent password. Please choose a different one.');
    }

    // Save old hash to history, then update
    Auth::savePasswordToHistory($userId, $currentHash);
    $hash = Auth::hashPassword($newPassword);
    Storage::adapter()->updateUserPassword($userId, $hash);

    // Reissue JWT so old token is replaced
    $authUser = Auth::issueAuthToken($userId);

    Response::success(['token' => $authUser['token'], 'message' => 'Password updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=force-change-password — Change password when forced by admin
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'force-change-password') {
    $payload = Auth::requireAuth(allowMustResetPassword: true);
    $userId = Auth::userId($payload);
    $body = Response::getBody();

    $newPassword = $body['new_password'] ?? '';

    Auth::validatePassword($newPassword);

    // Verify must_reset_password flag is set
    $mustReset = Storage::adapter()->getMustResetPassword($userId);

    if (!$mustReset) {
        Response::error('Password change is not required.', 403);
    }

    // Check password reuse
    if (Auth::isPasswordReused($userId, $newPassword)) {
        Response::error('You cannot reuse a recent password. Please choose a different one.');
    }

    // Save old hash to history, then hash new password, clear the flag
    $oldHash = Storage::adapter()->getPasswordHash($userId);
    if ($oldHash) {
        Auth::savePasswordToHistory($userId, $oldHash);
    }

    $hash = Auth::hashPassword($newPassword);
    Storage::adapter()->resetPasswordAndUnlock($userId, $hash);

    // Reissue JWT with must_reset_password cleared
    $authUser = Auth::issueAuthToken($userId);

    Response::success(['token' => $authUser['token'], 'message' => 'Password changed successfully.']);
}

// ---------------------------------------------------------------------------
// DELETE ?action=self-delete — User self-delete
// ---------------------------------------------------------------------------
if ($method === 'DELETE' && $action === 'self-delete') {
    $payload = Auth::requireAuth();
    $userId = Auth::userId($payload);
    $body = Response::getBody();

    $password = $body['password'] ?? '';
    if (!$password) {
        Response::error('Password is required to confirm account deletion.', 400);
    }

    // Verify password — need both password_hash and role
    $passwordHash = Storage::adapter()->getPasswordHash($userId);
    $userInfo = Storage::adapter()->getUserById($userId);

    if (!$passwordHash || !$userInfo || !Auth::verifyPassword($password, $passwordHash)) {
        Response::error('Invalid password.', 401);
    }

    // Prevent admin from self-deleting if they are the only admin
    if ($userInfo['role'] === 'admin') {
        if (Storage::adapter()->getAdminCount($userId) === 0) {
            Response::error('Cannot delete the only admin account.', 400);
        }
    }

    // Delete user — cascades handle cleanup
    Storage::adapter()->deleteUserById($userId);

    // Clear auth cookie
    Auth::clearAuthCookie();

    Response::success(['message' => 'Account deleted permanently.']);
}

// ---------------------------------------------------------------------------
// POST ?action=forgot-password — Reset password using recovery key
// ---------------------------------------------------------------------------
// POST ?action=forgot-password-material — Return recovery blobs for client-side verification (unauthenticated)
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'forgot-password-material') {
    $body = Response::getBody();
    $username = Response::sanitize($body['username'] ?? '');

    // Rate limiting — 5 attempts per hour per IP
    $ipHash = Auth::enforceIpRateLimit('forgot_password', RATE_LIMIT_FORGOT_PW, RATE_LIMIT_FORGOT_PW_WINDOW);
    Auth::recordRateLimit('forgot_password', $ipHash);

    if (!$username) {
        Response::error('Username or email is required.');
    }

    // Look up user
    $user = Storage::adapter()->getUserWithRecoveryMaterial($username);

    // Generic error to avoid user enumeration
    if (!$user || !$user['is_active'] || empty($user['recovery_key_salt'])) {
        Response::error('Invalid credentials.', 401);
    }

    // Return recovery material for client-side PBKDF2 + unwrap verification
    Response::success([
        'recovery_key_salt'      => $user['recovery_key_salt'],
        'encrypted_dek_recovery' => $user['encrypted_dek_recovery'],
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=forgot-password — Reset password after client-side recovery key verification
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'forgot-password') {
    $body = Response::getBody();
    $username    = Response::sanitize($body['username'] ?? '');
    $newPassword = $body['new_password'] ?? '';
    $confirmPassword = $body['confirm_password'] ?? '';

    // New recovery blobs (computed client-side after verifying the old recovery key)
    $newRecoverySalt          = $body['recovery_key_salt'] ?? '';
    $newEncryptedDekRecovery  = $body['encrypted_dek_recovery'] ?? '';
    $newRecoveryKeyEncrypted  = $body['recovery_key_encrypted'] ?? '';

    // Rate limiting — same bucket as material fetch
    $ipHash = Auth::enforceIpRateLimit('forgot_password', RATE_LIMIT_FORGOT_PW, RATE_LIMIT_FORGOT_PW_WINDOW);
    Auth::recordRateLimit('forgot_password', $ipHash);

    // Validate inputs
    if (!$username) {
        Response::error('Username or email is required.');
    }
    Auth::validatePassword($newPassword);
    if ($newPassword !== $confirmPassword) {
        Response::error('Passwords do not match.');
    }
    if (!$newRecoverySalt || !$newEncryptedDekRecovery || !$newRecoveryKeyEncrypted) {
        Response::error('Recovery key material is required.', 400);
    }

    // Look up user
    $user = Storage::adapter()->getUserByIdentifier($username);

    if (!$user) {
        Response::error('Invalid credentials.', 401);
    }
    if (!$user['is_active']) {
        Response::error('Account has been deactivated.', 403);
    }

    $userId = (int)$user['id'];

    // Update login password + clear lockout (method #13)
    $hash = Auth::hashPassword($newPassword);
    Storage::adapter()->resetPasswordAndUnlock($userId, $hash);

    // Update recovery blobs on user_vault_keys (existing setVaultKeys method)
    Storage::adapter()->setVaultKeys($userId, [
        'recovery_key_salt'      => $newRecoverySalt,
        'encrypted_dek_recovery' => $newEncryptedDekRecovery,
        'recovery_key_encrypted' => $newRecoveryKeyEncrypted,
    ]);

    // Save to password history
    Auth::savePasswordToHistory($userId, $hash);

    // Audit log
    $auditIpHash = Auth::clientIpHash();
    try {
        $storage = Storage::adapter();
        $storage->logAction($userId, 'recovery_key_password_reset', 'users', null, $auditIpHash);
    } catch (Exception $e) {}

    // Generate JWT and set cookie
    $authUser = Auth::issueAuthToken($userId);

    Response::success([
        'token' => $authUser['token'],
        'user' => [
            'id'       => (int)$authUser['id'],
            'username' => $authUser['username'],
            'email'    => $authUser['email'],
            'role'     => $authUser['role'],
        ],
        'expires_in' => JWT_EXPIRY,
    ]);
}

// ---------------------------------------------------------------------------
// POST ?action=logout — Clear auth cookie
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'logout') {
    Auth::clearAuthCookie();
    Response::success(['message' => 'Logged out.']);
}

// ---------------------------------------------------------------------------
// Fallback — Invalid endpoint
// ---------------------------------------------------------------------------
Response::error('Invalid endpoint.', 404);
