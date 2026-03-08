<?php
/**
 * Citadel Vault — Encryption (Server-Side Minimal)
 *
 * With client-side encryption, the server performs NO crypto operations.
 * This class is reduced to a single utility: hashing IPs for audit logging.
 */
require_once __DIR__ . '/../../config/config.php';

class Encryption {

    /**
     * Hash an IP address with HMAC-SHA256 for audit logging.
     * Uses AUDIT_HMAC_SECRET. Returns null if IP is empty.
     */
    public static function hashIp(?string $ip): ?string {
        if (!$ip) return null;
        $secret = defined('AUDIT_HMAC_SECRET') ? AUDIT_HMAC_SECRET
                : (defined('JWT_SECRET') ? JWT_SECRET : '');
        return hash_hmac('sha256', $ip, $secret);
    }
}
