/**
 * usePlaidRefresh — Shared hook for refreshing Plaid balances.
 * Used by both VaultPage and PortfolioPage.
 */
import { useState, useCallback } from 'react';
import api from '../api/client';
import { apiData } from '../lib/checks';
import { useEncryption } from '../contexts/EncryptionContext';
import { entryStore } from '../lib/entryStore';

export default function usePlaidRefresh() {
  const { encrypt } = useEncryption();
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Refresh balances for given item_ids.
   * Updates matching entries in IndexedDB and server.
   *
   * @param {string[]} itemIds - Plaid item IDs to refresh
   * @param {Array} entries - current vault entries (from entryStore or state)
   * @param {object} decryptedCache - { [entryId]: decryptedData }
   * @param {function} onEntryUpdated - callback(entryId, newDecryptedData) for UI state updates
   * @returns {{ updated: number }}
   */
  const refreshBalances = useCallback(async (itemIds, entries, decryptedCache, onEntryUpdated) => {
    if (!itemIds.length) return { updated: 0 };

    setRefreshing(true);
    try {
      const { data: resp } = await api.post('/plaid.php?action=refresh', { item_ids: itemIds });
      const result = apiData({ data: resp });
      const balances = result?.balances || {};
      let updated = 0;

      for (const entry of entries) {
        if (entry.entry_type !== 'asset') continue;
        const d = decryptedCache[entry.id];
        if (!d?._plaid?.account_id || !d?._plaid?.item_id) continue;

        const itemBal = balances[d._plaid.item_id];
        if (!itemBal) continue;

        const acctBal = itemBal[d._plaid.account_id];
        if (acctBal) {
          const newData = {
            ...d,
            value: String(acctBal.balance),
            _plaid: { ...d._plaid, last_refreshed: new Date().toISOString() },
          };
          const blob = await encrypt(newData);
          await api.put(`/vault.php?id=${entry.id}`, { encrypted_data: blob });
          await entryStore.put({ ...entry, encrypted_data: blob, updated_at: new Date().toISOString() });
          onEntryUpdated?.(entry.id, newData);
          updated++;
        }
      }

      // Update parent account entries' last_refreshed
      for (const entry of entries) {
        const d = decryptedCache[entry.id];
        if (entry.entry_type !== 'account' || !d?._plaid?.item_id) continue;
        if (!itemIds.includes(d._plaid.item_id)) continue;

        const newData = { ...d, _plaid: { ...d._plaid, last_refreshed: new Date().toISOString() } };
        const blob = await encrypt(newData);
        await api.put(`/vault.php?id=${entry.id}`, { encrypted_data: blob });
        await entryStore.put({ ...entry, encrypted_data: blob, updated_at: new Date().toISOString() });
        onEntryUpdated?.(entry.id, newData);
      }

      return { updated };
    } finally {
      setRefreshing(false);
    }
  }, [encrypt]);

  return { refreshBalances, refreshing };
}
