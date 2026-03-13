import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { isTruthy, apiData } from '../lib/checks';
import * as crypto from '../lib/crypto';
import { entryStore } from '../lib/entryStore';
import { getUserPreference, PREFERENCE_DEFAULTS } from '../lib/defaults';
import { useAuth } from './AuthContext';

const EncryptionContext = createContext(null);

export function EncryptionProvider({ children, user }) {
  const { preferences } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [vaultKeyExists, setVaultKeyExists] = useState(false);
  const [vaultPromptForced, setVaultPromptForced] = useState(null); // null = initial, true = forced, false = skipped

  const autoLockTimerRef = useRef(null);
  const activityTimerRef = useRef(null);

  // ------------------------------------------------------------------
  // Auto-lock timer management
  // ------------------------------------------------------------------
  const clearAutoLock = useCallback(() => {
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  }, []);

  const startAutoLock = useCallback((prefs) => {
    clearAutoLock();
    const mode = getUserPreference(prefs, 'auto_lock_mode');
    if (mode !== 'timed') return;

    const timeout = parseInt(getUserPreference(prefs, 'auto_lock_timeout'), 10) || 3600;
    autoLockTimerRef.current = setTimeout(() => {
      // Auto-lock fires
      crypto.lockVault();
      entryStore.clear().catch(() => {});
      setIsUnlocked(false);
    }, timeout * 1000);
  }, [clearAutoLock]);

  // Reset auto-lock on user activity
  const resetAutoLock = useCallback(() => {
    if (autoLockTimerRef.current) {
      startAutoLock(preferences);
    }
  }, [startAutoLock, preferences]);

  // Attach activity listeners when unlocked
  useEffect(() => {
    if (!isUnlocked) return;
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    // Debounce: only reset every 30 seconds
    let lastReset = Date.now();
    const handler = () => {
      if (Date.now() - lastReset > 30000) {
        lastReset = Date.now();
        resetAutoLock();
      }
    };
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, handler));
  }, [isUnlocked, resetAutoLock]);

  // ------------------------------------------------------------------
  // Session persistence helpers
  // ------------------------------------------------------------------
  const saveSession = useCallback((keyMaterial, vaultKey) => {
    // Store just enough to re-derive DEK on refresh (vault key is NOT stored)
    // We store the wrapped DEK + salt so we can re-derive without the vault key
    // Actually: we store the vault key temporarily in sessionStorage (tab-scoped)
    // This is the tradeoff: convenience vs XSS risk (sessionStorage is tab-scoped)
    try {
      sessionStorage.setItem('pv_session_salt', keyMaterial.vault_key_salt);
      sessionStorage.setItem('pv_session_edek', keyMaterial.encrypted_dek);
      sessionStorage.setItem('pv_session_vk', vaultKey);
    } catch {}
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem('pv_session_salt');
    sessionStorage.removeItem('pv_session_edek');
    sessionStorage.removeItem('pv_session_vk');
  }, []);

  const hasSession = useCallback(() => {
    return !!sessionStorage.getItem('pv_session_vk');
  }, []);

  // ------------------------------------------------------------------
  // Lock vault
  // ------------------------------------------------------------------
  const lock = useCallback(async () => {
    crypto.lockVault();
    await entryStore.clear().catch(() => {});
    clearAutoLock();
    clearSession();
    setIsUnlocked(false);
  }, [clearAutoLock, clearSession]);

  // ------------------------------------------------------------------
  // Unlock vault
  // ------------------------------------------------------------------
  const unlock = useCallback(async (vaultKey) => {
    setIsLoading(true);
    try {
      // 1. Fetch vault key material
      const { data: keyResp } = await api.get('/encryption.php?action=key-material');
      const keyMaterial = apiData({ data: keyResp });

      if (!keyMaterial.has_vault_key) {
        throw new Error('Vault not set up.');
      }

      // 2. Derive key and unwrap DEK client-side
      const success = await crypto.unlockVault(
        {
          vault_key_salt: keyMaterial.vault_key_salt,
          encrypted_dek: keyMaterial.encrypted_dek,
        },
        vaultKey
      );

      if (!success) {
        throw new Error('Invalid vault key.');
      }

      // 4. Fetch vault entries (only encrypted data needs vault unlock)
      const { data: entriesResp } = await api.get('/vault.php');
      const entries = apiData({ data: entriesResp }) || [];
      await entryStore.putAll(entries);

      // 5. Set state
      setIsUnlocked(true);
      setVaultPromptForced(false);

      // 6. Start auto-lock timer (preferences already loaded on mount)
      startAutoLock(preferences);

      // 7. Save session for refresh persistence if preference is on
      if (getUserPreference(preferences, 'vault_persist_session') === 'persist_in_tab') {
        saveSession(keyMaterial, vaultKey);
      }

      return { success: true };
    } catch (err) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [startAutoLock, saveSession, preferences]);

  // ------------------------------------------------------------------
  // Setup vault (first time)
  // ------------------------------------------------------------------
  const setup = useCallback(async (vaultKey) => {
    setIsLoading(true);
    try {
      // 1. Generate all crypto material client-side
      const result = await crypto.setupVault(vaultKey);

      // 2. Send blobs to server for storage
      await api.post('/encryption.php?action=setup', result.keyMaterial);

      // 3. Set state (preferences already loaded on mount)
      setIsUnlocked(true);
      setVaultKeyExists(true);
      setVaultPromptForced(false);
      startAutoLock(preferences);

      // 6. Return recovery key for user to save
      return { recoveryKey: result.recoveryKey };
    } catch (err) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [startAutoLock, preferences]);

  // ------------------------------------------------------------------
  // Change vault key
  // ------------------------------------------------------------------
  const changeVaultKey = useCallback(async (currentVaultKey, newVaultKey) => {
    // 1. Fetch current blobs
    const { data: keyResp } = await api.get('/encryption.php?action=key-material');
    const blobs = apiData({ data: keyResp });

    // 2. Re-wrap DEK client-side
    const newBlobs = await crypto.changeVaultKey(
      { vault_key_salt: blobs.vault_key_salt, encrypted_dek: blobs.encrypted_dek },
      currentVaultKey,
      newVaultKey
    );

    // 3. Send new blobs to server
    await api.post('/encryption.php?action=update-vault-key', newBlobs);

    return { success: true };
  }, []);

  // ------------------------------------------------------------------
  // Recover with recovery key
  // ------------------------------------------------------------------
  const recoverWithRecoveryKey = useCallback(async (recoveryKey, newVaultKey) => {
    setIsLoading(true);
    try {
      // 1. Fetch recovery blobs
      const { data: recResp } = await api.get('/encryption.php?action=recovery-material');
      const recoveryBlobs = apiData({ data: recResp });

      // 2. Unwrap DEK with recovery key, re-wrap with new vault key, generate new recovery key
      const result = await crypto.recoverWithRecoveryKey(
        {
          recovery_key_salt: recoveryBlobs.recovery_key_salt,
          encrypted_dek_recovery: recoveryBlobs.encrypted_dek_recovery,
        },
        recoveryKey,
        newVaultKey
      );

      // 3. Send all new blobs to server
      await api.post('/encryption.php?action=update-all', {
        vault_key_salt: result.vault_key_salt,
        encrypted_dek: result.encrypted_dek,
        recovery_key_salt: result.recovery_key_salt,
        encrypted_dek_recovery: result.encrypted_dek_recovery,
        recovery_key_encrypted: result.recovery_key_encrypted,
      });

      // 4. Load vault entries
      const { data: entriesResp2 } = await api.get('/vault.php');
      await entryStore.putAll(apiData({ data: entriesResp2 }) || []);

      setIsUnlocked(true);
      setVaultPromptForced(false);
      startAutoLock(preferences);

      return { recoveryKey: result.recoveryKey };
    } catch (err) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [startAutoLock, preferences]);

  // ------------------------------------------------------------------
  // View recovery key (vault must be unlocked, DEK available)
  // ------------------------------------------------------------------
  const viewRecoveryKey = useCallback(async () => {
    const { data: resp } = await api.get('/encryption.php?action=recovery-key-encrypted');
    const { recovery_key_encrypted } = apiData({ data: resp });
    return crypto.viewRecoveryKey(recovery_key_encrypted);
  }, []);

  // ------------------------------------------------------------------
  // Encrypt / Decrypt convenience wrappers
  // ------------------------------------------------------------------
  const encrypt = useCallback(async (data) => {
    if (!crypto.isUnlocked()) throw new Error('Vault is locked.');
    return crypto.encryptEntry(data, crypto._getDekForContext());
  }, []);

  const decrypt = useCallback(async (blob) => {
    if (!crypto.isUnlocked()) throw new Error('Vault is locked.');
    return crypto.decryptEntry(blob, crypto._getDekForContext());
  }, []);

  // ------------------------------------------------------------------
  // Skip / Force vault prompt
  // ------------------------------------------------------------------
  const skipVault = useCallback(() => {
    setVaultPromptForced(false);
  }, []);

  const promptVault = useCallback(() => {
    setVaultPromptForced(true);
  }, []);

  // ------------------------------------------------------------------
  // On mount: check if vault key exists
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      try {
        // Fetch key material (preferences already loaded by AuthContext)
        const { data } = await api.get('/encryption.php?action=key-material');
        if (cancelled) return;

        const keyMaterial = apiData({ data });
        setVaultKeyExists(isTruthy(keyMaterial.has_vault_key));

        // Try to restore session from sessionStorage (refresh persistence)
        const savedVk = sessionStorage.getItem('pv_session_vk');
        const savedSalt = sessionStorage.getItem('pv_session_salt');
        const savedEdek = sessionStorage.getItem('pv_session_edek');
        if (savedVk && savedSalt && savedEdek && isTruthy(keyMaterial.has_vault_key)) {
          try {
            const success = await crypto.unlockVault(
              { vault_key_salt: savedSalt, encrypted_dek: savedEdek },
              savedVk
            );
            if (success && !cancelled) {
              const { data: er } = await api.get('/vault.php');
              await entryStore.putAll(apiData({ data: er }) || []);
              setIsUnlocked(true);
              startAutoLock(preferences);
            }
          } catch {
            // Session restore failed — clear stale session, user must re-enter vault key
            clearSession();
          }
        }
      } catch {
        if (!cancelled) setVaultKeyExists(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
      clearAutoLock();
    };
  }, [user, clearAutoLock]);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      clearAutoLock();
    };
  }, [clearAutoLock]);

  // ------------------------------------------------------------------
  // Context value
  // ------------------------------------------------------------------
  const value = {
    // State
    isUnlocked,
    isLoading,
    vaultKeyExists,
    vaultPromptForced,
    // Methods
    unlock,
    lock,
    setup,
    changeVaultKey,
    recoverWithRecoveryKey,
    viewRecoveryKey,
    encrypt,
    decrypt,
    skipVault,
    promptVault,
  };

  return (
    <EncryptionContext.Provider value={value}>
      {children}
    </EncryptionContext.Provider>
  );
}

export function useEncryption() {
  const context = useContext(EncryptionContext);
  if (!context) {
    throw new Error('useEncryption must be used within an EncryptionProvider');
  }
  return context;
}

export default EncryptionContext;
