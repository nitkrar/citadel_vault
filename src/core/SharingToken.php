<?php
/**
 * Stateless signed token for sharing recipient resolution.
 *
 * Format: base64(user_id.timestamp).HMAC-SHA256(user_id.timestamp, secret)
 * 5-minute expiry. No DB storage needed.
 *
 * The client treats this as an opaque string — it never parses or modifies it.
 * The server validates by re-computing the HMAC and checking the timestamp.
 */
class SharingToken {
    private const TTL_SECONDS = 300; // 5 minutes

    /**
     * Generate a signed recipient token.
     * @param int $userId The resolved recipient user ID
     * @return string Opaque token string
     */
    public static function generate(int $userId): string {
        $payload = $userId . '.' . time();
        $encoded = base64_encode($payload);
        $sig = hash_hmac('sha256', $payload, SHARING_TOKEN_SECRET);
        return $encoded . '.' . $sig;
    }

    /**
     * Validate token and extract user_id.
     * @param string $token The opaque token from the client
     * @return int|null User ID if valid and not expired, null otherwise
     */
    public static function validate(string $token): ?int {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2) return null;

        $payload = base64_decode($parts[0], true);
        if ($payload === false) return null;

        // Verify HMAC — timing-safe comparison
        $expectedSig = hash_hmac('sha256', $payload, SHARING_TOKEN_SECRET);
        if (!hash_equals($expectedSig, $parts[1])) return null;

        // Parse payload: "user_id.timestamp"
        $segments = explode('.', $payload, 2);
        if (count($segments) !== 2) return null;

        $userId = (int)$segments[0];
        $timestamp = (int)$segments[1];

        // Check expiry
        if (time() - $timestamp > self::TTL_SECONDS) return null;

        return $userId;
    }
}
