/**
 * Crypto Module Tests
 *
 * Tests the full client-side encryption stack: AES-256-GCM encryption/decryption,
 * key derivation (PBKDF2), key wrapping (AES-KW), vault lifecycle, and RSA sharing.
 * Uses Node's built-in Web Crypto API (same as browser).
 */
import { describe, it, expect } from 'vitest';
import {
  toBase64, fromBase64,
  generateDek, encrypt, decrypt, encryptEntry, decryptEntry,
  deriveWrappingKey, wrapDek, unwrapDek,
  setupVault, unlockVault, changeVaultKey, lockVault,
  reWrapDekIterations, getKdfIterations,
  generateRecoveryKey, recoverWithRecoveryKey, regenerateRecoveryKey,
  verifyRecoveryKeyAndRotate, viewRecoveryKey,
  generateKeyPair, exportPublicKey, importPublicKey,
  hybridEncrypt, hybridDecrypt,
  isUnlocked, lock,
  PBKDF2_ITERATIONS, PBKDF2_ITERATIONS_RECOMMENDED,
} from '../../src/client/lib/crypto.js';
import { validateVaultKey } from '../../src/client/lib/defaults.js';

// ── Base64 helpers ──────────────────────────────────────────────────────

describe('Base64 helpers', () => {
  it('round-trips a Uint8Array', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips empty buffer', () => {
    const original = new Uint8Array(0);
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(original);
  });

  it('produces valid base64 string', () => {
    const encoded = toBase64(new Uint8Array([72, 101, 108, 108, 111]));
    expect(encoded).toBe('SGVsbG8=');
  });
});

// ── AES-256-GCM Encryption ─────────────────────────────────────────────

describe('AES-256-GCM encrypt/decrypt', () => {
  it('round-trips a plaintext string', async () => {
    const dek = await generateDek();
    const plaintext = 'Hello, Citadel!';
    const blob = await encrypt(plaintext, dek);
    const result = await decrypt(blob, dek);
    expect(result).toBe(plaintext);
  });

  it('round-trips a JSON object via encryptEntry/decryptEntry', async () => {
    const dek = await generateDek();
    const obj = {
      name: 'AAPL Shares',
      template_name: 'Stocks',
      subtype: 'stocks',
      is_liability: false,
      currency: 'USD',
      raw_value: 5000,
      icon: 'trending-up',
    };
    const blob = await encryptEntry(obj, dek);
    const result = await decryptEntry(blob, dek);
    expect(result).toEqual(obj);
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const dek = await generateDek();
    const plaintext = 'same text';
    const blob1 = await encrypt(plaintext, dek);
    const blob2 = await encrypt(plaintext, dek);
    expect(blob1).not.toBe(blob2);
  });

  it('returns null when decrypting with wrong key', async () => {
    const dek1 = await generateDek();
    const dek2 = await generateDek();
    const blob = await encrypt('secret', dek1);
    const result = await decrypt(blob, dek2);
    expect(result).toBeNull();
  });

  it('returns null for corrupted ciphertext', async () => {
    const dek = await generateDek();
    const result = await decrypt('not-valid-base64-blob!!', dek);
    expect(result).toBeNull();
  });

  it('handles empty string', async () => {
    const dek = await generateDek();
    const blob = await encrypt('', dek);
    const result = await decrypt(blob, dek);
    expect(result).toBe('');
  });

  it('handles unicode content', async () => {
    const dek = await generateDek();
    const plaintext = '🔒 Vault Entry — £5,000 café résumé';
    const blob = await encrypt(plaintext, dek);
    const result = await decrypt(blob, dek);
    expect(result).toBe(plaintext);
  });

  it('encryptEntry throws on null input', async () => {
    const dek = await generateDek();
    await expect(encryptEntry(null, dek)).rejects.toThrow('Cannot encrypt null or undefined data');
  });

  it('encryptEntry throws on undefined input', async () => {
    const dek = await generateDek();
    await expect(encryptEntry(undefined, dek)).rejects.toThrow('Cannot encrypt null or undefined data');
  });

  it('encryptEntry succeeds with empty object', async () => {
    const dek = await generateDek();
    const blob = await encryptEntry({}, dek);
    const result = await decryptEntry(blob, dek);
    expect(result).toEqual({});
  });

  it('handles large JSON objects', async () => {
    const dek = await generateDek();
    const obj = {
      entries: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Entry ${i}`,
        value: Math.random() * 100000,
        currency: 'GBP',
      })),
    };
    const blob = await encryptEntry(obj, dek);
    const result = await decryptEntry(blob, dek);
    expect(result).toEqual(obj);
  });
});

// ── Key Derivation & Wrapping ───────────────────────────────────────────

describe('PBKDF2 key derivation + AES-KW wrapping', () => {
  it('wraps and unwraps a DEK with the same passphrase', async () => {
    const dek = await generateDek();
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const wrappingKey = await deriveWrappingKey('my-vault-key', salt);
    const wrapped = await wrapDek(dek, wrappingKey);

    const unwrapped = await unwrapDek(wrapped, wrappingKey);
    expect(unwrapped).not.toBeNull();

    // Verify the unwrapped key works for encryption
    const blob = await encrypt('test', unwrapped);
    const result = await decrypt(blob, dek);
    expect(result).toBe('test');
  });

  it('returns null when unwrapping with wrong passphrase', async () => {
    const dek = await generateDek();
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const wrappingKey = await deriveWrappingKey('correct-key', salt);
    const wrapped = await wrapDek(dek, wrappingKey);

    const wrongKey = await deriveWrappingKey('wrong-key', salt);
    const result = await unwrapDek(wrapped, wrongKey);
    expect(result).toBeNull();
  });

  it('different salts produce different wrapping keys', async () => {
    const salt1 = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const salt2 = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const key1 = await deriveWrappingKey('same-pass', salt1);
    const key2 = await deriveWrappingKey('same-pass', salt2);

    const dek = await generateDek();
    const wrapped1 = await wrapDek(dek, key1);
    const wrapped2 = await wrapDek(dek, key2);
    expect(wrapped1).not.toBe(wrapped2);
  });
});

// ── Vault Lifecycle ─────────────────────────────────────────────────────

describe('Vault lifecycle', () => {
  it('setupVault → unlockVault round-trip', async () => {
    const vaultKey = 'MyVaultKey#123';
    const { recoveryKey, keyMaterial } = await setupVault(vaultKey);

    expect(recoveryKey).toBeTruthy();
    expect(recoveryKey.length).toBe(32); // 16 bytes → 32 hex chars
    expect(keyMaterial.vault_key_salt).toBeTruthy();
    expect(keyMaterial.encrypted_dek).toBeTruthy();
    expect(keyMaterial.recovery_key_salt).toBeTruthy();
    expect(keyMaterial.encrypted_dek_recovery).toBeTruthy();
    expect(keyMaterial.recovery_key_encrypted).toBeTruthy();
    expect(keyMaterial.public_key).toBeTruthy();
    expect(keyMaterial.encrypted_private_key).toBeTruthy();

    // Encrypt something while vault is open
    const blob = await encrypt('test-data', (await generateDek()));

    // Lock and re-unlock
    lockVault();
    expect(isUnlocked()).toBe(false);

    const unlocked = await unlockVault(keyMaterial, vaultKey);
    expect(unlocked).toBe(true);
    expect(isUnlocked()).toBe(true);
  });

  it('unlockVault fails with wrong vault key', async () => {
    const { keyMaterial } = await setupVault('CorrectKey#1');
    lockVault();

    const unlocked = await unlockVault(keyMaterial, 'WrongKey#999');
    expect(unlocked).toBe(false);
  });

  it('changeVaultKey → old key fails, new key works', async () => {
    const oldKey = 'OldKey#1';
    const newKey = 'NewKey#2';
    const { keyMaterial } = await setupVault(oldKey);

    const newBlobs = await changeVaultKey(keyMaterial, oldKey, newKey);
    lockVault();

    // Old key should fail
    const oldResult = await unlockVault(
      { vault_key_salt: newBlobs.vault_key_salt, encrypted_dek: newBlobs.encrypted_dek },
      oldKey
    );
    expect(oldResult).toBe(false);

    // New key should work
    const newResult = await unlockVault(
      { vault_key_salt: newBlobs.vault_key_salt, encrypted_dek: newBlobs.encrypted_dek },
      newKey
    );
    expect(newResult).toBe(true);
  });

  it('data encrypted before key change is still decryptable after', async () => {
    const oldKey = 'OldKey#1';
    const newKey = 'NewKey#2';
    const { keyMaterial } = await setupVault(oldKey);

    // Encrypt data with current DEK
    const dek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const blob = await encrypt('important-data', dek);

    // Change vault key (DEK stays the same)
    const newBlobs = await changeVaultKey(keyMaterial, oldKey, newKey);
    lockVault();

    // Unlock with new key
    await unlockVault(
      { vault_key_salt: newBlobs.vault_key_salt, encrypted_dek: newBlobs.encrypted_dek },
      newKey
    );

    // Data should still decrypt
    const newDek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const result = await decrypt(blob, newDek);
    expect(result).toBe('important-data');
  });
});

// ── Recovery Key ────────────────────────────────────────────────────────

describe('Recovery key', () => {
  it('generateRecoveryKey produces 32 hex chars', () => {
    const key = generateRecoveryKey();
    expect(key.length).toBe(32);
    expect(/^[0-9a-f]{32}$/.test(key)).toBe(true);
  });

  it('recoverWithRecoveryKey restores access', async () => {
    const vaultKey = 'Original#1';
    const { recoveryKey, keyMaterial } = await setupVault(vaultKey);

    // Encrypt some data
    const dek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const blob = await encrypt('my-secret', dek);

    lockVault();

    // Recover with recovery key
    const newVaultKey = 'NewAfterRecovery#1';
    const recovered = await recoverWithRecoveryKey(
      {
        recovery_key_salt: keyMaterial.recovery_key_salt,
        encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery,
      },
      recoveryKey,
      newVaultKey
    );

    expect(recovered.vault_key_salt).toBeTruthy();
    expect(recovered.encrypted_dek).toBeTruthy();
    expect(recovered.recoveryKey).toBeTruthy();
    expect(recovered.recoveryKey).not.toBe(recoveryKey); // new recovery key generated

    // Original data should still decrypt
    const newDek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const result = await decrypt(blob, newDek);
    expect(result).toBe('my-secret');
  });

  it('recoverWithRecoveryKey fails with wrong recovery key', async () => {
    const { keyMaterial } = await setupVault('VaultKey#1');
    lockVault();

    await expect(
      recoverWithRecoveryKey(
        {
          recovery_key_salt: keyMaterial.recovery_key_salt,
          encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery,
        },
        'wrong-recovery-key-value-abcdef',
        'NewKey#1'
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });

  it('regenerateRecoveryKey produces new key and valid blobs', async () => {
    const { recoveryKey: originalKey, keyMaterial } = await setupVault('VaultKey#1');

    // Encrypt data before regeneration
    const dek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const blob = await encrypt('secret-data', dek);

    // Regenerate
    const result = await regenerateRecoveryKey();
    expect(result.recoveryKey).toBeTruthy();
    expect(result.recoveryKey.length).toBe(32);
    expect(result.recoveryKey).not.toBe(originalKey);
    expect(result.recovery_key_salt).toBeTruthy();
    expect(result.encrypted_dek_recovery).toBeTruthy();
    expect(result.recovery_key_encrypted).toBeTruthy();

    // New recovery key can recover the vault
    lockVault();
    const recovered = await recoverWithRecoveryKey(
      {
        recovery_key_salt: result.recovery_key_salt,
        encrypted_dek_recovery: result.encrypted_dek_recovery,
      },
      result.recoveryKey,
      'NewVaultKey#1'
    );
    expect(recovered.vault_key_salt).toBeTruthy();

    // Original data still decrypts after recovery with new key
    const newDek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const decrypted = await decrypt(blob, newDek);
    expect(decrypted).toBe('secret-data');
  });

  it('regenerateRecoveryKey invalidates old recovery key', async () => {
    const { recoveryKey: oldKey, keyMaterial } = await setupVault('VaultKey#1');

    const result = await regenerateRecoveryKey();

    lockVault();

    // Old key should no longer work with the new blobs
    await expect(
      recoverWithRecoveryKey(
        {
          recovery_key_salt: result.recovery_key_salt,
          encrypted_dek_recovery: result.encrypted_dek_recovery,
        },
        oldKey,
        'NewKey#1'
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });

  it('regenerateRecoveryKey fails when vault is locked', async () => {
    await setupVault('VaultKey#1');
    lockVault();

    await expect(regenerateRecoveryKey()).rejects.toThrow('Vault must be unlocked');
  });

  it('verifyRecoveryKeyAndRotate returns rotated blobs', async () => {
    const { recoveryKey, keyMaterial } = await setupVault('VaultKey#1');

    const rotated = await verifyRecoveryKeyAndRotate(
      {
        recovery_key_salt: keyMaterial.recovery_key_salt,
        encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery,
      },
      recoveryKey
    );

    expect(rotated.newRecoveryKey).toBeTruthy();
    expect(rotated.newRecoveryKey).not.toBe(recoveryKey);
    expect(rotated.recovery_key_salt).toBeTruthy();
    expect(rotated.encrypted_dek_recovery).toBeTruthy();
    expect(rotated.recovery_key_encrypted).toBeTruthy();
  });

  it('verifyRecoveryKeyAndRotate fails with wrong key', async () => {
    const { keyMaterial } = await setupVault('VaultKey#1');

    await expect(
      verifyRecoveryKeyAndRotate(
        {
          recovery_key_salt: keyMaterial.recovery_key_salt,
          encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery,
        },
        'wrong-key-wrong-key-wrong-key-00'
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });

  it('viewRecoveryKey decrypts stored blob', async () => {
    const { recoveryKey, keyMaterial } = await setupVault('VaultKey#1');

    const viewed = await viewRecoveryKey(keyMaterial.recovery_key_encrypted);
    expect(viewed).toBe(recoveryKey);
  });

  it('viewRecoveryKey fails when vault is locked', async () => {
    const { keyMaterial } = await setupVault('VaultKey#1');
    lockVault();

    await expect(
      viewRecoveryKey(keyMaterial.recovery_key_encrypted)
    ).rejects.toThrow('Vault must be unlocked');
  });
});

// ── RSA Hybrid Encryption (Sharing) ─────────────────────────────────────

describe('RSA hybrid encrypt/decrypt', () => {
  it('round-trips a message via hybrid encryption', async () => {
    const keyPair = await generateKeyPair();
    const pubKeyBase64 = await exportPublicKey(keyPair.publicKey);
    const importedPubKey = await importPublicKey(pubKeyBase64);

    const plaintext = JSON.stringify({ title: 'Shared Secret', value: 42 });
    const blob = await hybridEncrypt(plaintext, importedPubKey);
    const result = await hybridDecrypt(blob, keyPair.privateKey);

    expect(result).toBe(plaintext);
  });

  it('fails to decrypt with wrong private key', async () => {
    const keyPair1 = await generateKeyPair();
    const keyPair2 = await generateKeyPair();
    const pubKey1 = await exportPublicKey(keyPair1.publicKey);
    const importedPub1 = await importPublicKey(pubKey1);

    const blob = await hybridEncrypt('secret', importedPub1);

    // Decrypt with keyPair2's private key should fail
    await expect(hybridDecrypt(blob, keyPair2.privateKey)).rejects.toThrow();
  });
});

// ── Snapshot-specific round-trip ────────────────────────────────────────

describe('Snapshot encryption round-trip', () => {
  it('encrypts and decrypts a snapshot meta blob', async () => {
    const dek = await generateDek();
    const meta = { base_currency: 'GBP', date: '2026-03-14T10:00:00.000Z' };
    const blob = await encryptEntry(meta, dek);
    const result = await decryptEntry(blob, dek);
    expect(result).toEqual(meta);
  });

  it('encrypts and decrypts per-entry snapshot blobs', async () => {
    const dek = await generateDek();
    const entries = [
      { name: 'AAPL Shares', template_name: 'Stocks', subtype: 'stocks', is_liability: false, currency: 'USD', raw_value: 5000, icon: 'trending-up' },
      { name: 'Credit Card', template_name: 'Credit Card', subtype: 'credit_card', is_liability: true, currency: 'GBP', raw_value: -2000, icon: 'credit-card' },
    ];

    const blobs = [];
    for (const entry of entries) {
      blobs.push(await encryptEntry(entry, dek));
    }

    for (let i = 0; i < entries.length; i++) {
      const result = await decryptEntry(blobs[i], dek);
      expect(result).toEqual(entries[i]);
    }
  });

  it('snapshot blobs encrypted with one DEK cannot be decrypted with another', async () => {
    const dek1 = await generateDek();
    const dek2 = await generateDek();
    const entry = { name: 'Test', currency: 'GBP', raw_value: 100 };
    const blob = await encryptEntry(entry, dek1);
    const result = await decryptEntry(blob, dek2);
    expect(result).toBeNull();
  });
});

// ── Edge cases (extended) ────────────────────────────────────────────

describe('Edge cases', () => {
  it('encryptEntry with undefined values — JSON.stringify drops them', async () => {
    // JSON.stringify({ a: 1, b: undefined }) => '{"a":1}' — b is silently dropped
    const dek = await generateDek();
    const obj = { title: 'test', value: undefined, nested: { x: undefined } };
    const blob = await encryptEntry(obj, dek);
    const decrypted = await decryptEntry(blob, dek);
    // undefined values should be dropped by JSON.stringify
    expect(decrypted).toEqual({ title: 'test', nested: {} });
    expect(decrypted).not.toHaveProperty('value');
  });

  it('deriveWrappingKey with empty string passphrase — PBKDF2 accepts it', async () => {
    // PBKDF2 does not reject empty passphrases — this is a known behavior
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    // Should not throw — PBKDF2 accepts empty input
    const key = await deriveWrappingKey('', salt);
    expect(key).toBeTruthy();
    expect(key.type).toBe('secret');
  });

  it('encryptEntry rejects null', async () => {
    const dek = await generateDek();
    await expect(encryptEntry(null, dek)).rejects.toThrow('Cannot encrypt null');
  });

  it('encryptEntry rejects undefined', async () => {
    const dek = await generateDek();
    await expect(encryptEntry(undefined, dek)).rejects.toThrow('Cannot encrypt null');
  });

  it('encryptEntry handles empty object', async () => {
    const dek = await generateDek();
    const blob = await encryptEntry({}, dek);
    const decrypted = await decryptEntry(blob, dek);
    expect(decrypted).toEqual({});
  });

  it('encryptEntry handles object with only undefined values', async () => {
    const dek = await generateDek();
    const blob = await encryptEntry({ a: undefined, b: undefined }, dek);
    const decrypted = await decryptEntry(blob, dek);
    expect(decrypted).toEqual({}); // all undefined values dropped
  });
});

// ── PBKDF2 Iteration Migration ──────────────────────────────────────────

describe('PBKDF2 iteration migration', () => {
  it('exports correct iteration constants', () => {
    expect(PBKDF2_ITERATIONS).toBe(100000);
    expect(PBKDF2_ITERATIONS_RECOMMENDED).toBe(600000);
  });

  it('unlockVault works with default iterations', async () => {
    // Setup creates with 100K (default)
    const { keyMaterial } = await setupVault('TestKey#1');
    lockVault();

    // Unlock with default 100K iterations
    const result = await unlockVault(keyMaterial, 'TestKey#1', PBKDF2_ITERATIONS);
    expect(result).toBe(true);
  });

  it('unlockVault fails when iterations mismatch', async () => {
    // Setup with 100K (default), try unlock with 600K — different derived key, unwrap fails
    const { keyMaterial } = await setupVault('TestKey#2');
    lockVault();

    const result = await unlockVault(keyMaterial, 'TestKey#2', PBKDF2_ITERATIONS_RECOMMENDED);
    expect(result).toBe(false);
  });

  it('deriveWrappingKey produces different keys for different iterations', async () => {
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const dek = await generateDek();

    const key100k = await deriveWrappingKey('same-pass', salt, 100000);
    const key600k = await deriveWrappingKey('same-pass', salt, 600000);

    const wrapped100k = await wrapDek(dek, key100k);
    const wrapped600k = await wrapDek(dek, key600k);
    expect(wrapped100k).not.toBe(wrapped600k);

    // Cross-unwrap should fail
    const cross = await unwrapDek(wrapped100k, key600k);
    expect(cross).toBeNull();
  });

  it('reWrapDekIterations re-wraps with default iterations', async () => {
    const vaultKey = 'MigrateKey#1';
    const { keyMaterial } = await setupVault(vaultKey);

    // Vault is unlocked after setup — reWrap uses DEK in memory
    const newBlobs = await reWrapDekIterations(vaultKey);
    expect(newBlobs.vault_key_salt).toBeTruthy();
    expect(newBlobs.encrypted_dek).toBeTruthy();

    // New blobs should differ from original (new salt)
    expect(newBlobs.vault_key_salt).not.toBe(keyMaterial.vault_key_salt);

    // Unlock with new blobs at default iterations should work
    lockVault();
    const result = await unlockVault(newBlobs, vaultKey, PBKDF2_ITERATIONS);
    expect(result).toBe(true);
  });

  it('reWrapDekIterations accepts custom target iterations', async () => {
    const vaultKey = 'CustomIter#1';
    await setupVault(vaultKey);

    // Re-wrap at 200K
    const newBlobs = await reWrapDekIterations(vaultKey, 200000);
    lockVault();

    // Unlock at 200K should work
    const result = await unlockVault(newBlobs, vaultKey, 200000);
    expect(result).toBe(true);

    // Unlock at default 100K should fail (wrapped at 200K)
    lockVault();
    const wrong = await unlockVault(newBlobs, vaultKey, PBKDF2_ITERATIONS);
    expect(wrong).toBe(false);
  });

  it('reWrapDekIterations throws when vault is locked', async () => {
    lockVault();
    await expect(reWrapDekIterations('any-key')).rejects.toThrow('Vault must be unlocked');
  });

  it('changeVaultKey accepts oldIterations param', async () => {
    const oldKey = 'OldIter#1';
    const newKey = 'NewIter#2';
    const { keyMaterial } = await setupVault(oldKey);

    // Change key, passing current iterations for unwrap
    const newBlobs = await changeVaultKey(keyMaterial, oldKey, newKey, PBKDF2_ITERATIONS);
    lockVault();

    // New key with default (600K) iterations should work
    const result = await unlockVault(newBlobs, newKey, PBKDF2_ITERATIONS);
    expect(result).toBe(true);
  });

  it('full migration flow: setup at 100K → unlock → reWrap at 600K → unlock with new blobs', async () => {
    const vaultKey = 'FullFlow#1';
    const { keyMaterial } = await setupVault(vaultKey);

    // Encrypt data while unlocked
    const dek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const blob = await encrypt('migration-test', dek);

    // Re-wrap at recommended 600K (simulates user upgrading via Security page)
    const newBlobs = await reWrapDekIterations(vaultKey, PBKDF2_ITERATIONS_RECOMMENDED);
    lockVault();

    // Unlock with new blobs at 600K
    await unlockVault(newBlobs, vaultKey, PBKDF2_ITERATIONS_RECOMMENDED);

    // Data should still decrypt (DEK unchanged)
    const newDek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const result = await decrypt(blob, newDek);
    expect(result).toBe('migration-test');
  });

  it('setupVault at default cannot unlock at 200K', async () => {
    const { keyMaterial } = await setupVault('TestKey#3');
    lockVault();
    const result = await unlockVault(keyMaterial, 'TestKey#3', 200000);
    expect(result).toBe(false);
  });

  it('changeVaultKey without iterations fails when setup used non-default', async () => {
    // Setup at default, re-wrap at 200K to simulate user with non-default KDF
    const vaultKey = 'IterBug#1';
    const { keyMaterial } = await setupVault(vaultKey);
    const reWrapped = await reWrapDekIterations(vaultKey, 200000);
    lockVault();

    // Unlock at 200K (correct)
    await unlockVault(reWrapped, vaultKey, 200000);

    // Change key WITHOUT passing iterations — defaults to 100K, unwrap at 200K fails
    const newKey = 'NewIterBug#1';
    await expect(
      changeVaultKey(reWrapped, vaultKey, newKey, PBKDF2_ITERATIONS)
    ).rejects.toThrow('Current vault key is incorrect');
  });

  it('changeVaultKey preserves iteration count in new blobs', async () => {
    const oldKey = 'PreserveIter#1';
    const newKey = 'PreserveIter#2';
    const { keyMaterial } = await setupVault(oldKey);

    // Re-wrap at 200K
    const reWrapped = await reWrapDekIterations(oldKey, 200000);
    lockVault();
    await unlockVault(reWrapped, oldKey, 200000);

    // Change key with correct iterations (200K)
    const newBlobs = await changeVaultKey(reWrapped, oldKey, newKey, 200000);
    lockVault();

    // New key should work at 200K (iterations preserved)
    const result = await unlockVault(newBlobs, newKey, 200000);
    expect(result).toBe(true);

    // New key should NOT work at 100K
    lockVault();
    const wrong = await unlockVault(newBlobs, newKey, PBKDF2_ITERATIONS);
    expect(wrong).toBe(false);
  });

  it('changeVaultKey with wrong current key throws', async () => {
    const { keyMaterial } = await setupVault('RightKey#1');
    await expect(
      changeVaultKey(keyMaterial, 'WrongKey#1', 'NewKey#1', PBKDF2_ITERATIONS)
    ).rejects.toThrow('Current vault key is incorrect');
  });

  it('reWrapDekIterations with wrong vault key produces unusable blobs', async () => {
    const correctKey = 'CorrectRewrap#1';
    await setupVault(correctKey);

    // Re-wrap with wrong key — wraps DEK with wrong-key-derived wrapping key
    const badBlobs = await reWrapDekIterations('WrongRewrap#1', 200000);
    lockVault();

    // Correct key at 200K can't unwrap (was wrapped with wrong-key-derived key)
    const result = await unlockVault(badBlobs, correctKey, 200000);
    expect(result).toBe(false);
  });

  it('reWrapDekIterations preserves DEK — data still decrypts', async () => {
    const vaultKey = 'DataPreserve#1';
    await setupVault(vaultKey);

    const dek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const blob = await encrypt('preserve-test', dek);

    // Re-wrap at 200K
    const newBlobs = await reWrapDekIterations(vaultKey, 200000);
    lockVault();
    await unlockVault(newBlobs, vaultKey, 200000);

    // Same data decrypts (DEK unchanged, only wrapping changed)
    const newDek = (await import('../../src/client/lib/crypto.js'))._getDekForContext();
    const result = await decrypt(blob, newDek);
    expect(result).toBe('preserve-test');
  });

  it('recoverWithRecoveryKey fails with wrong recoveryIterations', async () => {
    const { recoveryKey, keyMaterial } = await setupVault('RecIter#1');
    lockVault();

    // Recovery key was wrapped at default (100K). Try with 200K — wrong derived key.
    await expect(
      recoverWithRecoveryKey(
        { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
        recoveryKey, 'NewKey#1', 200000, PBKDF2_ITERATIONS
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });

  it('recoverWithRecoveryKey — old vault key fails after recovery', async () => {
    const oldKey = 'OldVault#1';
    const { recoveryKey, keyMaterial } = await setupVault(oldKey);
    lockVault();

    const newKey = 'NewVault#1';
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      recoveryKey, newKey
    );
    lockVault();

    // Old key should not work with new blobs
    const result = await unlockVault(recovered, oldKey, PBKDF2_ITERATIONS);
    expect(result).toBe(false);
  });

  it('recoverWithRecoveryKey — old recovery key fails (rotated)', async () => {
    const { recoveryKey: oldRecKey, keyMaterial } = await setupVault('RotateRec#1');
    lockVault();

    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      oldRecKey, 'NewKey#1'
    );
    lockVault();

    // Old recovery key with NEW blobs should fail
    await expect(
      recoverWithRecoveryKey(
        { recovery_key_salt: recovered.recovery_key_salt, encrypted_dek_recovery: recovered.encrypted_dek_recovery },
        oldRecKey, 'AnotherKey#1'
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });

  it('recoverWithRecoveryKey respects newIterations param', async () => {
    const { recoveryKey, keyMaterial } = await setupVault('IterRecover#1');
    lockVault();

    // Recover with newIterations=200K
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      recoveryKey, 'NewKey#1', PBKDF2_ITERATIONS, 200000
    );
    lockVault();

    // Should unlock at 200K
    const result = await unlockVault(recovered, 'NewKey#1', 200000);
    expect(result).toBe(true);

    // Should NOT unlock at default 100K
    lockVault();
    const wrong = await unlockVault(recovered, 'NewKey#1', PBKDF2_ITERATIONS);
    expect(wrong).toBe(false);
  });

  it('verifyRecoveryKeyAndRotate fails with wrong iterations', async () => {
    const { recoveryKey, keyMaterial } = await setupVault('VerifyIter#1');

    await expect(
      verifyRecoveryKeyAndRotate(
        { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
        recoveryKey, 200000 // wrong — was wrapped at 100K
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });

  it('verifyRecoveryKeyAndRotate — old key cannot unwrap new blobs', async () => {
    const { recoveryKey, keyMaterial } = await setupVault('RotateVerify#1');

    const rotated = await verifyRecoveryKeyAndRotate(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      recoveryKey
    );

    // Old recovery key should fail against new blobs
    await expect(
      verifyRecoveryKeyAndRotate(
        { recovery_key_salt: rotated.recovery_key_salt, encrypted_dek_recovery: rotated.encrypted_dek_recovery },
        recoveryKey
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });
});

// ── getKdfIterations ─────────────────────────────────────────────────────

describe('getKdfIterations', () => {
  it('returns 100K when preferences is null', () => {
    expect(getKdfIterations(null)).toBe(100000);
  });

  it('returns 100K when preferences is undefined', () => {
    expect(getKdfIterations(undefined)).toBe(100000);
  });

  it('returns 100K when kdf_iterations key is missing', () => {
    expect(getKdfIterations({})).toBe(100000);
  });

  it('returns 100K when kdf_iterations is empty string', () => {
    expect(getKdfIterations({ kdf_iterations: '' })).toBe(100000);
  });

  it('returns 100K when kdf_iterations is 0', () => {
    expect(getKdfIterations({ kdf_iterations: '0' })).toBe(100000);
  });

  it('returns 100K when kdf_iterations is negative', () => {
    expect(getKdfIterations({ kdf_iterations: '-1' })).toBe(100000);
  });

  it('returns 100K when kdf_iterations is non-numeric', () => {
    expect(getKdfIterations({ kdf_iterations: 'abc' })).toBe(100000);
  });

  it('returns parsed value for valid string', () => {
    expect(getKdfIterations({ kdf_iterations: '200000' })).toBe(200000);
  });

  it('returns parsed value for valid number', () => {
    expect(getKdfIterations({ kdf_iterations: 600000 })).toBe(600000);
  });
});

// ── validateVaultKey ─────────────────────────────────────────────────────

describe('validateVaultKey', () => {
  it('returns null for valid alphanumeric key (8+ chars)', () => {
    expect(validateVaultKey('MyVault#1', 'alphanumeric')).toBeNull();
  });

  it('returns null for valid numeric key (6+ chars)', () => {
    expect(validateVaultKey('123456', 'numeric')).toBeNull();
  });

  it('returns null for valid passphrase (16+ chars)', () => {
    expect(validateVaultKey('this is my long pass', 'passphrase')).toBeNull();
  });

  it('returns error for too-short alphanumeric key', () => {
    expect(validateVaultKey('Short#1', 'alphanumeric')).toMatch(/at least 8/);
  });

  it('returns error for too-short numeric key', () => {
    expect(validateVaultKey('12345', 'numeric')).toMatch(/at least 6/);
  });

  it('returns error for too-short passphrase', () => {
    expect(validateVaultKey('short phrase', 'passphrase')).toMatch(/at least 16/);
  });

  it('returns error for empty string', () => {
    expect(validateVaultKey('', 'alphanumeric')).toMatch(/at least/);
  });

  it('returns error for null', () => {
    expect(validateVaultKey(null, 'alphanumeric')).toMatch(/at least/);
  });

  it('returns error for undefined', () => {
    expect(validateVaultKey(undefined, 'alphanumeric')).toMatch(/at least/);
  });

  it('falls back to alphanumeric (8) when keyType is unknown', () => {
    expect(validateVaultKey('Valid#12', 'unknown_type')).toBeNull();
    expect(validateVaultKey('Short', 'unknown_type')).toMatch(/at least 8/);
  });
});
