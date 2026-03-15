import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { useEncryption } from './EncryptionContext';
import { useAuth } from './AuthContext';
import { invalidateReferenceCache } from '../hooks/useReferenceData';
import { getUserPreference } from '../lib/defaults';

const SyncContext = createContext();

export function useSync() {
  return useContext(SyncContext);
}

const REFERENCE_CATEGORIES = ['currencies', 'countries', 'templates'];

export function SyncProvider({ children }) {
  const { isUnlocked } = useEncryption();
  const { preferences } = useAuth();
  const [hasVaultUpdates, setHasVaultUpdates] = useState(false);
  const serverTimeRef = useRef(null);
  const serverPollIntervalRef = useRef(900); // server-returned fallback

  const checkSync = useCallback(async () => {
    try {
      const params = serverTimeRef.current ? `?since=${serverTimeRef.current}` : '';
      const { data: resp } = await api.get(`/sync.php${params}`);
      const result = resp.data || resp;

      serverTimeRef.current = result.server_time;
      if (result.poll_interval) {
        serverPollIntervalRef.current = result.poll_interval;
      }

      if (!result.changes) return;

      const categories = result.categories || [];

      // Auto-pull reference data silently
      const hasReference = categories.some(c => REFERENCE_CATEGORIES.includes(c));
      if (hasReference) {
        for (const cat of categories) {
          if (REFERENCE_CATEGORIES.includes(cat)) {
            invalidateReferenceCache(cat);
          }
        }
      }

      // Notify user about vault entry changes
      if (categories.includes('vault_entries')) {
        setHasVaultUpdates(true);
      }
    } catch {
      // Network failure or auth error — silently skip
    }
  }, []);

  const dismissSync = useCallback(() => {
    setHasVaultUpdates(false);
  }, []);

  const applySync = useCallback(() => {
    setHasVaultUpdates(false);
    // Trigger a page-level re-fetch by dispatching a custom event
    // Pages that use useVaultData can listen for this
    window.dispatchEvent(new CustomEvent('vault-sync-refresh'));
  }, []);

  // Determine poll interval: user preference > server value > default
  const prefInterval = getUserPreference(preferences || {}, 'sync_interval');
  const syncInterval = parseInt(prefInterval, 10);

  useEffect(() => {
    if (!isUnlocked) {
      serverTimeRef.current = null;
      return;
    }

    // Initial baseline check
    checkSync();

    // syncInterval of 0 means "Off" — no polling
    if (syncInterval === 0) return;

    const intervalMs = (syncInterval || serverPollIntervalRef.current) * 1000;
    const id = setInterval(checkSync, intervalMs);
    return () => clearInterval(id);
  }, [isUnlocked, checkSync, syncInterval]);

  return (
    <SyncContext.Provider value={{ hasVaultUpdates, dismissSync, applySync }}>
      {children}
    </SyncContext.Provider>
  );
}
