/**
 * Plaid provider module — implements the standard integration contract.
 *
 * This is a plain module (no React hooks). Refresh and disconnect logic is
 * adapted from usePlaidRefresh.js and VaultPage inline disconnect code.
 */

import api from '../../../api/client';
import { apiData } from '../../../lib/checks';
import { entryStore } from '../../../lib/entryStore';
import { AAD_VAULT_ENTRY } from '../../../lib/crypto';
import { getIntegration, setIntegration } from '../../helpers';

export default {
  id: 'plaid',
  label: 'Plaid',
  description: 'Connect bank accounts via Plaid',

  // Lazy-load the connect UI component
  ConnectComponent: () => import('./PlaidConnect.jsx'),

  /**
   * Get display info from integration metadata.
   *
   * @param {object|null} meta - integration metadata from getIntegration(d, 'plaid')
   * @returns {{ label: string, status: string, lastUpdated: string|null }}
   */
  getDisplayInfo(meta) {
    return {
      label: 'Plaid',
      status: 'connected',
      lastUpdated: meta?.last_refreshed || null,
    };
  },

  /**
   * Refresh balances for the given Plaid item IDs.
   *
   * Calls the refresh API, then updates each matching asset entry with the
   * new balance. Also updates last_refreshed on parent account entries.
   * Uses getIntegration/setIntegration for forward- and backward-compatible
   * access to the nested integration metadata.
   *
   * @param {string[]} itemIds - Plaid item IDs to refresh
   * @param {Array} entries - current vault entries
   * @param {object} decryptedCache - { [entryId]: decryptedData }
   * @param {function} encrypt - encrypt(data) → encrypted blob
   * @param {function|null} onEntryUpdated - callback(entryId, newDecryptedData)
   * @returns {Promise<{ updated: number }>}
   */
  async refresh(itemIds, entries, decryptedCache, encrypt, onEntryUpdated) {
    if (!itemIds.length) return { updated: 0 };

    const { data: resp } = await api.post('/plaid.php?action=refresh', { item_ids: itemIds });
    const result = apiData({ data: resp });
    const balances = result?.balances || {};
    let updated = 0;

    // Update asset entries with new balances.
    // Each entry is attempted independently so a single encrypt/write failure
    // does not abort the remaining entries.
    for (const entry of entries) {
      if (entry.entry_type !== 'asset') continue;
      const d = decryptedCache[entry.id];
      if (!d) continue;

      const meta = getIntegration(d, 'plaid');
      if (!meta?.account_id || !meta?.item_id) continue;

      const itemBal = balances[meta.item_id];
      if (!itemBal) continue;

      const acctBal = itemBal[meta.account_id];
      if (!acctBal) continue;

      try {
        const updatedMeta = { ...meta, last_refreshed: new Date().toISOString() };
        const mergedData = setIntegration({ ...d, value: String(acctBal.balance) }, 'plaid', updatedMeta);

        const blob = await encrypt(mergedData, AAD_VAULT_ENTRY);
        await api.put(`/vault.php?id=${entry.id}`, { encrypted_data: blob });
        await entryStore.put({ ...entry, encrypted_data: blob, updated_at: new Date().toISOString() });
        onEntryUpdated?.(entry.id, mergedData);
        updated++;
      } catch {
        // Log and continue so remaining entries are not skipped
        console.error(`[plaid] Failed to update asset entry ${entry.id}`);
      }
    }

    // Update parent account entries' last_refreshed.
    // Same per-entry error isolation.
    for (const entry of entries) {
      if (entry.entry_type !== 'account') continue;
      const d = decryptedCache[entry.id];
      if (!d) continue;

      const meta = getIntegration(d, 'plaid');
      if (!meta?.item_id) continue;
      if (!itemIds.includes(meta.item_id)) continue;

      try {
        const updatedMeta = { ...meta, last_refreshed: new Date().toISOString() };
        const mergedData = setIntegration(d, 'plaid', updatedMeta);

        const blob = await encrypt(mergedData, AAD_VAULT_ENTRY);
        await api.put(`/vault.php?id=${entry.id}`, { encrypted_data: blob });
        await entryStore.put({ ...entry, encrypted_data: blob, updated_at: new Date().toISOString() });
        onEntryUpdated?.(entry.id, mergedData);
      } catch {
        console.error(`[plaid] Failed to update account entry ${entry.id}`);
      }
    }

    return { updated };
  },

  /**
   * Disconnect a Plaid item from the server.
   *
   * Only removes the server-side Plaid item. The caller is responsible for
   * stripping integration data from affected entries.
   *
   * @param {string} itemId - the Plaid item_id to disconnect
   * @returns {Promise<void>}
   */
  async disconnect(itemId) {
    await api.delete(`/plaid.php?action=disconnect&item_id=${itemId}`);
  },
};
