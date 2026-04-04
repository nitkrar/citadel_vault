/**
 * vaultSession.js — Single source of truth for vault session cleanup.
 *
 * All sensitive resources are cleared here. No caller should manually
 * assemble cleanup steps — use lock() or destroy() instead.
 *
 * lock()    — vault locked, user still authenticated. Clears crypto
 *             state but keeps worker alive for fast re-unlock.
 * destroy() — full teardown (logout, user switch). Kills everything.
 */
import * as crypto from './crypto';
import * as workerDispatcher from './workerDispatcher';
import * as cachePolicy from './cachePolicy';
import { entryStore } from './entryStore';

/**
 * Lock the vault. User remains authenticated.
 * Clears: in-memory DEK, worker DEK, IndexedDB (per policy).
 * Keeps: worker process (for re-unlock), localStorage caches.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.preserveSession=false] - If true, keep pv_session_dek
 *   in sessionStorage so the vault can restore on remount/refresh.
 *   Used by unmount cleanup to avoid breaking persist_in_tab.
 */
export async function lock({ preserveSession = false } = {}) {
  crypto.lockVault();
  workerDispatcher.setKey(null);       // clears main-thread raw key + sends clearKey to worker
  if (!preserveSession) {
    sessionStorage.removeItem('pv_session_dek');
  }
  await cachePolicy.onVaultLock();
}

/**
 * Full teardown — logout or user switch.
 * Clears everything: crypto, worker (terminated), all storage.
 */
export async function destroy() {
  // 1. Crypto state
  crypto.lockVault();

  // 2. Worker — terminate entirely (not just clear key)
  workerDispatcher.setKey(null);
  workerDispatcher.terminate();

  // 3. All session storage vault keys
  sessionStorage.removeItem('pv_session_dek');
  sessionStorage.removeItem('pv_cache_timestamp');
  sessionStorage.removeItem('pv_ticker_prices');
  sessionStorage.removeItem('pv_vault_last_tab');
  sessionStorage.removeItem('pv_portfolio_last_tab');

  // 4. Local storage caches (drafts, reference data)
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('pv_draft_') || key.startsWith('pv_ref_')) {
      localStorage.removeItem(key);
    }
  });

  // 5. IndexedDB (encrypted entries, snapshots, templates, shared items)
  await entryStore.clear().catch(() => {});

  // 6. Reset IndexedDB to unscoped state (no stale user DB reference after logout)
  entryStore.switchUser(null);
}
