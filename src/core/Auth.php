<?php
/**
 * Personal Vault — Authentication
 * JWT generation/validation, role-based access control, password hashing.
 */
require_once __DIR__ . '/../../config/config.php';

class Auth {
    /**
     * Generate a JWT token for a user.
     */
    public static function generateToken(array $user): string {
        $header = self::base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::base64UrlEncode(json_encode([
            'sub'                 => $user['id'],
            'username'            => $user['username'],
            'role'                => $user['role'],
            'must_reset_password' => !empty($user['must_reset_password']),
            'checked_at'          => time(),
            'iat'                 => time(),
            'exp'                 => time() + JWT_EXPIRY,
        ]));
        $signature = self::base64UrlEncode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
        return "$header.$payload.$signature";
    }

    /**
     * Query user, generate JWT, and set auth cookie in one step.
     * Ensures consistent field set (id, username, role, must_reset_password).
     * Returns the user array for use in API responses.
     */
    public static function issueAuthToken(PDO $db, int $userId): array {
        $stmt = $db->prepare("SELECT id, username, display_name, email, role, must_reset_password FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $user = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (!$user) {
            Response::error('User not found.', 404);
        }
        $token = self::generateToken($user);
        self::setAuthCookie($token);
        $user['token'] = $token;
        return $user;
    }

    /**
     * Set the JWT as an httpOnly cookie (immune to XSS).
     */
    public static function setAuthCookie(string $token): void {
        $secure = getenv('APP_ENV') !== 'development';
        setcookie('pv_auth', $token, [
            'expires'  => time() + JWT_EXPIRY,
            'path'     => '/',
            'httponly'  => true,
            'secure'   => $secure,
            'samesite' => 'Strict',
        ]);
    }

    /**
     * Clear the auth cookie.
     */
    public static function clearAuthCookie(): void {
        $secure = getenv('APP_ENV') !== 'development';
        setcookie('pv_auth', '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'httponly'  => true,
            'secure'   => $secure,
            'samesite' => 'Strict',
        ]);
    }

    /**
     * Generate a JWT from an existing payload (for reissuing with updated claims).
     * Preserves the original exp so the session doesn't extend.
     */
    private static function generateTokenFromPayload(array $payload): string {
        $header = self::base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body = self::base64UrlEncode(json_encode($payload));
        $signature = self::base64UrlEncode(hash_hmac('sha256', "$header.$body", JWT_SECRET, true));
        return "$header.$body.$signature";
    }

    /**
     * Validate a JWT token. Returns decoded payload or null.
     */
    public static function validateToken(string $token): ?array {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;

        [$header, $payload, $signature] = $parts;
        $expectedSig = self::base64UrlEncode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
        if (!hash_equals($expectedSig, $signature)) return null;

        $data = json_decode(self::base64UrlDecode($payload), true);
        if (!$data || !isset($data['exp']) || $data['exp'] < time()) return null;

        return $data;
    }

    private static function base64UrlEncode(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string {
        return base64_decode(strtr($data, '-_', '+/'));
    }

    /**
     * Require authentication. Validates JWT AND checks is_active in DB.
     * Returns JWT payload with fresh role from database.
     *
     * @param bool $allowMustResetPassword  When true, skip the must_reset_password
     *             block so that the force-change-password and profile endpoints
     *             remain accessible to users who are forced to change their password.
     */
    public static function requireAuth(bool $allowMustResetPassword = false): array {
        $token = self::getBearerToken();
        if (!$token) {
            http_response_code(401);
            die(json_encode(['success' => false, 'error' => 'Authentication required.']));
        }

        $payload = self::validateToken($token);
        if (!$payload) {
            http_response_code(401);
            die(json_encode(['success' => false, 'error' => 'Invalid or expired token.']));
        }

        // Check must_reset_password from JWT payload (cached path)
        if (!$allowMustResetPassword && !empty($payload['must_reset_password'])) {
            http_response_code(403);
            die(json_encode(['success' => false, 'error' => 'Password change required.', 'must_change_password' => true]));
        }

        // Skip DB check if checked_at is within the configured interval
        $checkedAt = $payload['checked_at'] ?? 0;
        $interval = 300; // default 5 minutes

        if (time() - $checkedAt < $interval) {
            return $payload;
        }

        // DB check: verify is_active and refresh role
        $db = Database::getInstance();

        // Load auth_check_interval from system_settings (alongside the user check)
        try {
            $setting = Storage::adapter()->getSystemSetting('auth_check_interval');
            if ($setting !== null) $interval = (int)$setting;
        } catch (Exception $e) {}

        // Re-check with the actual interval (may differ from default)
        if ($interval !== 300 && time() - $checkedAt < $interval) {
            return $payload;
        }

        $stmt = $db->prepare("SELECT is_active, role, must_reset_password FROM users WHERE id = ?");
        $stmt->execute([self::userId($payload)]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || !$user['is_active']) {
            http_response_code(401);
            die(json_encode(['success' => false, 'error' => 'Account has been deactivated.']));
        }

        if (!$allowMustResetPassword && !empty($user['must_reset_password'])) {
            http_response_code(403);
            die(json_encode(['success' => false, 'error' => 'Password change required.', 'must_change_password' => true]));
        }

        // Refresh role, must_reset_password, and checked_at, reissue JWT cookie
        $payload['role'] = $user['role'];
        $payload['must_reset_password'] = !empty($user['must_reset_password']);
        $payload['checked_at'] = time();
        $newToken = self::generateTokenFromPayload($payload);
        self::setAuthCookie($newToken);

        return $payload;
    }

    /**
     * Require the authenticated user to have admin role.
     */
    public static function requireSiteAdmin(): array {
        $payload = self::requireAuth();
        if ($payload['role'] !== 'admin') {
            http_response_code(403);
            die(json_encode(['success' => false, 'error' => 'Site admin access required.']));
        }
        return $payload;
    }

    /**
     * Extract Bearer token from Authorization header.
     */
    private static function getBearerToken(): ?string {
        $headers = null;

        // Try standard CGI/FastCGI variable
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers = trim($_SERVER['HTTP_AUTHORIZATION']);
        }
        // Try redirect variant (set by .htaccess RewriteRule with [E=])
        elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $headers = trim($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        }
        // Try raw key (some server configs)
        elseif (isset($_SERVER['Authorization'])) {
            $headers = trim($_SERVER['Authorization']);
        }
        // Try Apache-specific function
        elseif (function_exists('apache_request_headers')) {
            $requestHeaders = apache_request_headers();
            $requestHeaders = array_combine(
                array_map('ucwords', array_keys($requestHeaders)),
                array_values($requestHeaders)
            );
            if (isset($requestHeaders['Authorization'])) {
                $headers = trim($requestHeaders['Authorization']);
            }
        }
        // Last resort: getallheaders() (available in PHP-FPM since PHP 7.0+)
        elseif (function_exists('getallheaders')) {
            foreach (getallheaders() as $name => $value) {
                if (strtolower($name) === 'authorization') {
                    $headers = trim($value);
                    break;
                }
            }
        }

        if ($headers && preg_match('/Bearer\s(\S+)/', $headers, $matches)) {
            return $matches[1];
        }

        // Fallback: httpOnly cookie (primary auth method for browser clients)
        if (isset($_COOKIE['pv_auth'])) {
            return $_COOKIE['pv_auth'];
        }

        return null;
    }

    /**
     * Hash a password with bcrypt (cost 12).
     */
    public static function hashPassword(string $password): string {
        $cost = defined('BCRYPT_COST') ? BCRYPT_COST : 12;
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => $cost]);
    }

    /**
     * Verify a password against a bcrypt hash.
     */
    public static function verifyPassword(string $password, string $hash): bool {
        return password_verify($password, $hash);
    }

    /**
     * Check if a new password matches any of the user's last N passwords.
     * Returns true if the password was recently used (should be rejected).
     */
    public static function isPasswordReused(PDO $db, int $userId, string $newPassword): bool {
        $count = defined('PASSWORD_HISTORY_COUNT') ? PASSWORD_HISTORY_COUNT : 1;
        if ($count < 1) return false;

        try {
            // Check current password first
            $stmt = $db->prepare("SELECT password_hash FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $current = $stmt->fetchColumn();
            if ($current && password_verify($newPassword, $current)) {
                return true;
            }

            // Check password history (last N-1 since current counts as 1)
            if ($count > 1) {
                $stmt = $db->prepare(
                    "SELECT password_hash FROM password_history
                     WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
                );
                $stmt->execute([$userId, $count - 1]);
                while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    if (password_verify($newPassword, $row['password_hash'])) {
                        return true;
                    }
                }
            }
        } catch (PDOException $e) {
            // password_history table may not exist — skip check
        }

        return false;
    }

    /**
     * Store the current password hash in history before changing it.
     * Trims history to keep only the last N entries.
     */
    public static function savePasswordToHistory(PDO $db, int $userId, string $oldHash): void {
        $count = defined('PASSWORD_HISTORY_COUNT') ? PASSWORD_HISTORY_COUNT : 1;
        if ($count < 1) return;

        try {
            $stmt = $db->prepare(
                "INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)"
            );
            $stmt->execute([$userId, $oldHash]);

            // Trim: keep only the last N entries (current password + history = N total)
            $keep = max($count - 1, 0);
            $stmt = $db->prepare(
                "DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
                    SELECT id FROM (
                        SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT $keep
                    ) AS recent
                )"
            );
            $stmt->execute([$userId, $userId]);
        } catch (PDOException $e) {
            // password_history table may not exist — non-fatal
        }
    }

    /**
     * Extract and cast user ID from JWT payload.
     */
    public static function userId(array $payload): int {
        return (int)$payload['sub'];
    }

    /**
     * Get the client IP address.
     */
    public static function getClientIp(): string {
        return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    }

    /**
     * Get the client IP as an HMAC hash for audit storage.
     */
    public static function clientIpHash(): ?string {
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        return Encryption::hashIp($ip);
    }

    /**
     * Record a failed login attempt and escalate lockout tiers.
     * Tier 1: LOCKOUT_TIER1_ATTEMPTS → lock for LOCKOUT_TIER1_DURATION
     * Tier 2: LOCKOUT_TIER2_ATTEMPTS → lock for LOCKOUT_TIER2_DURATION
     * Tier 3: LOCKOUT_TIER3_ATTEMPTS+ (every 3rd) → permanent lock + force password change
     */
    public static function recordFailedLogin(PDO $db, int $userId, string $username): void {
        try {
            $db->prepare("UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login_at = NOW() WHERE id = ?")
               ->execute([$userId]);

            $stmt = $db->prepare("SELECT failed_login_attempts, email FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) return;

            $attempts = (int)($row['failed_login_attempts'] ?? 0);
            $lockUntil = null;
            $auditAction = null;
            $lockLabel = null;

            if ($attempts === LOCKOUT_TIER1_ATTEMPTS) {
                $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_TIER1_DURATION);
                $auditAction = 'account_locked_tier1';
                $lockLabel = '15 minutes';
            } elseif ($attempts === LOCKOUT_TIER2_ATTEMPTS) {
                $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_TIER2_DURATION);
                $auditAction = 'account_locked_tier2';
                $lockLabel = '1 hour';
            } elseif ($attempts >= LOCKOUT_TIER3_ATTEMPTS && $attempts % 3 === 0) {
                $tier3Duration = 86400 * 90;
                try {
                    $setting = Storage::adapter()->getSystemSetting('lockout_tier3_duration');
                    if ($setting !== null) $tier3Duration = (int)$setting;
                } catch (Exception $e) {}
                $lockUntil = date('Y-m-d H:i:s', time() + $tier3Duration);
                $auditAction = 'account_locked_permanent';
                $lockLabel = null;
                $db->prepare("UPDATE users SET must_reset_password = 1 WHERE id = ?")->execute([$userId]);
            }

            if ($lockUntil) {
                $db->prepare("UPDATE users SET locked_until = ? WHERE id = ?")->execute([$lockUntil, $userId]);
                try { Storage::adapter()->logAction($userId, $auditAction, 'users', null, self::clientIpHash()); } catch (Exception $e) {}
                if (defined('SMTP_ENABLED') && SMTP_ENABLED && $row['email']) {
                    Mailer::sendLockoutNotification($row['email'], $username, $attempts, self::getClientIp(), $lockLabel);
                }
            }
        } catch (Exception $e) {
            // Lockout columns may not exist — non-fatal
        }
    }

    /**
     * Reset lockout counters after successful login.
     */
    public static function resetLoginLockout(PDO $db, int $userId): void {
        try {
            $db->prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login_at = NULL WHERE id = ?")
               ->execute([$userId]);
        } catch (Exception $e) {
            // Columns may not exist — non-fatal
        }
    }

    /**
     * Check if an account is locked — 429s with remaining time if so.
     */
    public static function enforceAccountLockout(PDO $db, int $userId): void {
        try {
            $stmt = $db->prepare("SELECT locked_until FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row && $row['locked_until']) {
                $lockedUntil = strtotime($row['locked_until']);
                if ($lockedUntil > time()) {
                    $remaining = ceil(($lockedUntil - time()) / 60);
                    Response::error("Account is locked. Try again in $remaining minute(s).", 429);
                }
            }
        } catch (Exception $e) {
            // Column may not exist — skip lockout check
        }
    }

    /**
     * Validate password strength — 400s if too weak.
     */
    public static function validatePassword(string $password): void {
        if (strlen($password) < 8) {
            Response::error('Password must be at least 8 characters.', 400);
        }
    }

    /**
     * Enforce rate limit on any identifier — 429s and exits if exceeded.
     */
    public static function enforceRateLimit(PDO $db, string $action, string $identifier, int $limit, int $window): void {
        if (self::isRateLimited($db, $action, $identifier, $limit, $window)) {
            Response::error('Too many attempts. Please try again later.', 429);
        }
    }

    /**
     * Enforce IP-based rate limit — 429s and exits if exceeded.
     * Returns the hashed identifier for use with recordRateLimit().
     */
    public static function enforceIpRateLimit(PDO $db, string $action, int $limit, int $window): string {
        $ipHash = self::hashForRateLimit($action . '_ip', self::getClientIp());
        self::enforceRateLimit($db, $action, $ipHash, $limit, $window);
        return $ipHash;
    }

    /**
     * Rate limiting — check if an action+identifier has exceeded the limit.
     * Identifier should be a hashed value (e.g., SHA-256 of IP or email).
     *
     * @param string $action    e.g., 'register', 'forgot_password'
     * @param string $identifier  hashed IP, email, or combination
     * @param int    $maxAttempts  max attempts in the window
     * @param int    $windowSeconds  time window in seconds
     * @return bool  true if rate limited (should reject)
     */
    public static function isRateLimited(PDO $db, string $action, string $identifier, int $maxAttempts = 5, int $windowSeconds = 3600): bool {
        try {
            // Clean up expired entries periodically (1 in 10 chance)
            if (random_int(1, 10) === 1) {
                $db->prepare("DELETE FROM rate_limits WHERE window_start < DATE_SUB(NOW(), INTERVAL ? SECOND)")
                   ->execute([$windowSeconds * 2]);
            }

            $stmt = $db->prepare(
                "SELECT attempts, window_start FROM rate_limits WHERE action = ? AND identifier = ? LIMIT 1"
            );
            $stmt->execute([$action, $identifier]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$row) return false; // No record = not limited

            // Check if window has expired
            if (strtotime($row['window_start']) + $windowSeconds < time()) {
                // Window expired — reset
                $db->prepare("DELETE FROM rate_limits WHERE action = ? AND identifier = ?")
                   ->execute([$action, $identifier]);
                return false;
            }

            return (int)$row['attempts'] >= $maxAttempts;
        } catch (PDOException $e) {
            return false; // Table may not exist — don't block
        }
    }

    /**
     * Record a rate-limited action attempt.
     */
    public static function recordRateLimit(PDO $db, string $action, string $identifier): void {
        try {
            $stmt = $db->prepare(
                "INSERT INTO rate_limits (action, identifier, attempts, window_start)
                 VALUES (?, ?, 1, NOW())
                 ON DUPLICATE KEY UPDATE attempts = attempts + 1"
            );
            $stmt->execute([$action, $identifier]);
        } catch (PDOException $e) {
            // non-fatal
        }
    }

    /**
     * Hash an identifier for rate limiting (IP, email, etc.)
     * Uses SHA-256 — not reversible, no PII stored.
     */
    public static function hashForRateLimit(string ...$parts): string {
        return hash('sha256', implode(':', $parts));
    }
}
