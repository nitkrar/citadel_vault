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
     * Validate that a base64 string is a valid RSA public key (SPKI/DER format).
     * Returns true if valid, false otherwise.
     */
    public static function validateRsaPublicKey(string $base64Key): bool {
        $der = base64_decode($base64Key, true);
        if ($der === false || strlen($der) < 32) return false;

        // Wrap in PEM and verify with OpenSSL
        $pem = "-----BEGIN PUBLIC KEY-----\n"
             . chunk_split($base64Key, 64, "\n")
             . "-----END PUBLIC KEY-----";

        $key = openssl_pkey_get_public($pem);
        if (!$key) return false;

        $details = openssl_pkey_get_details($key);
        return $details !== false && ($details['type'] ?? -1) === OPENSSL_KEYTYPE_RSA;
    }

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
