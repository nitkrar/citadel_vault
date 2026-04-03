/**
 * Encryption Flow Integration Tests (Items 11-17)
 *
 * Tests the full crypto chains as they happen in production:
 * real API calls + real Web Crypto. No mocks. Tests the wiring
 * between API data, preferences, and crypto functions.
 *
 * Requires: test server on port 8082 (started by globalSetup).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestUser, apiRequest, extractData, login } from '../helpers/integrationClient.js';
import {
  setupVault, unlockVault, changeVaultKey, lockVault,
  reWrapDekIterations, getKdfIterations,
  recoverWithRecoveryKey, regenerateRecoveryKey,
  verifyRecoveryKeyAndRotate,
  encrypt, decrypt,
  PBKDF2_ITERATIONS,
} from '../../src/client/lib/crypto.js';

const getDek = async () => (await import('../../src/client/lib/crypto.js'))._getDekForContext();

// ── 11. Unlock Flow ──────────────────────────────────────────────────────

describe('11. Unlock flow', () => {
  let user, vaultKey, recoveryKey;

  beforeAll(async () => {
    user = await createTestUser('unlock_flow_user', 'UnlockFlow#1');
    vaultKey = 'VaultUnlock#1';
  });

  it('setup vault → POST key material → returns recovery key', async () => {
    const result = await setupVault(vaultKey);
    recoveryKey = result.recoveryKey;
    expect(recoveryKey).toBeTruthy();
    expect(recoveryKey.length).toBe(32);

    // POST to server
    const resp = await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
    expect(resp.status).toBe(200);
  });

  it('fetch key material → unlock with correct key', async () => {
    lockVault();

    // Fetch blobs from server (same as EncryptionContext.unlock)
    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    expect(resp.status).toBe(200);
    const blobs = await extractData(resp);

    expect(blobs.has_vault_key).toBeTruthy();

    const success = await unlockVault(blobs, vaultKey, PBKDF2_ITERATIONS);
    expect(success).toBe(true);
  });

  it('encrypt data while unlocked → lock → re-unlock → decrypt', async () => {
    const dek = await getDek();
    const blob = await encrypt('unlock-flow-secret', dek);

    lockVault();

    // Re-fetch and unlock
    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const blobs = await extractData(resp);
    await unlockVault(blobs, vaultKey, PBKDF2_ITERATIONS);

    const newDek = await getDek();
    const result = await decrypt(blob, newDek);
    expect(result).toBe('unlock-flow-secret');
  });

  it('unlock with wrong key fails', async () => {
    lockVault();

    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const blobs = await extractData(resp);

    const success = await unlockVault(blobs, 'WrongKey#999', PBKDF2_ITERATIONS);
    expect(success).toBe(false);
  });
});

// ── 12. Setup Flow ───────────────────────────────────────────────────────

describe('12. Setup flow', () => {
  let user;

  beforeAll(async () => {
    user = await createTestUser('setup_flow_user', 'SetupFlow#1');
  });

  it('key material shows no vault key before setup', async () => {
    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const data = await extractData(resp);
    expect(data.has_vault_key).toBeFalsy();
  });

  it('setup vault → server stores blobs → key material shows vault exists', async () => {
    const vaultKey = 'SetupVault#1';
    const result = await setupVault(vaultKey);

    const resp = await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
    expect(resp.status).toBe(200);

    // Verify server knows vault exists
    const checkResp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const data = await extractData(checkResp);
    expect(data.has_vault_key).toBeTruthy();
    expect(data.vault_key_salt).toBeTruthy();
    expect(data.encrypted_dek).toBeTruthy();
  });

  it('setup rejects duplicate (RSA keys already exist)', async () => {
    const result = await setupVault('AnotherKey#1');
    const resp = await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
    // setup-rsa rejects if public_key already set
    expect(resp.status).toBe(400);
  });
});

// ── 13. Change Vault Key ─────────────────────────────────────────────────

describe('13. Change vault key', () => {
  let user, oldKey, recoveryKey;

  beforeAll(async () => {
    user = await createTestUser('change_key_user', 'ChangeKey#1');
    oldKey = 'OriginalKey#1';

    // Setup vault
    const result = await setupVault(oldKey);
    recoveryKey = result.recoveryKey;
    await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
  });

  it('fetch blobs → change key → POST → new key unlocks, old fails', async () => {
    const newKey = 'ChangedKey#2';

    // Fetch current blobs (same as EncryptionContext.changeVaultKey)
    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const blobs = await extractData(resp);

    // Re-wrap with new key
    const newBlobs = await changeVaultKey(
      { vault_key_salt: blobs.vault_key_salt, encrypted_dek: blobs.encrypted_dek },
      oldKey, newKey, PBKDF2_ITERATIONS
    );

    // POST new blobs
    const updateResp = await apiRequest('POST', '/encryption.php?action=update-vault-key', {
      token: user.token,
      json: newBlobs,
    });
    expect(updateResp.status).toBe(200);

    // Verify: fetch new blobs, unlock with new key
    lockVault();
    const checkResp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const updatedBlobs = await extractData(checkResp);

    const success = await unlockVault(updatedBlobs, newKey, PBKDF2_ITERATIONS);
    expect(success).toBe(true);

    // Old key should fail
    lockVault();
    const fail = await unlockVault(updatedBlobs, oldKey, PBKDF2_ITERATIONS);
    expect(fail).toBe(false);

    oldKey = newKey; // update for subsequent tests
  });

  it('data encrypted before key change survives', async () => {
    // Unlock with current key
    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const blobs = await extractData(resp);
    await unlockVault(blobs, oldKey, PBKDF2_ITERATIONS);

    // Encrypt data
    const dek = await getDek();
    const blob = await encrypt('survive-key-change', dek);

    // Change key
    const newKey = 'SurvivedKey#3';
    const newBlobs = await changeVaultKey(
      { vault_key_salt: blobs.vault_key_salt, encrypted_dek: blobs.encrypted_dek },
      oldKey, newKey, PBKDF2_ITERATIONS
    );
    await apiRequest('POST', '/encryption.php?action=update-vault-key', {
      token: user.token,
      json: newBlobs,
    });

    // Re-unlock with new key and decrypt
    lockVault();
    const newResp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const updatedBlobs = await extractData(newResp);
    await unlockVault(updatedBlobs, newKey, PBKDF2_ITERATIONS);

    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('survive-key-change');
  });
});

// ── 14. Change KDF Iterations ────────────────────────────────────────────

describe('14. Change KDF iterations', () => {
  let user, vaultKey;

  beforeAll(async () => {
    user = await createTestUser('change_kdf_user', 'ChangeKdf#1');
    vaultKey = 'KdfKey#1';

    const result = await setupVault(vaultKey);
    await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
  });

  it('verify vault key → re-wrap at 200K → POST blobs + preference → unlock at 200K', async () => {
    // Step 1: fetch blobs
    const resp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const blobs = await extractData(resp);

    // Step 2: verify vault key (same as EncryptionContext.changeKdfIterations)
    const verified = await unlockVault(blobs, vaultKey, PBKDF2_ITERATIONS);
    expect(verified).toBe(true);

    // Step 3: re-wrap at 200K
    const newBlobs = await reWrapDekIterations(vaultKey, 200000);

    // Step 4: POST new vault key blobs
    const updateResp = await apiRequest('POST', '/encryption.php?action=update-vault-key', {
      token: user.token,
      json: newBlobs,
    });
    expect(updateResp.status).toBe(200);

    // Step 5: PUT new kdf_iterations preference
    const prefResp = await apiRequest('PUT', '/preferences.php', {
      token: user.token,
      json: { kdf_iterations: '200000' },
    });
    expect(prefResp.status).toBe(200);

    // Verify: fetch preference and confirm it's 200K
    const prefsResp = await apiRequest('GET', '/preferences.php', { token: user.token });
    const prefs = await extractData(prefsResp);
    expect(getKdfIterations(prefs)).toBe(200000);

    // Verify: unlock at 200K works
    lockVault();
    const newResp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const updatedBlobs = await extractData(newResp);
    const success = await unlockVault(updatedBlobs, vaultKey, 200000);
    expect(success).toBe(true);

    // Verify: unlock at old 100K fails
    lockVault();
    const fail = await unlockVault(updatedBlobs, vaultKey, PBKDF2_ITERATIONS);
    expect(fail).toBe(false);
  });
});

// ── 15. Recovery Flow ────────────────────────────────────────────────────

describe('15. Recovery flow', () => {
  let user, vaultKey, recoveryKey, keyMaterial;

  beforeAll(async () => {
    user = await createTestUser('recovery_flow_user', 'RecoveryFlow#1');
    vaultKey = 'RecoverMe#1';

    const result = await setupVault(vaultKey);
    recoveryKey = result.recoveryKey;
    keyMaterial = result.keyMaterial;

    await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: keyMaterial,
    });
  });

  it('fetch recovery blobs → recover → POST all → fetch entries → unlock', async () => {
    // Encrypt data before recovery
    const dek = await getDek();
    const blob = await encrypt('pre-recovery-data', dek);
    lockVault();

    // Step 1: fetch recovery material
    const recResp = await apiRequest('GET', '/encryption.php?action=recovery-material', { token: user.token });
    expect(recResp.status).toBe(200);
    const recoveryBlobs = await extractData(recResp);

    // Step 2: recover — unwrap at default, re-wrap with new key at default
    const newVaultKey = 'AfterRecovery#1';
    const recovered = await recoverWithRecoveryKey(
      {
        recovery_key_salt: recoveryBlobs.recovery_key_salt,
        encrypted_dek_recovery: recoveryBlobs.encrypted_dek_recovery,
      },
      recoveryKey,
      newVaultKey,
      PBKDF2_ITERATIONS,
      PBKDF2_ITERATIONS,
    );

    expect(recovered.recoveryKey).toBeTruthy();
    expect(recovered.recoveryKey).not.toBe(recoveryKey);

    // Step 3: POST all new blobs
    const updateResp = await apiRequest('POST', '/encryption.php?action=update-all', {
      token: user.token,
      json: {
        vault_key_salt: recovered.vault_key_salt,
        encrypted_dek: recovered.encrypted_dek,
        recovery_key_salt: recovered.recovery_key_salt,
        encrypted_dek_recovery: recovered.encrypted_dek_recovery,
        recovery_key_encrypted: recovered.recovery_key_encrypted,
      },
    });
    expect(updateResp.status).toBe(200);

    // Step 4: verify vault entries endpoint works
    const entriesResp = await apiRequest('GET', '/vault.php', { token: user.token });
    expect(entriesResp.status).toBe(200);

    // Step 5: data still decrypts
    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('pre-recovery-data');

    // Step 6: old key fails, new key works
    lockVault();
    const newResp = await apiRequest('GET', '/encryption.php?action=key-material', { token: user.token });
    const newBlobs = await extractData(newResp);

    const oldFail = await unlockVault(newBlobs, vaultKey, PBKDF2_ITERATIONS);
    expect(oldFail).toBe(false);

    lockVault();
    const newSuccess = await unlockVault(newBlobs, newVaultKey, PBKDF2_ITERATIONS);
    expect(newSuccess).toBe(true);
  });
});

// ── 16. Regenerate Recovery Key ──────────────────────────────────────────

describe('16. Regenerate recovery key', () => {
  let user, vaultKey, originalRecoveryKey;

  beforeAll(async () => {
    user = await createTestUser('regen_recovery_user', 'RegenRecovery#1');
    vaultKey = 'RegenVault#1';

    const result = await setupVault(vaultKey);
    originalRecoveryKey = result.recoveryKey;
    await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
  });

  it('regenerate → POST → old key fails, new key recovers', async () => {
    // Encrypt data
    const dek = await getDek();
    const blob = await encrypt('regen-test-data', dek);

    // Regenerate
    const regen = await regenerateRecoveryKey();

    // POST to server
    const resp = await apiRequest('POST', '/encryption.php?action=update-recovery', {
      token: user.token,
      json: {
        recovery_key_salt: regen.recovery_key_salt,
        encrypted_dek_recovery: regen.encrypted_dek_recovery,
        recovery_key_encrypted: regen.recovery_key_encrypted,
      },
    });
    expect(resp.status).toBe(200);

    // Verify: fetch recovery material from server
    lockVault();
    const recResp = await apiRequest('GET', '/encryption.php?action=recovery-material', { token: user.token });
    const serverBlobs = await extractData(recResp);

    // Old recovery key fails with server blobs
    await expect(
      recoverWithRecoveryKey(
        { recovery_key_salt: serverBlobs.recovery_key_salt, encrypted_dek_recovery: serverBlobs.encrypted_dek_recovery },
        originalRecoveryKey, 'NewKey#1'
      )
    ).rejects.toThrow('Recovery key is incorrect');

    // New recovery key works
    const recovered = await recoverWithRecoveryKey(
      { recovery_key_salt: serverBlobs.recovery_key_salt, encrypted_dek_recovery: serverBlobs.encrypted_dek_recovery },
      regen.recoveryKey, 'NewKey#1'
    );

    // Data still decrypts
    const newDek = await getDek();
    expect(await decrypt(blob, newDek)).toBe('regen-test-data');
  });
});

// ── 17. Forgot Password (Unauthenticated) ────────────────────────────────

describe('17. Forgot password flow', () => {
  let username, password, vaultKey, recoveryKey;

  beforeAll(async () => {
    username = 'forgot_pw_user';
    password = 'ForgotPw#1';
    vaultKey = 'ForgotVault#1';

    const user = await createTestUser(username, password);

    // Setup vault
    const result = await setupVault(vaultKey);
    recoveryKey = result.recoveryKey;
    await apiRequest('POST', '/encryption.php?action=setup', {
      token: user.token,
      json: result.keyMaterial,
    });
    lockVault();
  });

  it('fetch material (unauth) → verify + rotate → POST new password + blobs', async () => {
    // Step 1: fetch recovery material (unauthenticated endpoint)
    const matResp = await fetch('http://localhost:8082/src/api/auth.php?action=forgot-password-material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    expect(matResp.status).toBe(200);
    const material = await matResp.json();
    const blobs = material.data;
    expect(blobs.recovery_key_salt).toBeTruthy();
    expect(blobs.encrypted_dek_recovery).toBeTruthy();

    // Step 2: verify recovery key + rotate (client-side)
    const rotated = await verifyRecoveryKeyAndRotate(
      { recovery_key_salt: blobs.recovery_key_salt, encrypted_dek_recovery: blobs.encrypted_dek_recovery },
      recoveryKey
    );
    expect(rotated.newRecoveryKey).toBeTruthy();
    expect(rotated.newRecoveryKey).not.toBe(recoveryKey);

    // Step 3: POST new password + rotated recovery blobs (unauthenticated)
    const newPassword = 'NewForgotPw#2';
    const resetResp = await fetch('http://localhost:8082/src/api/auth.php?action=forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        new_password: newPassword,
        confirm_password: newPassword,
        recovery_key_salt: rotated.recovery_key_salt,
        encrypted_dek_recovery: rotated.encrypted_dek_recovery,
        recovery_key_encrypted: rotated.recovery_key_encrypted,
      }),
    });
    expect(resetResp.status).toBe(200);

    // Step 4: verify — old password fails, new password works
    const oldLoginResp = await fetch('http://localhost:8082/src/api/auth.php?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    expect(oldLoginResp.status).toBe(401);

    const newLoginResp = await fetch('http://localhost:8082/src/api/auth.php?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: newPassword }),
    });
    expect(newLoginResp.status).toBe(200);

    // Step 5: verify — old recovery key no longer works
    const mat2 = await fetch('http://localhost:8082/src/api/auth.php?action=forgot-password-material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const blobs2 = (await mat2.json()).data;

    await expect(
      verifyRecoveryKeyAndRotate(
        { recovery_key_salt: blobs2.recovery_key_salt, encrypted_dek_recovery: blobs2.encrypted_dek_recovery },
        recoveryKey
      )
    ).rejects.toThrow('Recovery key is incorrect');
  });
});
