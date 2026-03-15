<?php
/**
 * PlaidEncryption — Server-side AES-256-GCM encryption for Plaid access tokens.
 * Uses PLAID_ENCRYPTION_KEY from .env (64-char hex = 32 bytes).
 */
require_once __DIR__ . '/../../config/config.php';

class PlaidEncryption {

    public static function encrypt(string $plaintext): string {
        $key = hex2bin(PLAID_ENCRYPTION_KEY);
        if (strlen($key) !== 32) {
            throw new RuntimeException('PLAID_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
        }
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($ciphertext === false) {
            throw new RuntimeException('Encryption failed');
        }
        return base64_encode($iv . $tag . $ciphertext);
    }

    public static function decrypt(string $blob): string {
        $key = hex2bin(PLAID_ENCRYPTION_KEY);
        $data = base64_decode($blob);
        if ($data === false || strlen($data) < 28) {
            throw new RuntimeException('Invalid encrypted blob');
        }
        $iv = substr($data, 0, 12);
        $tag = substr($data, 12, 16);
        $ciphertext = substr($data, 28);
        $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($plaintext === false) {
            throw new RuntimeException('Decryption failed — wrong key or corrupted data');
        }
        return $plaintext;
    }
}
