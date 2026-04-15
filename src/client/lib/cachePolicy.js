/**
 * cachePolicy.js — Centralized cache behavior for vault entries in IndexedDB.
 *
 * Reads cache_mode and cache_ttl_hours from app config (system settings).
 * Used by EncryptionContext for lock/unlock decisions.
 *
 * Modes:
 *   instant_unlock — keep encrypted entries after lock (default)
 *   always_fetch   — clear entries on lock, fetch fresh each unlock
 */
import { entryStore } from './entryStore';

const CACHE_TIMESTAMP_KEY = 'pv_cache_timestamp';

let config = { mode: 'instant_unlock', ttlHours: 1 };

/**
 * Configure cache policy from system settings.
 * Called when app config loads.
 */
export function configure({ cacheMode, cacheTtlHours }) {
  config = {
    mode: cacheMode === 'always_fetch' ? 'always_fetch' : 'instant_unlock',
    ttlHours: Number.isNaN(parseInt(cacheTtlHours, 10)) ? 1 : parseInt(cacheTtlHours, 10),
  };
}

/**
 * Should we keep cached entries on vault lock?
 */
export function shouldKeepOnLock() {
  return config.mode === 'instant_unlock';
}

/**
 * Clear IndexedDB entries if cache policy says so on lock.
 */
export async function onVaultLock() {
  if (!shouldKeepOnLock()) {
    await entryStore.clear().catch(() => {});
  }
}

/**
 * Check if we can use cached entries on unlock.
 * Returns true if cache is valid (entries exist, not expired, mode allows it).
 */
export async function hasFreshCache() {
  if (config.mode === 'always_fetch') return false;

  const cached = await entryStore.getAll().catch(() => []);
  if (cached.length === 0) return false;

  // Check TTL
  if (config.ttlHours > 0) {
    let rawTs;
    try { rawTs = sessionStorage.getItem(CACHE_TIMESTAMP_KEY); } catch { rawTs = '0'; }
    const cachedAt = parseInt(rawTs || '0', 10);
    if (cachedAt > 0 && (Date.now() - cachedAt) > config.ttlHours * 3600000) {
      return false;
    }
  }

  return true;
}

/**
 * Record that entries were just fetched from server.
 */
export function markCacheRefreshed() {
  sessionStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
}

/**
 * Full clear — used on logout / user switch.
 */
export async function clearAll() {
  await entryStore.clear().catch(() => {});
  try { sessionStorage.removeItem(CACHE_TIMESTAMP_KEY); } catch { /* */ }
}

export function getConfig() {
  return { ...config };
}
