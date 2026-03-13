import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { useEncryption } from './EncryptionContext';
import { invalidateReferenceCache } from '../hooks/useReferenceData';

const SyncContext = createContext();

export function useSync() {
  return useContext(SyncContext);
}

const REFERENCE_CATEGORIES = ['currencies', 'countries', 'templates'];

export function SyncProvider({ children }) {
  const { isUnlocked } = useEncryption();
  const [hasVaultUpdates, setHasVaultUpdates] = useState(false);
  const serverTimeRef = useRef(null);
  const pollIntervalRef = useRef(900); // default 15 min

  const checkSync = useCallback(async () => {
    try {
      const params = serverTimeRef.current ? `?since=${serverTimeRef.current}` : '';
      const { data: resp } = await api.get(`/sync.php${params}`);
      const result = resp.data || resp;

      serverTimeRef.current = result.server_time;
      if (result.poll_interval) {
        pollIntervalRef.current = result.poll_interval;
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

  useEffect(() => {
    if (!isUnlocked) {
      serverTimeRef.current = null;
      return;
    }

    // Initial baseline check
    checkSync();

    const id = setInterval(checkSync, pollIntervalRef.current * 1000);
    return () => clearInterval(id);
  }, [isUnlocked, checkSync]);

  return (
    <SyncContext.Provider value={{ hasVaultUpdates, dismissSync, applySync }}>
      {children}
    </SyncContext.Provider>
  );
}
