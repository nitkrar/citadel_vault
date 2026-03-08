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
            'sub'      => $user['id'],
            'username' => $user['username'],
            'role'     => $user['role'],
            'iat'      => time(),
            'exp'      => time() + JWT_EXPIRY,
        ]));
        $signature = self::base64UrlEncode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
        return "$header.$payload.$signature";
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
     */
    public static function requireAuth(): array {
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

        // Check is_active and refresh role from database
        $db = Database::getInstance();
        $stmt = $db->prepare("SELECT is_active, role FROM users WHERE id = ?");
        $stmt->execute([$payload['sub']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user || !$user['is_active']) {
            http_response_code(401);
            die(json_encode(['success' => false, 'error' => 'Account has been deactivated.']));
        }

        // Use DB role (not JWT-cached) for accurate checks
        $payload['role'] = $user['role'];
        return $payload;
    }

    /**
     * Require the authenticated user to have site_admin role.
     */
    public static function requireSiteAdmin(): array {
        $payload = self::requireAuth();
        if ($payload['role'] !== 'site_admin') {
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
        if (isset($_SERVER['Authorization'])) {
            $headers = trim($_SERVER['Authorization']);
        } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers = trim($_SERVER['HTTP_AUTHORIZATION']);
        } elseif (function_exists('apache_request_headers')) {
            $requestHeaders = apache_request_headers();
            $requestHeaders = array_combine(
                array_map('ucwords', array_keys($requestHeaders)),
                array_values($requestHeaders)
            );
            if (isset($requestHeaders['Authorization'])) {
                $headers = trim($requestHeaders['Authorization']);
            }
        }

        if ($headers && preg_match('/Bearer\s(\S+)/', $headers, $matches)) {
            return $matches[1];
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
