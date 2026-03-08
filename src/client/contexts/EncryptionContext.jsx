import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';
import { isTruthy, apiData } from '../lib/checks';

const EncryptionContext = createContext(null);

export function EncryptionProvider({ children, user }) {
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultSkipped, setVaultSkipped] = useState(false);
  const [vaultKeyExists, setVaultKeyExists] = useState(false);
  const [vaultPromptForced, setVaultPromptForced] = useState(false);
  const [mustChangeVaultKey, setMustChangeVaultKey] = useState(false);
  const [adminVaultMessage, setAdminVaultMessage] = useState(null);
  const [sessionPreference, setSessionPreference] = useState('session');
  const [loading, setLoading] = useState(true);
  const [backfilledRecoveryKey, setBackfilledRecoveryKey] = useState(null);

  const autoLockTimerRef = useRef(null);

  // ------------------------------------------------------------------
  // Helper: persist data token + expiry in sessionStorage
  // ------------------------------------------------------------------
  const storeToken = useCallback((dataToken, expiresAt) => {
    sessionStorage.setItem('pv_data_token', dataToken);
    sessionStorage.setItem('pv_data_token_expiry', String(expiresAt));
  }, []);

  // ------------------------------------------------------------------
  // Helper: clear stored tokens
  // ------------------------------------------------------------------
  const clearToken = useCallback(() => {
    sessionStorage.removeItem('pv_data_token');
    sessionStorage.removeItem('pv_data_token_expiry');
  }, []);

  // ------------------------------------------------------------------
  // Helper: schedule auto-lock when preference is 'timed'
  // ------------------------------------------------------------------
  const scheduleAutoLock = useCallback((expiresAt, preference) => {
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }

    if (preference === 'timed' && expiresAt) {
      const msUntilExpiry = expiresAt * 1000 - Date.now();
      if (msUntilExpiry > 0) {
        autoLockTimerRef.current = setTimeout(() => {
          clearToken();
          setVaultUnlocked(false);
        }, msUntilExpiry);
      } else {
        // Already expired
        clearToken();
        setVaultUnlocked(false);
      }
    }
  }, [clearToken]);

  // ------------------------------------------------------------------
  // On mount (when user is available): check session + fetch status
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        // Check for an existing valid data token in sessionStorage
        // ONLY trust sessionStorage token — never auto-unlock from cookies alone
        const existingToken = sessionStorage.getItem('pv_data_token');
        const existingExpiry = sessionStorage.getItem('pv_data_token_expiry');
        const hasValidToken =
          existingToken &&
          existingExpiry &&
          Number(existingExpiry) * 1000 > Date.now();

        // Fetch encryption status from the server
        const { data } = await api.get('/encryption.php?action=status');
        if (cancelled) return;

        const status = apiData({ data });
        setVaultKeyExists(isTruthy(status.has_vault_key));
        setSessionPreference(status.vault_session_preference || 'session');
        setMustChangeVaultKey(isTruthy(status.must_change_vault_key));
        setAdminVaultMessage(status.admin_action_message || null);

        if (hasValidToken) {
          setVaultUnlocked(true);
          scheduleAutoLock(
            Number(existingExpiry),
            status.vault_session_preference || 'session',
          );
        } else {
          // Stale / missing token
          clearToken();
          setVaultUnlocked(false);
        }
      } catch {
        // On failure, leave vaultKeyExists as false — modal will show setup mode
        if (!cancelled) {
          setVaultKeyExists(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (autoLockTimerRef.current) {
        clearTimeout(autoLockTimerRef.current);
      }
    };
  }, [user, clearToken, scheduleAutoLock]);

  // ------------------------------------------------------------------
  // setupVaultKey
  // ------------------------------------------------------------------
  const setupVaultKey = useCallback(
    async (vaultKey, confirmKey) => {
      const { data } = await api.post('/encryption.php?action=setup', {
        vault_key: vaultKey,
        confirm_vault_key: confirmKey,
      });

      const result = apiData({ data });
      storeToken(result.data_token, result.expires_at);
      setVaultUnlocked(true);
      setVaultKeyExists(true);
      setVaultPromptForced(false);
            scheduleAutoLock(result.expires_at, sessionPreference);

      return result;
    },
    [storeToken, scheduleAutoLock, sessionPreference],
  );

  // ------------------------------------------------------------------
  // unlockVault
  // ------------------------------------------------------------------
  const unlockVault = useCallback(
    async (vaultKey) => {
      const { data } = await api.post('/encryption.php?action=unlock', {
        vault_key: vaultKey,
      });

      const result = apiData({ data });
      storeToken(result.data_token, result.expires_at);
      setVaultUnlocked(true);
      setVaultPromptForced(false);

      const pref = result.session_preference || sessionPreference;
      setSessionPreference(pref);
      scheduleAutoLock(result.expires_at, pref);

      // If server backfilled a recovery key, surface it
      if (result.recovery_key) {
        setBackfilledRecoveryKey(result.recovery_key);
      }

      return result;
    },
    [storeToken, scheduleAutoLock, sessionPreference],
  );

  // ------------------------------------------------------------------
  // clearBackfilledRecoveryKey
  // ------------------------------------------------------------------
  const clearBackfilledRecoveryKey = useCallback(() => {
    setBackfilledRecoveryKey(null);
  }, []);

  // ------------------------------------------------------------------
  // changeVaultKey (using current vault key)
  // ------------------------------------------------------------------
  const changeVaultKey = useCallback(
    async (oldKey, newKey, confirmKey) => {
      const { data } = await api.post('/encryption.php?action=change', {
        method: 'vault_key',
        old_vault_key: oldKey,
        new_vault_key: newKey,
        confirm_new_vault_key: confirmKey,
      });

      const result = apiData({ data });
      storeToken(result.data_token, result.expires_at);
      scheduleAutoLock(result.expires_at, sessionPreference);
      setMustChangeVaultKey(false);
      setAdminVaultMessage(null);

      return result;
    },
    [storeToken, scheduleAutoLock, sessionPreference],
  );

  // ------------------------------------------------------------------
  // changeVaultKeyWithRecovery
  // ------------------------------------------------------------------
  const changeVaultKeyWithRecovery = useCallback(
    async (recoveryKey, newKey, confirmKey) => {
      const { data } = await api.post('/encryption.php?action=change', {
        method: 'recovery',
        recovery_key: recoveryKey,
        new_vault_key: newKey,
        confirm_new_vault_key: confirmKey,
      });

      const result = apiData({ data });
      storeToken(result.data_token, result.expires_at);
      scheduleAutoLock(result.expires_at, sessionPreference);
      setMustChangeVaultKey(false);
      setAdminVaultMessage(null);

      return result;
    },
    [storeToken, scheduleAutoLock, sessionPreference],
  );

  // ------------------------------------------------------------------
  // viewRecoveryKey
  // ------------------------------------------------------------------
  const viewRecoveryKey = useCallback(async () => {
    const { data } = await api.post('/encryption.php?action=view-recovery-key');
    const result = apiData({ data });
    return result.recovery_key;
  }, []);

  // ------------------------------------------------------------------
  // regenerateRecoveryKey
  // ------------------------------------------------------------------
  const regenerateRecoveryKey = useCallback(async () => {
    const { data } = await api.post('/encryption.php?action=regenerate-recovery-key');
    const result = apiData({ data });
    return result.recovery_key;
  }, []);

  // ------------------------------------------------------------------
  // skipVault
  // ------------------------------------------------------------------
  const skipVault = useCallback(() => {
    setVaultSkipped(true);
    setVaultPromptForced(false);
  }, []);

  // ------------------------------------------------------------------
  // promptVault — force-open the vault modal
  // ------------------------------------------------------------------
  const promptVault = useCallback(async () => {
    setVaultSkipped(false);
    setVaultUnlocked(false);
    try {
      const { data } = await api.get('/encryption.php?action=status');
      const status = apiData({ data });
      setVaultKeyExists(isTruthy(status.has_vault_key));
    } catch {
      setVaultKeyExists(false);
    }
    // Always force the modal open, even if state didn't change
    setVaultPromptForced(true);
  }, []);

  // ------------------------------------------------------------------
  // lockVault
  // ------------------------------------------------------------------
  const lockVault = useCallback(() => {
    clearToken();
    setVaultUnlocked(false);
    
    // Clear HttpOnly cookie on server
    api.post('/encryption.php?action=lock').catch(() => {});

    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  }, [clearToken]);

  // ------------------------------------------------------------------
  // updatePreference
  // ------------------------------------------------------------------
  const updatePreference = useCallback(
    async (pref) => {
      await api.put('/encryption.php?action=preference', {
        preference: pref,
      });
      setSessionPreference(pref);

      // Re-schedule auto-lock if there is an active token
      const expiry = sessionStorage.getItem('pv_data_token_expiry');
      if (expiry) {
        scheduleAutoLock(Number(expiry), pref);
      }
    },
    [scheduleAutoLock],
  );

  // ------------------------------------------------------------------
  // getDataToken
  // ------------------------------------------------------------------
  const getDataToken = useCallback(() => {
    return sessionStorage.getItem('pv_data_token');
  }, []);

  // ------------------------------------------------------------------
  // Context value
  // ------------------------------------------------------------------
  const value = {
    // State
    vaultUnlocked,
    vaultSkipped,
    vaultKeyExists,
    vaultPromptForced,
    mustChangeVaultKey,
    adminVaultMessage,
    sessionPreference,
    loading,
    backfilledRecoveryKey,

    // Methods
    setupVaultKey,
    unlockVault,
    changeVaultKey,
    changeVaultKeyWithRecovery,
    viewRecoveryKey,
    regenerateRecoveryKey,
    skipVault,
    promptVault,
    lockVault,
    updatePreference,
    getDataToken,
    clearBackfilledRecoveryKey,
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
