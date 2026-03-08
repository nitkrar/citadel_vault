/**
 * Citadel Vault — Client-Side Crypto Module
 *
 * Zero-knowledge encryption using Web Crypto API.
 * The server never sees plaintext data, vault keys, or DEKs.
 *
 * Key hierarchy:
 *   Vault Key → PBKDF2 → Wrapping Key → wraps DEK (AES-KW)
 *   DEK (non-extractable CryptoKey) → encrypts all data (AES-256-GCM)
 *   Recovery Key → PBKDF2 → Recovery Wrapping Key → wraps same DEK
 */

const PBKDF2_ITERATIONS = 100000;

// ── Module state ────────────────────────────────────────────────────────

let _dek = null;

export function isUnlocked() {
    return _dek !== null;
}

export function lock() {
    _dek = null;
}

export function setDek(dek) {
    _dek = dek;
}

/**
 * Internal accessor for EncryptionContext only.
 * Returns the DEK CryptoKey for encrypt/decrypt operations.
 * Prefer using encryptEntry/decryptEntry directly when possible.
 */
export function _getDekForContext() {
    if (!_dek) throw new Error('Vault is locked — no DEK available.');
    return _dek;
}

// ── Base64 helpers ──────────────────────────────────────────────────────

export function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function fromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ── Key Management ──────────────────────────────────────────────────────

/**
 * Generate a new Data Encryption Key (DEK).
 * CRITICAL: extractable = false — even XSS cannot export this key.
 */
export async function generateDek() {
    return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable — required for wrapKey('raw') to work
        ['encrypt', 'decrypt']
    );
}

/**
 * Derive a wrapping key from a passphrase + salt using PBKDF2.
 * Used for both vault key and recovery key wrapping.
 */
export async function deriveWrappingKey(passphrase, saltBase64, iterations = PBKDF2_ITERATIONS) {
    const encoder = new TextEncoder();
    const salt = fromBase64(saltBase64);

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-KW', length: 256 },
        false,
        ['wrapKey', 'unwrapKey']
    );
}

/**
 * Wrap (encrypt) the DEK with a wrapping key using AES-KW.
 */
export async function wrapDek(dek, wrappingKey) {
    const wrapped = await crypto.subtle.wrapKey('raw', dek, wrappingKey, 'AES-KW');
    return toBase64(wrapped);
}

/**
 * Unwrap (decrypt) the DEK with a wrapping key.
 * Returns null on failure (wrong passphrase).
 */
export async function unwrapDek(wrappedBase64, wrappingKey) {
    try {
        const wrapped = fromBase64(wrappedBase64);
        return await crypto.subtle.unwrapKey(
            'raw',
            wrapped,
            wrappingKey,
            'AES-KW',
            { name: 'AES-GCM', length: 256 },
            true, // extractable — needed for re-wrapping on key change
            ['encrypt', 'decrypt']
        );
    } catch {
        return null;
    }
}

// ── Data Encryption (AES-256-GCM) ──────────────────────────────────────

/**
 * Encrypt plaintext string with AES-256-GCM.
 * Output format: base64(12-byte-IV + ciphertext+tag)
 */
export async function encrypt(plaintext, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(plaintext)
    );
    // Concatenate IV + ciphertext (which includes auth tag)
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return toBase64(combined);
}

/**
 * Decrypt a blob back to plaintext. Returns null on failure.
 */
export async function decrypt(blob, key) {
    try {
        const data = fromBase64(blob);
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const plainBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );
        return new TextDecoder().decode(plainBuffer);
    } catch {
        return null;
    }
}

/**
 * Encrypt a JSON object. Serializes to JSON, then encrypts.
 */
export async function encryptEntry(obj, key) {
    return encrypt(JSON.stringify(obj), key);
}

/**
 * Decrypt a blob back to a parsed JSON object. Returns null on failure.
 */
export async function decryptEntry(blob, key) {
    const plaintext = await decrypt(blob, key);
    if (plaintext === null) return null;
    try {
        return JSON.parse(plaintext);
    } catch {
        return null;
    }
}

// ── RSA / Sharing ───────────────────────────────────────────────────────

/**
 * Generate an RSA-OAEP 2048-bit key pair for sharing.
 */
export async function generateKeyPair() {
    return crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true, // extractable (we need to export/import these)
        ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
}

/**
 * Export RSA public key to base64 SPKI format.
 */
export async function exportPublicKey(publicKey) {
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    return toBase64(spki);
}

/**
 * Import RSA public key from base64 SPKI.
 */
export async function importPublicKey(base64Spki) {
    const spki = fromBase64(base64Spki);
    return crypto.subtle.importKey(
        'spki',
        spki,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt', 'wrapKey']
    );
}

/**
 * Encrypt RSA private key with the DEK for server storage.
 * Export PKCS8, then AES-GCM encrypt.
 */
export async function encryptPrivateKey(privateKey, dek) {
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        dek,
        pkcs8
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return toBase64(combined);
}

/**
 * Decrypt RSA private key from server blob using DEK. Returns null on failure.
 */
export async function decryptPrivateKey(blob, dek) {
    try {
        const data = fromBase64(blob);
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const pkcs8 = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            dek,
            ciphertext
        );
        return crypto.subtle.importKey(
            'pkcs8',
            pkcs8,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt', 'unwrapKey']
        );
    } catch {
        return null;
    }
}

/**
 * Hybrid encrypt: generate ephemeral AES key, RSA-wrap it, AES-GCM encrypt data.
 * Format: base64( 2-byte wrappedKeyLen + wrappedKey + 12-byte IV + ciphertext+tag )
 */
export async function hybridEncrypt(plaintext, recipientPubKey) {
    const encoder = new TextEncoder();

    // Generate ephemeral AES key
    const ephemeralKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // must be extractable to wrap with RSA
        ['encrypt']
    );

    // RSA-wrap the ephemeral key
    const wrappedKey = new Uint8Array(
        await crypto.subtle.wrapKey('raw', ephemeralKey, recipientPubKey, 'RSA-OAEP')
    );

    // AES-GCM encrypt the data
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            ephemeralKey,
            encoder.encode(plaintext)
        )
    );

    // Pack: wrappedKeyLen (2 bytes, big-endian) + wrappedKey + IV + ciphertext
    const lenBytes = new Uint8Array(2);
    lenBytes[0] = (wrappedKey.length >> 8) & 0xff;
    lenBytes[1] = wrappedKey.length & 0xff;

    const combined = new Uint8Array(2 + wrappedKey.length + 12 + ciphertext.length);
    combined.set(lenBytes, 0);
    combined.set(wrappedKey, 2);
    combined.set(iv, 2 + wrappedKey.length);
    combined.set(ciphertext, 2 + wrappedKey.length + 12);

    return toBase64(combined);
}

/**
 * Hybrid decrypt: extract RSA-wrapped AES key, unwrap, AES-GCM decrypt.
 */
export async function hybridDecrypt(blob, privateKey) {
    const data = fromBase64(blob);

    // Read wrappedKey length
    const wrappedKeyLen = (data[0] << 8) | data[1];
    const wrappedKey = data.slice(2, 2 + wrappedKeyLen);
    const iv = data.slice(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12);
    const ciphertext = data.slice(2 + wrappedKeyLen + 12);

    // Unwrap the ephemeral AES key
    const ephemeralKey = await crypto.subtle.unwrapKey(
        'raw',
        wrappedKey,
        privateKey,
        'RSA-OAEP',
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    // Decrypt data
    const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        ephemeralKey,
        ciphertext
    );

    return new TextDecoder().decode(plainBuffer);
}

// ── Recovery Key ────────────────────────────────────────────────────────

/**
 * Generate a recovery key: 16 random bytes → 32 hex chars.
 */
export function generateRecoveryKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random salt for PBKDF2: 16 random bytes → base64.
 */
function generateSalt() {
    return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

// ── Workflow Functions ──────────────────────────────────────────────────
// These compose atomic functions. They do NOT make API calls.
// The calling code (EncryptionContext) handles server communication.

/**
 * First-time vault setup. Generates all crypto material.
 *
 * Flow:
 * 1. Generate DEK (non-extractable)
 * 2. Derive wrapping key from vault key + salt → wrap DEK
 * 3. Generate recovery key + salt → wrap same DEK
 * 4. Encrypt recovery key with DEK (for later viewing)
 * 5. Generate RSA key pair → export public, encrypt private with DEK
 * 6. Set DEK in module state
 *
 * Returns: { recoveryKey, keyMaterial: { ...blobs for server storage } }
 */
export async function setupVault(vaultKey) {
    // 1. Generate DEK
    const dek = await generateDek();

    // 2. Wrap DEK with vault key
    const vaultKeySalt = generateSalt();
    const vaultWrappingKey = await deriveWrappingKey(vaultKey, vaultKeySalt);
    const encryptedDek = await wrapDek(dek, vaultWrappingKey);

    // 3. Wrap DEK with recovery key
    const recoveryKey = generateRecoveryKey();
    const recoveryKeySalt = generateSalt();
    const recoveryWrappingKey = await deriveWrappingKey(recoveryKey, recoveryKeySalt);
    const encryptedDekRecovery = await wrapDek(dek, recoveryWrappingKey);

    // 4. Encrypt recovery key with DEK (for "View Recovery Key" feature)
    const recoveryKeyEncrypted = await encrypt(recoveryKey, dek);

    // 5. Generate RSA key pair
    const keyPair = await generateKeyPair();
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, dek);

    // 6. Set module state
    setDek(dek);

    return {
        recoveryKey,
        keyMaterial: {
            vault_key_salt: vaultKeySalt,
            encrypted_dek: encryptedDek,
            recovery_key_salt: recoveryKeySalt,
            encrypted_dek_recovery: encryptedDekRecovery,
            recovery_key_encrypted: recoveryKeyEncrypted,
            public_key: publicKey,
            encrypted_private_key: encryptedPrivateKey,
        },
    };
}

/**
 * Unlock vault with vault key.
 *
 * @param {object} blobs - { vault_key_salt, encrypted_dek } from server
 * @param {string} vaultKey - user's vault key
 * @returns {boolean} true if unlock succeeded
 */
export async function unlockVault(blobs, vaultKey) {
    const wrappingKey = await deriveWrappingKey(vaultKey, blobs.vault_key_salt);
    const dek = await unwrapDek(blobs.encrypted_dek, wrappingKey);
    if (!dek) return false;
    setDek(dek);
    return true;
}

/**
 * Lock vault — clear DEK from memory.
 */
export function lockVault() {
    lock();
}

/**
 * Change vault key. Unwraps DEK with old key, re-wraps with new.
 *
 * @param {object} oldBlobs - { vault_key_salt, encrypted_dek }
 * @param {string} currentVaultKey
 * @param {string} newVaultKey
 * @returns {{ vault_key_salt: string, encrypted_dek: string }}
 */
export async function changeVaultKey(oldBlobs, currentVaultKey, newVaultKey) {
    // Unwrap with current key
    const oldWrappingKey = await deriveWrappingKey(currentVaultKey, oldBlobs.vault_key_salt);
    const dek = await unwrapDek(oldBlobs.encrypted_dek, oldWrappingKey);
    if (!dek) throw new Error('Current vault key is incorrect');

    // Re-wrap with new key
    const newSalt = generateSalt();
    const newWrappingKey = await deriveWrappingKey(newVaultKey, newSalt);
    const newEncryptedDek = await wrapDek(dek, newWrappingKey);

    // Update module state with the (same) DEK
    setDek(dek);

    return {
        vault_key_salt: newSalt,
        encrypted_dek: newEncryptedDek,
    };
}

/**
 * Recover vault with recovery key. Unwraps DEK, sets new vault key + new recovery key.
 *
 * @param {object} recoveryBlobs - { recovery_key_salt, encrypted_dek_recovery }
 * @param {string} recoveryKey
 * @param {string} newVaultKey
 * @returns {object} All new blobs for server storage + newRecoveryKey
 */
export async function recoverWithRecoveryKey(recoveryBlobs, recoveryKey, newVaultKey) {
    // Unwrap DEK with recovery key
    const recoveryWrappingKey = await deriveWrappingKey(recoveryKey, recoveryBlobs.recovery_key_salt);
    const dek = await unwrapDek(recoveryBlobs.encrypted_dek_recovery, recoveryWrappingKey);
    if (!dek) throw new Error('Recovery key is incorrect');

    // Set DEK in module state
    setDek(dek);

    // New vault key wrapping
    const newVaultSalt = generateSalt();
    const newVaultWrappingKey = await deriveWrappingKey(newVaultKey, newVaultSalt);
    const newEncryptedDek = await wrapDek(dek, newVaultWrappingKey);

    // New recovery key
    const newRecoveryKey = generateRecoveryKey();
    const newRecoverySalt = generateSalt();
    const newRecoveryWrappingKey = await deriveWrappingKey(newRecoveryKey, newRecoverySalt);
    const newEncryptedDekRecovery = await wrapDek(dek, newRecoveryWrappingKey);

    // Encrypt new recovery key with DEK (for viewing later)
    const newRecoveryKeyEncrypted = await encrypt(newRecoveryKey, dek);

    return {
        vault_key_salt: newVaultSalt,
        encrypted_dek: newEncryptedDek,
        recovery_key_salt: newRecoverySalt,
        encrypted_dek_recovery: newEncryptedDekRecovery,
        recovery_key_encrypted: newRecoveryKeyEncrypted,
        recoveryKey: newRecoveryKey,
    };
}

/**
 * View the recovery key (requires vault to be unlocked).
 * Decrypts the recovery_key_encrypted blob stored on server.
 */
export async function viewRecoveryKey(recoveryKeyEncryptedBlob) {
    if (!_dek) throw new Error('Vault must be unlocked to view recovery key');
    return decrypt(recoveryKeyEncryptedBlob, _dek);
}
