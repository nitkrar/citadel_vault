import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import { apiData } from '../lib/checks';
import { entryStore } from '../lib/entryStore';
import { useEncryption } from './EncryptionContext';

const VaultDataContext = createContext();

export function useVaultEntries() {
  return useContext(VaultDataContext);
}

export function VaultDataProvider({ children }) {
  const { isUnlocked, encrypt, decrypt } = useEncryption();

  const [entries, setEntries] = useState([]);
  const [decryptedCache, setDecryptedCache] = useState({});
  const [loading, setLoading] = useState(true);

  // ── Notify other tabs of data changes ─────────────────────────
  const notifyOtherTabs = useCallback(() => {
    try { new BroadcastChannel('citadel_vault_sync').postMessage('changed'); } catch {}
  }, []);

  // ── Load from IndexedDB + decrypt ─────────────────────────────
  const loadEntries = useCallback(async () => {
    if (!isUnlocked) { setEntries([]); setDecryptedCache({}); setLoading(false); return; }
    setLoading(true);
    try {
      const raw = await entryStore.getAll();
      const cache = {};
      for (const entry of raw) {
        try { cache[entry.id] = await decrypt(entry.encrypted_data); } catch { cache[entry.id] = null; }
      }
      setEntries(raw);
      setDecryptedCache(cache);
    } catch {
      // Failed to load — entries stay empty
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, decrypt]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // ── Refresh from server ───────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!isUnlocked) return;
    const { data: resp } = await api.get('/vault.php');
    const raw = apiData({ data: resp }) || [];
    await entryStore.putAll(raw);
    const cache = {};
    for (const entry of raw) {
      try { cache[entry.id] = await decrypt(entry.encrypted_data); } catch { cache[entry.id] = null; }
    }
    setEntries(raw);
    setDecryptedCache(cache);
  }, [isUnlocked, decrypt]);

  // ── Cross-tab sync: refetch when tab regains focus ────────────
  useEffect(() => {
    if (!isUnlocked) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isUnlocked, refetch]);

  // ── BroadcastChannel: instant cross-tab sync ──────────────────
  useEffect(() => {
    if (!isUnlocked) return;
    let bc;
    try { bc = new BroadcastChannel('citadel_vault_sync'); } catch { return; }
    const onMessage = () => refetch();
    bc.addEventListener('message', onMessage);
    return () => { bc.removeEventListener('message', onMessage); bc.close(); };
  }, [isUnlocked, refetch]);

  // ── Cross-device sync: listen for SyncContext refresh event ───
  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('vault-sync-refresh', handler);
    return () => window.removeEventListener('vault-sync-refresh', handler);
  }, [refetch]);

  // ── CRUD: Create ──────────────────────────────────────────────
  const createEntry = useCallback(async (entryType, templateId, formData) => {
    const blob = await encrypt(formData);
    const { data: resp } = await api.post('/vault.php', {
      entry_type: entryType,
      template_id: templateId,
      encrypted_data: blob,
    });
    const newId = apiData({ data: resp })?.id;
    const newEntry = {
      id: newId,
      entry_type: entryType,
      template_id: templateId,
      encrypted_data: blob,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await entryStore.put(newEntry);
    setEntries(prev => [newEntry, ...prev]);
    setDecryptedCache(prev => ({ ...prev, [newId]: formData }));
    notifyOtherTabs();
    return newEntry;
  }, [encrypt, notifyOtherTabs]);

  // ── CRUD: Update (full — for edit modal) ──────────────────────
  const updateEntry = useCallback(async (existingEntry, newBlob, newDecryptedData, opts = {}) => {
    const payload = { encrypted_data: newBlob };
    if (opts.newEntryType && opts.newEntryType !== existingEntry.entry_type) payload.entry_type = opts.newEntryType;
    if (opts.newTemplateId !== undefined && opts.newTemplateId !== existingEntry.template_id) payload.template_id = opts.newTemplateId;
    await api.put(`/vault.php?id=${existingEntry.id}`, payload);
    const updated = {
      ...existingEntry,
      ...payload,
      updated_at: new Date().toISOString(),
    };
    await entryStore.put(updated, { allowTemplateChange: !!opts.allowTemplateChange });
    setEntries(prev => prev.map(e => e.id === existingEntry.id ? updated : e));
    setDecryptedCache(prev => ({ ...prev, [existingEntry.id]: newDecryptedData }));
    notifyOtherTabs();
    return updated;
  }, [notifyOtherTabs]);

  // ── CRUD: Delete ──────────────────────────────────────────────
  const deleteEntry = useCallback(async (entry) => {
    await api.delete(`/vault.php?id=${entry.id}`);
    await entryStore.delete(entry.id);
    setEntries(prev => prev.filter(e => e.id !== entry.id));
    setDecryptedCache(prev => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    notifyOtherTabs();
  }, [notifyOtherTabs]);

  // ── CRUD: Update local (for inline edits, Plaid refresh) ─────
  const updateEntryLocal = useCallback(async (entryId, newDecryptedData) => {
    const blob = await encrypt(newDecryptedData);
    await api.put(`/vault.php?id=${entryId}`, { encrypted_data: blob });
    setEntries(prev => {
      const existing = prev.find(e => e.id === entryId);
      if (!existing) return prev;
      const updated = { ...existing, encrypted_data: blob, updated_at: new Date().toISOString() };
      entryStore.put(updated).catch(() => {});
      return prev.map(e => e.id === entryId ? updated : e);
    });
    setDecryptedCache(prev => ({ ...prev, [entryId]: newDecryptedData }));
    notifyOtherTabs();
  }, [encrypt, notifyOtherTabs]);

  // ── Context value (memoized to prevent unnecessary re-renders) ─
  const value = useMemo(() => ({
    entries,
    decryptedCache,
    loading,
    refetch,
    createEntry,
    updateEntry,
    deleteEntry,
    updateEntryLocal,
    setDecryptedCache,
  }), [entries, decryptedCache, loading, refetch, createEntry, updateEntry, deleteEntry, updateEntryLocal]);

  return (
    <VaultDataContext.Provider value={value}>
      {children}
    </VaultDataContext.Provider>
  );
}
