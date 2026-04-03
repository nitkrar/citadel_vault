/**
 * KDF Integration Tests
 *
 * Multi-operation crypto chains that test iteration handling across
 * vault key changes, KDF changes, and recovery flows. Uses real
 * Web Crypto API (no mocks). Low iteration counts (100K/200K) for speed.
 *
 * These tests catch bugs like #20 where one operation silently wrote
 * the wrong iteration count, only detected 2+ operations later.
 */
import { describe, it, expect } from 'vitest';
import {
  encrypt, decrypt, lockVault,
  setupVault, unlockVault, changeVaultKey,
  reWrapDekIterations, regenerateRecoveryKey,
  recoverWithRecoveryKey,
  PBKDF2_ITERATIONS,
} from '../../src/client/lib/crypto.js';

const ITER_A = 100000; // default
const ITER_B = 200000; // non-default

// Helper to get DEK for encrypt/decrypt
const getDek = async () => (await import('../../src/client/lib/crypto.js'))._getDekForContext();

// ── Lifecycle Chains ─────────────────────────────────────────────────────

describe('Lifecycle chains', () => {
  it('setup → change KDF to 200K → change vault key → unlock at 200K', async () => {
    const key1 = 'ChainKey#1';
    const key2 = 'ChainKey#2';
    const { keyMaterial } = await setupVault(key1);

    // Encrypt data before any changes
    const dek = await getDek();
    const blob = await encrypt('chain-data', dek);

    // Change KDF: re-wrap at 200K
    const reWrapped = await reWrapDekIterations(key1, ITER_B);
    lockVault();
    await unlockVault(reWrapped, key1, ITER_B);

    // Change vault key (at 200K iterations)
    const newBlobs = await changeVaultKey(reWrapped, key1, key2, ITER_B);
    lockVault();

    // Unlock with new key at 200K
    const result = await unlockVault(newBlobs, key2, ITER_B);
    expect(result).toBe(true);

    // Original data still decrypts
    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('chain-data');
  });

  it('setup → change KDF to 200K → recover with recovery key → verify vault works', async () => {
    const vaultKey = 'RecoverChain#1';
    const { recoveryKey, keyMaterial } = await setupVault(vaultKey);

    // Encrypt data
    const dek = await getDek();
    const blob = await encrypt('recover-chain', dek);

    // Change KDF to 200K
    const reWrapped = await reWrapDekIterations(vaultKey, ITER_B);
    lockVault();

    // Recovery key was wrapped at setup time (100K) — independent of vault KDF
    const newKey = 'AfterRecover#1';
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      recoveryKey, newKey, ITER_A, ITER_B
    );

    // Vault should be unlocked with new key at 200K
    lockVault();
    const result = await unlockVault(recovered, newKey, ITER_B);
    expect(result).toBe(true);

    // Data still decrypts
    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('recover-chain');
  });

  it('setup → change KDF → change key → change KDF again → unlock', async () => {
    const key1 = 'LongChain#1';
    const key2 = 'LongChain#2';
    const { keyMaterial } = await setupVault(key1);

    // Encrypt data
    const dek = await getDek();
    const blob = await encrypt('long-chain', dek);

    // Step 1: change KDF 100K → 200K
    const blobs1 = await reWrapDekIterations(key1, ITER_B);
    lockVault();
    await unlockVault(blobs1, key1, ITER_B);

    // Step 2: change vault key (at 200K)
    const blobs2 = await changeVaultKey(blobs1, key1, key2, ITER_B);
    lockVault();
    await unlockVault(blobs2, key2, ITER_B);

    // Step 3: change KDF 200K → 100K (back to default)
    const blobs3 = await reWrapDekIterations(key2, ITER_A);
    lockVault();

    // Final unlock at 100K with key2
    const result = await unlockVault(blobs3, key2, ITER_A);
    expect(result).toBe(true);

    // Data still decrypts through all changes
    const finalDek = await getDek();
    expect(await decrypt(blob, finalDek)).toBe('long-chain');
  });
});

// ── Adversarial: Iteration Mismatch ──────────────────────────────────────

describe('Adversarial iteration mismatch', () => {
  it('correct key + wrong iterations → fails', async () => {
    const key = 'MismatchA#1';
    const { keyMaterial } = await setupVault(key);

    // Re-wrap at 200K
    const reWrapped = await reWrapDekIterations(key, ITER_B);
    lockVault();

    // Correct key but wrong iterations (100K instead of 200K)
    const result = await unlockVault(reWrapped, key, ITER_A);
    expect(result).toBe(false);
  });

  it('wrong key + correct iterations → fails', async () => {
    const { keyMaterial } = await setupVault('RightKey#1');

    const reWrapped = await reWrapDekIterations('RightKey#1', ITER_B);
    lockVault();

    // Wrong key, correct iterations
    const result = await unlockVault(reWrapped, 'WrongKey#1', ITER_B);
    expect(result).toBe(false);
  });

  it('wrong key + wrong iterations → fails', async () => {
    const { keyMaterial } = await setupVault('RightKey#2');

    const reWrapped = await reWrapDekIterations('RightKey#2', ITER_B);
    lockVault();

    // Both wrong
    const result = await unlockVault(reWrapped, 'WrongKey#2', ITER_A);
    expect(result).toBe(false);
  });

  it('correct key + correct iterations → succeeds (control)', async () => {
    const key = 'ControlKey#1';
    await setupVault(key);

    const reWrapped = await reWrapDekIterations(key, ITER_B);
    lockVault();

    const result = await unlockVault(reWrapped, key, ITER_B);
    expect(result).toBe(true);
  });
});

// ── Recovery After KDF Changes ───────────────────────────────────────────

describe('Recovery after KDF changes', () => {
  it('setup → change KDF to 200K → recovery key still works', async () => {
    const key = 'KdfRecovery#1';
    const { recoveryKey, keyMaterial } = await setupVault(key);

    // Change KDF — recovery key was wrapped at setup time, independent of vault KDF
    await reWrapDekIterations(key, ITER_B);
    lockVault();

    // Recovery key still works (uses original 100K iterations)
    const newKey = 'PostKdfKey#1';
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      recoveryKey, newKey
    );

    expect(recovered.vault_key_salt).toBeTruthy();
    expect(recovered.recoveryKey).toBeTruthy();
    expect(recovered.recoveryKey).not.toBe(recoveryKey); // rotated
  });

  it('setup → change KDF to 200K → change vault key → recovery key still works', async () => {
    const key1 = 'KdfRecKey#1';
    const key2 = 'KdfRecKey#2';
    const { recoveryKey, keyMaterial } = await setupVault(key1);

    // Encrypt data
    const dek = await getDek();
    const blob = await encrypt('kdf-rec-data', dek);

    // Change KDF to 200K
    const reWrapped = await reWrapDekIterations(key1, ITER_B);
    lockVault();
    await unlockVault(reWrapped, key1, ITER_B);

    // Change vault key
    await changeVaultKey(reWrapped, key1, key2, ITER_B);
    lockVault();

    // Recovery key from original setup still works
    const newKey = 'PostAllKey#1';
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: keyMaterial.recovery_key_salt, encrypted_dek_recovery: keyMaterial.encrypted_dek_recovery },
      recoveryKey, newKey
    );

    // Data still decrypts
    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('kdf-rec-data');
  });

  it('setup → regenerate recovery → old key fails, new works → data decrypts', async () => {
    const key = 'RegenChain#1';
    const { recoveryKey: oldRecKey, keyMaterial } = await setupVault(key);

    // Encrypt data
    const dek = await getDek();
    const blob = await encrypt('regen-data', dek);

    // Regenerate recovery key
    const regen = await regenerateRecoveryKey();
    lockVault();

    // Old recovery key fails with new blobs
    await expect(
      recoverWithRecoveryKey(
        { recovery_key_salt: regen.recovery_key_salt, encrypted_dek_recovery: regen.encrypted_dek_recovery },
        oldRecKey, 'NewKey#1'
      )
    ).rejects.toThrow('Recovery key is incorrect');

    // New recovery key works
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: regen.recovery_key_salt, encrypted_dek_recovery: regen.encrypted_dek_recovery },
      regen.recoveryKey, 'NewKey#1'
    );

    // Data still decrypts
    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('regen-data');
  });
});
