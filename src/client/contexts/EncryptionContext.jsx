import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { isTruthy, apiData } from '../lib/checks';
import * as crypto from '../lib/crypto';
import { entryStore } from '../lib/entryStore';
import { getUserPreference, PREFERENCE_DEFAULTS } from '../lib/defaults';
import { useAuth } from './AuthContext';
import * as workerDispatcher from '../lib/workerDispatcher';
import * as cachePolicy from '../lib/cachePolicy';

const EncryptionContext = createContext(null);

export function EncryptionProvider({ children, user }) {
  const { preferences } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [vaultKeyExists, setVaultKeyExists] = useState(false);
  const [vaultPromptForced, setVaultPromptForced] = useState(null); // null = initial, true = forced, false = skipped

  const autoLockTimerRef = useRef(null);
  const activityTimerRef = useRef(null);
  const prevUserIdRef = useRef(user?.id);

  // Clear IndexedDB on logout or user switch (security: don't leak entries across users)
  useEffect(() => {
    const prevId = prevUserIdRef.current;
    prevUserIdRef.current = user?.id;
    if (prevId && prevId !== user?.id) {
      cachePolicy.clearAll();
      workerDispatcher.terminate();
    }
  }, [user?.id]);

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
      workerDispatcher.setKey(null);
      cachePolicy.onVaultLock();
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
  const saveSession = useCallback(async () => {
    // Store only the raw DEK bytes (base64) — no vault key, salt, or EDEK.
    // The vault key never touches sessionStorage.
    // On restore, we import the raw bytes directly — no PBKDF2 derivation needed.
    // Risk: raw DEK in sessionStorage is accessible to XSS. Mitigated by CSP + httpOnly cookies.
    // sessionStorage is tab-scoped — cleared on tab close.
    try {
      const dek = crypto._getDekForContext();
      const raw = await globalThis.crypto.subtle.exportKey('raw', dek);
      const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
      sessionStorage.setItem('pv_session_dek', b64);
    } catch {}
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem('pv_session_dek');
  }, []);

  const hasSession = useCallback(() => {
    return !!sessionStorage.getItem('pv_session_dek');
  }, []);

  // ------------------------------------------------------------------
  // Lock vault
  // ------------------------------------------------------------------
  const lock = useCallback(async () => {
    crypto.lockVault();
    workerDispatcher.setKey(null);
    await cachePolicy.onVaultLock();
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

      // Cache DEK for worker dispatcher
      await workerDispatcher.setKey(crypto._getDekForContext());

      // 4. Use cached entries if available and fresh, otherwise fetch from server
      const hasCache = await cachePolicy.hasFreshCache();
      if (!hasCache) {
        const { data: entriesResp } = await api.get('/vault.php');
        const entries = apiData({ data: entriesResp }) || [];
        await entryStore.putAll(entries);
        cachePolicy.markCacheRefreshed();
      }

      // 5. Set state
      setIsUnlocked(true);
      setVaultPromptForced(false);

      // 6. Start auto-lock timer (preferences already loaded on mount)
      startAutoLock(preferences);

      // 7. Save session for refresh persistence if preference is on
      if (getUserPreference(preferences, 'vault_persist_session') === 'persist_in_tab') {
        await saveSession();
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
        // Only the raw DEK bytes are stored — no vault key, no salt, no EDEK
        const savedDek = sessionStorage.getItem('pv_session_dek');
        if (savedDek && isTruthy(keyMaterial.has_vault_key)) {
          try {
            const rawBytes = Uint8Array.from(atob(savedDek), c => c.charCodeAt(0));
            const dek = await globalThis.crypto.subtle.importKey(
              'raw', rawBytes, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
            );
            crypto.setDek(dek);

            // Use cached entries or fetch from server
            const hasCache = await cachePolicy.hasFreshCache();
            if (!hasCache) {
              const { data: er } = await api.get('/vault.php');
              await entryStore.putAll(apiData({ data: er }) || []);
              cachePolicy.markCacheRefreshed();
            }

            if (!cancelled) {
              await workerDispatcher.setKey(dek);
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
      workerDispatcher.terminate();
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
