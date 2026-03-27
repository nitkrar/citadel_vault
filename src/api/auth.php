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
$db = Database::getConnection();

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
    $loginIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $loginIpHash = Auth::hashForRateLimit('login_ip', $loginIp);
    if (Auth::isRateLimited($db, 'login', $loginIpHash, RATE_LIMIT_LOGIN_IP, RATE_LIMIT_LOGIN_IP_WINDOW)) {
        Response::error('Too many login attempts. Please try again later.', 429);
    }

    $stmt = $db->prepare(
        "SELECT id, username, display_name, email, password_hash, role, is_active, must_reset_password
         FROM users WHERE username = ? OR email = ? LIMIT 1"
    );
    $stmt->execute([$username, $username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    // --- Account lockout check (before password verification) ---
    if ($user) {
        try {
            $stmt = $db->prepare("SELECT failed_login_attempts, locked_until FROM users WHERE id = ?");
            $stmt->execute([$user['id']]);
            $lockRow = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($lockRow && $lockRow['locked_until']) {
                $lockedUntil = strtotime($lockRow['locked_until']);
                if ($lockedUntil > time()) {
                    $remaining = ceil(($lockedUntil - time()) / 60);
                    Response::error("Account is locked. Try again in $remaining minute(s).", 429);
                }
            }
        } catch (Exception $e) {
            // Columns may not exist — skip lockout check
        }
    }

    // --- Verify credentials ---
    if (!$user || !Auth::verifyPassword($password, $user['password_hash'])) {
        // Track failed attempt if user exists
        if ($user) {
            try {
                $db->prepare("UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login_at = NOW() WHERE id = ?")
                   ->execute([$user['id']]);

                $stmt = $db->prepare("SELECT failed_login_attempts, email FROM users WHERE id = ?");
                $stmt->execute([$user['id']]);
                $failRow = $stmt->fetch(PDO::FETCH_ASSOC);
                $attempts = (int)($failRow['failed_login_attempts'] ?? 0);
                $ip = $_SERVER['REMOTE_ADDR'] ?? null;

                // Tier 1: 3 attempts → 15 min lock
                if ($attempts === LOCKOUT_TIER1_ATTEMPTS) {
                    $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_TIER1_DURATION);
                    $db->prepare("UPDATE users SET locked_until = ? WHERE id = ?")->execute([$lockUntil, $user['id']]);
                    // Audit log (no IP stored)
                    try { $db->prepare("INSERT INTO audit_log (user_id, action, resource_type) VALUES (?, 'account_locked_tier1', 'users')")->execute([$user['id']]); } catch (Exception $e) {}
                    // Send email notification (IP in email only, not stored)
                    if (defined('SMTP_ENABLED') && SMTP_ENABLED && $failRow['email']) {
                        Mailer::sendLockoutNotification($failRow['email'], $user['username'], $attempts, $ip, '15 minutes');
                    }
                }
                // Tier 2: 6 attempts → 1 hour lock
                elseif ($attempts === LOCKOUT_TIER2_ATTEMPTS) {
                    $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_TIER2_DURATION);
                    $db->prepare("UPDATE users SET locked_until = ? WHERE id = ?")->execute([$lockUntil, $user['id']]);
                    try { $db->prepare("INSERT INTO audit_log (user_id, action, resource_type) VALUES (?, 'account_locked_tier2', 'users')")->execute([$user['id']]); } catch (Exception $e) {}
                    if (defined('SMTP_ENABLED') && SMTP_ENABLED && $failRow['email']) {
                        Mailer::sendLockoutNotification($failRow['email'], $user['username'], $attempts, $ip, '1 hour');
                    }
                }
                // Tier 3: 9+ attempts → full lock + force password change
                elseif ($attempts >= LOCKOUT_TIER3_ATTEMPTS && $attempts % 3 === 0) {
                    // Lock far into the future — only password change unlocks
                    $tier3Duration = 86400 * 90;
                    try {
                        $setting = Storage::adapter()->getSystemSetting('lockout_tier3_duration');
                        if ($setting !== null) $tier3Duration = (int)$setting;
                    } catch (Exception $e) {}
                    $lockUntil = date('Y-m-d H:i:s', time() + $tier3Duration);
                    $db->prepare("UPDATE users SET locked_until = ?, must_reset_password = 1 WHERE id = ?")->execute([$lockUntil, $user['id']]);
                    try { $db->prepare("INSERT INTO audit_log (user_id, action, resource_type) VALUES (?, 'account_locked_permanent', 'users')")->execute([$user['id']]); } catch (Exception $e) {}
                    if (defined('SMTP_ENABLED') && SMTP_ENABLED && $failRow['email']) {
                        Mailer::sendLockoutNotification($failRow['email'], $user['username'], $attempts, $ip, null);
                    }
                }
            } catch (Exception $e) {
                // Lockout columns may not exist — non-fatal
            }
        }
        // Record failed attempt against IP (cross-account)
        Auth::recordRateLimit($db, 'login', $loginIpHash);
        Response::error('Invalid credentials.', 401);
    }

    if (!$user['is_active']) {
        Response::error('Account has been deactivated.', 403);
    }

    // --- Successful login: reset lockout counters ---
    try {
        $db->prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL WHERE id = ?")
           ->execute([$user['id']]);
    } catch (Exception $e) {
        // Columns may not exist — non-fatal
    }

    // Check email verification (DB migration resilience)
    if ($requireEmailVerification) {
        try {
            $stmt3 = $db->prepare("SELECT email_verified FROM users WHERE id = ?");
            $stmt3->execute([$user['id']]);
            $evRow = $stmt3->fetch(PDO::FETCH_ASSOC);
            if ($evRow && !(int)$evRow['email_verified']) {
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
        $stmt2 = $db->prepare("SELECT must_reset_vault_key, admin_action_message FROM user_vault_keys WHERE user_id = ?");
        $stmt2->execute([$user['id']]);
        $vkRow = $stmt2->fetch(PDO::FETCH_ASSOC);
        if ($vkRow) {
            $mustChangeVaultKey = (bool)($vkRow['must_reset_vault_key'] ?? false);
            $adminActionMessage = $vkRow['admin_action_message'] ?? null;
        }
    } catch (Exception $e) {
        // Table may not exist — default to false
    }

    $token = Auth::generateToken($user);
    Auth::setAuthCookie($token);

    // Once-per-day exchange rate refresh on first login of the day
    try {
        ExchangeRates::refreshIfStale($db);
    } catch (Exception $e) {
        // Silent failure — login must never break due to rate refresh
    }

    Response::success([
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
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ipHash = Auth::hashForRateLimit('register_ip', $ip);
    $emailHash = $email ? Auth::hashForRateLimit('register_email', strtolower(trim($email))) : '';

    if (Auth::isRateLimited($db, 'register', $ipHash, RATE_LIMIT_REGISTER, RATE_LIMIT_REGISTER_WINDOW)) {
        Response::error('Too many registration attempts. Please try again later.', 429);
    }
    if ($emailHash && Auth::isRateLimited($db, 'register', $emailHash, RATE_LIMIT_REGISTER, RATE_LIMIT_REGISTER_WINDOW)) {
        Response::error('Too many registration attempts for this email. Please try again later.', 429);
    }

    // Record attempts (both IP and email)
    Auth::recordRateLimit($db, 'register', $ipHash);
    if ($emailHash) Auth::recordRateLimit($db, 'register', $emailHash);

    // Gate: either self-registration is enabled OR a valid invite token is provided
    $inviteRow = null;
    if ($inviteToken) {
        $stmt = $db->prepare(
            "SELECT id, email, expires_at, used_at FROM invitations WHERE token = ? LIMIT 1"
        );
        $stmt->execute([$inviteToken]);
        $inviteRow = $stmt->fetch(PDO::FETCH_ASSOC);

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

    if (strlen($password) < 8) {
        Response::error('Password must be at least 8 characters.');
    }

    // Always assign role = 'user'
    $role = 'user';

    // Check for duplicate username or email
    $stmt = $db->prepare("SELECT id FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $email]);
    if ($stmt->fetch()) {
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
    $stmt = $db->prepare(
        "INSERT INTO users (username, email, password_hash, role, is_active, email_verified, email_verify_token, email_verify_expires)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
    );
    $stmt->execute([$username, $email, $hash, $role, $emailVerified, $emailVerifyToken, $emailVerifyExpires]);
    $newId = (int)$db->lastInsertId();

    // Mark invite as used
    if ($inviteRow) {
        $stmt = $db->prepare("UPDATE invitations SET used_at = NOW() WHERE id = ?");
        $stmt->execute([$inviteRow['id']]);
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

    $user = [
        'id'       => $newId,
        'username' => $username,
        'email'    => $email,
        'role'     => $role,
    ];

    $token = Auth::generateToken($user);
    Auth::setAuthCookie($token);

    Response::success([
        'user' => [
            'id'                   => $newId,
            'username'             => $username,
            'email'                => $email,
            'role'                 => $role,
            'must_reset_password' => false,
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
        $stmt = $db->prepare(
            "SELECT id, email_verify_expires FROM users
             WHERE email_verify_token = ? AND email_verified = 0 LIMIT 1"
        );
        $stmt->execute([$token]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            Response::error('Invalid or expired verification token.', 400);
        }

        if ($user['email_verify_expires'] && strtotime($user['email_verify_expires']) < time()) {
            Response::error('Verification token has expired. Please register again.', 400);
        }

        $stmt = $db->prepare(
            "UPDATE users SET email_verified = 1, email_verify_token = NULL, email_verify_expires = NULL WHERE id = ?"
        );
        $stmt->execute([$user['id']]);

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
    $userId = $payload['sub'];

    $stmt = $db->prepare(
        "SELECT id, username, display_name, email, role, must_reset_password, created_at
         FROM users WHERE id = ?"
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

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
        $stmt2 = $db->prepare("SELECT must_reset_vault_key, admin_action_message FROM user_vault_keys WHERE user_id = ?");
        $stmt2->execute([$userId]);
        $vkRow = $stmt2->fetch(PDO::FETCH_ASSOC);
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
        $stmt3 = $db->prepare("SELECT public_key, encrypted_private_key FROM users WHERE id = ?");
        $stmt3->execute([$userId]);
        $keyRow = $stmt3->fetch(PDO::FETCH_ASSOC);
        $user['has_public_key'] = !empty($keyRow['public_key']);
        $user['has_encrypted_private_key'] = !empty($keyRow['encrypted_private_key']);
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
    $userId = $payload['sub'];
    $body = Response::getBody();

    $username     = Response::sanitize($body['username'] ?? '');
    $displayName  = Response::sanitize($body['display_name'] ?? '');
    $email        = Response::sanitize($body['email'] ?? '');

    if (!$username && !$email && !$displayName) {
        Response::error('At least one field is required.');
    }

    // Build dynamic update
    $fields = [];
    $values = [];

    if ($displayName !== '') {
        $fields[] = 'display_name = ?';
        $values[] = $displayName;
    }

    if ($username) {
        // Check for duplicate username excluding current user
        $stmt = $db->prepare("SELECT id FROM users WHERE username = ? AND id != ?");
        $stmt->execute([$username, $userId]);
        if ($stmt->fetch()) {
            Response::error('Username already taken.');
        }
        $fields[] = 'username = ?';
        $values[] = $username;
    }

    if ($email) {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email address.');
        }
        // Check for duplicate email excluding current user
        $stmt = $db->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
        $stmt->execute([$email, $userId]);
        if ($stmt->fetch()) {
            Response::error('Email already taken.');
        }
        $fields[] = 'email = ?';
        $values[] = $email;
    }

    $values[] = $userId;
    $sql = "UPDATE users SET " . implode(', ', $fields) . " WHERE id = ?";
    $stmt = $db->prepare($sql);
    $stmt->execute($values);

    Response::success(['message' => 'Profile updated.']);
}

// ---------------------------------------------------------------------------
// PUT ?action=password — Change password (requires current password)
// ---------------------------------------------------------------------------
if ($method === 'PUT' && $action === 'password') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $currentPassword = $body['current_password'] ?? '';
    $newPassword     = $body['new_password'] ?? '';

    if (!$currentPassword || !$newPassword) {
        Response::error('Current password and new password are required.');
    }

    if (strlen($newPassword) < 8) {
        Response::error('New password must be at least 8 characters.');
    }

    // Verify current password
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user || !Auth::verifyPassword($currentPassword, $user['password_hash'])) {
        Response::error('Current password is incorrect.', 401);
    }

    // Check password reuse
    if (Auth::isPasswordReused($db, $userId, $newPassword)) {
        Response::error('You cannot reuse a recent password. Please choose a different one.');
    }

    // Save old hash to history, then update
    Auth::savePasswordToHistory($db, $userId, $user['password_hash']);
    $hash = Auth::hashPassword($newPassword);
    $stmt = $db->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
    $stmt->execute([$hash, $userId]);

    Response::success(['message' => 'Password updated.']);
}

// ---------------------------------------------------------------------------
// POST ?action=force-change-password — Change password when forced by admin
// ---------------------------------------------------------------------------
if ($method === 'POST' && $action === 'force-change-password') {
    $payload = Auth::requireAuth(allowMustResetPassword: true);
    $userId = $payload['sub'];
    $body = Response::getBody();

    $newPassword = $body['new_password'] ?? '';

    if (strlen($newPassword) < 8) {
        Response::error('Password must be at least 8 characters.');
    }

    // Verify must_reset_password flag is set
    $stmt = $db->prepare("SELECT must_reset_password FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row || !(bool)$row['must_reset_password']) {
        Response::error('Password change is not required.', 403);
    }

    // Check password reuse
    if (Auth::isPasswordReused($db, $userId, $newPassword)) {
        Response::error('You cannot reuse a recent password. Please choose a different one.');
    }

    // Save old hash to history, then hash new password, clear the flag
    $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $oldHash = $stmt->fetchColumn();
    if ($oldHash) {
        Auth::savePasswordToHistory($db, $userId, $oldHash);
    }

    $hash = Auth::hashPassword($newPassword);
    try {
        $stmt = $db->prepare("UPDATE users SET password_hash = ?, must_reset_password = 0, failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL WHERE id = ?");
        $stmt->execute([$hash, $userId]);
    } catch (PDOException $e) {
        // Fallback if columns don't exist yet
        $stmt = $db->prepare("UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?");
        $stmt->execute([$hash, $userId]);
    }

    // Reissue JWT with must_reset_password cleared
    $stmt = $db->prepare("SELECT id, username, role, must_reset_password FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $updatedUser = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($updatedUser) {
        $token = Auth::generateToken($updatedUser);
        Auth::setAuthCookie($token);
    }

    Response::success(['message' => 'Password changed successfully.']);
}

// ---------------------------------------------------------------------------
// DELETE ?action=self-delete — User self-delete
// ---------------------------------------------------------------------------
if ($method === 'DELETE' && $action === 'self-delete') {
    $payload = Auth::requireAuth();
    $userId = $payload['sub'];
    $body = Response::getBody();

    $password = $body['password'] ?? '';
    if (!$password) {
        Response::error('Password is required to confirm account deletion.', 400);
    }

    // Verify password
    $stmt = $db->prepare("SELECT password_hash, role FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user || !Auth::verifyPassword($password, $user['password_hash'])) {
        Response::error('Invalid password.', 401);
    }

    // Prevent admin from self-deleting if they are the only admin
    if ($user['role'] === 'admin') {
        $stmt = $db->prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?");
        $stmt->execute([$userId]);
        if ((int)$stmt->fetch()['cnt'] === 0) {
            Response::error('Cannot delete the only admin account.', 400);
        }
    }

    // Delete user — cascades handle cleanup
    $stmt = $db->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$userId]);

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
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ipHash = Auth::hashForRateLimit('forgot_password_ip', $ip);
    if (Auth::isRateLimited($db, 'forgot_password', $ipHash, RATE_LIMIT_FORGOT_PW, RATE_LIMIT_FORGOT_PW_WINDOW)) {
        Response::error('Too many password reset attempts. Please try again later.', 429);
    }
    Auth::recordRateLimit($db, 'forgot_password', $ipHash);

    if (!$username) {
        Response::error('Username or email is required.');
    }

    // Look up user
    $stmt = $db->prepare(
        "SELECT u.id, u.is_active, v.recovery_key_salt, v.encrypted_dek_recovery
         FROM users u
         LEFT JOIN user_vault_keys v ON v.user_id = u.id
         WHERE (u.username = ? OR u.email = ?) LIMIT 1"
    );
    $stmt->execute([$username, $username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

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
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $ipHash = Auth::hashForRateLimit('forgot_password_ip', $ip);
    if (Auth::isRateLimited($db, 'forgot_password', $ipHash, RATE_LIMIT_FORGOT_PW, RATE_LIMIT_FORGOT_PW_WINDOW)) {
        Response::error('Too many password reset attempts. Please try again later.', 429);
    }
    Auth::recordRateLimit($db, 'forgot_password', $ipHash);

    // Validate inputs
    if (!$username) {
        Response::error('Username or email is required.');
    }
    if (strlen($newPassword) < 8) {
        Response::error('Password must be at least 8 characters.');
    }
    if ($newPassword !== $confirmPassword) {
        Response::error('Passwords do not match.');
    }
    if (!$newRecoverySalt || !$newEncryptedDekRecovery || !$newRecoveryKeyEncrypted) {
        Response::error('Recovery key material is required.', 400);
    }

    // Look up user
    $stmt = $db->prepare(
        "SELECT id, username, email, role, is_active FROM users
         WHERE (username = ? OR email = ?) LIMIT 1"
    );
    $stmt->execute([$username, $username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        Response::error('Invalid credentials.', 401);
    }
    if (!$user['is_active']) {
        Response::error('Account has been deactivated.', 403);
    }

    $userId = (int)$user['id'];

    // Update login password
    $hash = Auth::hashPassword($newPassword);
    $stmt = $db->prepare(
        "UPDATE users SET
            password_hash = ?,
            failed_login_attempts = 0,
            locked_until = NULL,
            last_failed_login_at = NULL,
            must_reset_password = 0
         WHERE id = ?"
    );
    $stmt->execute([$hash, $userId]);

    // Update recovery blobs on user_vault_keys
    $stmt = $db->prepare(
        "UPDATE user_vault_keys SET
            recovery_key_salt = ?,
            encrypted_dek_recovery = ?,
            recovery_key_encrypted = ?
         WHERE user_id = ?"
    );
    $stmt->execute([
        $newRecoverySalt,
        $newEncryptedDekRecovery,
        $newRecoveryKeyEncrypted,
        $userId,
    ]);

    // Save to password history
    Auth::savePasswordToHistory($db, $userId, $hash);

    // Audit log
    $auditIpHash = Encryption::hashIp($ip);
    try {
        $storage = Storage::adapter();
        $storage->logAction($userId, 'recovery_key_password_reset', 'users', null, $auditIpHash);
    } catch (Exception $e) {}

    // Generate JWT and set cookie
    $token = Auth::generateToken([
        'id'       => $userId,
        'username' => $user['username'],
        'email'    => $user['email'],
        'role'     => $user['role'],
    ]);
    Auth::setAuthCookie($token);

    Response::success([
        'user' => [
            'id'       => $userId,
            'username' => $user['username'],
            'email'    => $user['email'],
            'role'     => $user['role'],
        ],
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
