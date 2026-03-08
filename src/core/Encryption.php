<?php
/**
 * Personal Vault V2 — Encryption
 * AES-256-GCM encryption, per-user DEK, PBKDF2 key derivation, data session tokens,
 * RSA-2048 hybrid encryption for sharing.
 */
class Encryption {
    private const CIPHER = 'aes-256-gcm';
    private const TAG_LENGTH = 16;

    // =========================================================================
    // AES-256-GCM Symmetric Encryption
    // =========================================================================

    /**
     * Validate vault key against current policy (config-driven).
     * Used for both unlock and new key creation — single source of truth.
     */
    public static function validateVaultKey(string $key): bool {
        $minLen = defined('VAULT_KEY_MIN_LENGTH') ? VAULT_KEY_MIN_LENGTH : 8;
        $mode = defined('VAULT_KEY_MODE') ? VAULT_KEY_MODE : 'alphanumeric';

        if (strlen($key) < $minLen) return false;

        return match($mode) {
            'numeric'      => preg_match('/^\d+$/', $key) === 1,
            'alphanumeric' => preg_match('/^[a-zA-Z0-9]+$/', $key) === 1,
            default        => true, // 'any' — no character restriction
        };
    }

    public static function encrypt(?string $plaintext, ?string $key): ?string {
        if ($plaintext === null || $plaintext === '' || $key === null) return null;
        $iv = random_bytes(12);
        $tag = '';
        $derivedKey = self::deriveKey($key);
        $ciphertext = openssl_encrypt($plaintext, self::CIPHER, $derivedKey, OPENSSL_RAW_DATA, $iv, $tag, '', self::TAG_LENGTH);
        if ($ciphertext === false) return null;
        return base64_encode($iv . $tag . $ciphertext);
    }

    public static function decrypt(?string $encoded, ?string $key): ?string {
        if ($encoded === null || $encoded === '' || $key === null) return null;
        $raw = base64_decode($encoded, true);
        if ($raw === false || strlen($raw) < 12 + self::TAG_LENGTH) return null;
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, self::TAG_LENGTH);
        $ciphertext = substr($raw, 12 + self::TAG_LENGTH);
        $derivedKey = self::deriveKey($key);
        $plaintext = openssl_decrypt($ciphertext, self::CIPHER, $derivedKey, OPENSSL_RAW_DATA, $iv, $tag);
        return $plaintext === false ? null : $plaintext;
    }

    public static function deriveKey(string $keyMaterial): string {
        return hash('sha256', $keyMaterial, true);
    }

    public static function generateDek(): string {
        return random_bytes(32);
    }

    public static function generateSalt(): string {
        return bin2hex(random_bytes(32));
    }

    public static function deriveWrappingKey(string $vaultKey, string $salt): string {
        $iterations = defined('PBKDF2_ITERATIONS') ? PBKDF2_ITERATIONS : 100000;
        return hash_pbkdf2('sha256', $vaultKey, $salt, $iterations, 32, true);
    }

    public static function wrapDek(string $dek, string $wrappingKey): string {
        return self::encrypt(bin2hex($dek), bin2hex($wrappingKey));
    }

    public static function unwrapDek(string $wrappedDek, string $wrappingKey): ?string {
        $hex = self::decrypt($wrappedDek, bin2hex($wrappingKey));
        if ($hex === null) return null;
        $dek = hex2bin($hex);
        return $dek === false ? null : $dek;
    }

    // =========================================================================
    // Data Session Token (DEK encrypted with server secret)
    // =========================================================================

    public static function createDataSessionToken(string $dek, int $expiry): string {
        $payload = json_encode(['dek' => bin2hex($dek), 'exp' => $expiry]);
        return self::encrypt($payload, DATA_SESSION_SECRET);
    }

    public static function extractDekFromToken(string $token): ?string {
        $payload = self::decrypt($token, DATA_SESSION_SECRET);
        if ($payload === null) return null;
        $data = json_decode($payload, true);
        if (!$data || !isset($data['dek']) || !isset($data['exp'])) return null;
        if ($data['exp'] < time()) return null;
        $dek = hex2bin($data['dek']);
        return $dek === false ? null : $dek;
    }

    public static function getDekFromRequest(): ?string {
        // Try HttpOnly cookie first, then X-Data-Token header
        $token = $_COOKIE['pv_data_token'] ?? null;
        if (!$token) {
            $token = $_SERVER['HTTP_X_DATA_TOKEN'] ?? null;
        }
        if (!$token) return null;
        return self::extractDekFromToken($token);
    }

    public static function requireDek(): string {
        $dek = self::getDekFromRequest();
        if ($dek === null) {
            http_response_code(403);
            die(json_encode(['success' => false, 'error' => 'Vault key required. Please unlock your vault.']));
        }
        return $dek;
    }

    /**
     * Set the data token as an HttpOnly cookie (for web) AND return it in response (for mobile).
     */
    public static function setDataTokenCookie(string $token, int $expiry): void {
        $maxAge = $expiry - time();
        if ($maxAge < 0) $maxAge = 0;
        setcookie('pv_data_token', $token, [
            'expires'  => $expiry,
            'path'     => '/',
            'httponly'  => true,
            'secure'   => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'samesite' => 'Strict',
        ]);
    }

    /**
     * Clear the data token cookie.
     */
    public static function clearDataTokenCookie(): void {
        setcookie('pv_data_token', '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'httponly'  => true,
            'secure'   => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
            'samesite' => 'Strict',
        ]);
    }

    // =========================================================================
    // Internal Key Storage Helpers
    // The RSA private key and recovery key are encrypted with bin2hex($dek)
    // as the key material. These helpers encapsulate that convention so call
    // sites never need to know the format.
    // =========================================================================

    public static function encryptPrivateKey(string $privateKeyPem, string $dek): ?string {
        return self::encrypt($privateKeyPem, bin2hex($dek));
    }

    public static function decryptPrivateKey(string $encrypted, string $dek): ?string {
        return self::decrypt($encrypted, bin2hex($dek));
    }

    public static function encryptRecoveryKey(string $recoveryKey, string $dek): ?string {
        return self::encrypt($recoveryKey, bin2hex($dek));
    }

    public static function decryptRecoveryKey(string $encrypted, string $dek): ?string {
        return self::decrypt($encrypted, bin2hex($dek));
    }

    // =========================================================================
    // RSA-2048 Hybrid Encryption (for sharing)
    // =========================================================================

    /**
     * Generate an RSA-2048 key pair.
     * Returns ['public_key' => PEM, 'private_key' => PEM]
     */
    public static function generateRsaKeyPair(): array {
        $config = [
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];
        $res = openssl_pkey_new($config);
        openssl_pkey_export($res, $privateKey);
        $details = openssl_pkey_get_details($res);
        return [
            'public_key'  => $details['key'],
            'private_key' => $privateKey,
        ];
    }

    /**
     * Hybrid encrypt: generate random AES key, encrypt data with AES,
     * encrypt AES key with RSA public key.
     * Returns base64-encoded JSON: {encrypted_key, encrypted_data}
     */
    public static function rsaHybridEncrypt(string $plaintext, string $publicKeyPem): ?string {
        $aesKey = bin2hex(random_bytes(32));
        $encryptedData = self::encrypt($plaintext, $aesKey);
        if ($encryptedData === null) return null;

        $encryptedKey = '';
        $success = openssl_public_encrypt($aesKey, $encryptedKey, $publicKeyPem, OPENSSL_PKCS1_OAEP_PADDING);
        if (!$success) return null;

        return base64_encode(json_encode([
            'encrypted_key'  => base64_encode($encryptedKey),
            'encrypted_data' => $encryptedData,
        ]));
    }

    /**
     * Hybrid decrypt: decrypt AES key with RSA private key, then decrypt data.
     */
    public static function rsaHybridDecrypt(string $encoded, string $privateKeyPem): ?string {
        $json = base64_decode($encoded, true);
        if ($json === false) return null;

        $data = json_decode($json, true);
        if (!$data || !isset($data['encrypted_key']) || !isset($data['encrypted_data'])) return null;

        $encryptedKey = base64_decode($data['encrypted_key'], true);
        if ($encryptedKey === false) return null;

        $aesKey = '';
        $success = openssl_private_decrypt($encryptedKey, $aesKey, $privateKeyPem, OPENSSL_PKCS1_OAEP_PADDING);
        if (!$success) return null;

        return self::decrypt($data['encrypted_data'], $aesKey);
    }
}
