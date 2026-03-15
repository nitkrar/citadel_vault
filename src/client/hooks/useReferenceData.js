import { useState, useEffect } from 'react';
import api from '../api/client';

const REFERENCE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const STORAGE_PREFIX = 'pv_ref_';

/**
 * Module-level cache — in-memory mirror of localStorage
 * so we don't parse JSON on every hook call.
 */
const cache = {};

/** Read a key from localStorage into the in-memory cache if fresh. */
function loadFromStorage(key) {
  if (cache[key]) return true;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return false;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts < REFERENCE_CACHE_TTL) {
      cache[key] = data;
      return true;
    }
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch { /* corrupt entry — ignore */ }
  return false;
}

/** Persist fetched data to localStorage and in-memory cache. */
function saveToStorage(key, data) {
  cache[key] = data;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* storage full — in-memory cache still works */ }
}

/**
 * useReferenceData — load and cache reference data lists.
 *
 * @param {Array<{ key: string, url: string }>} configs
 *   Each config describes one reference list to load.
 * @param {object} [opts]
 * @param {boolean} [opts.vaultRequired]  If true, re-fetches when deps change
 *   (e.g. vault unlock triggers reload for vault-dependent lists like accounts).
 * @param {Array} [opts.deps]  Extra dependency array for re-fetching.
 * @returns {object}  { [key]: Array, loading: boolean }
 */
export default function useReferenceData(configs, opts = {}) {
  const { deps = [] } = opts;

  // Build initial state from cache (in-memory first, then localStorage)
  const buildState = () => {
    const state = {};
    let allCached = true;
    for (const { key } of configs) {
      if (loadFromStorage(key)) {
        state[key] = cache[key];
      } else {
        state[key] = [];
        allCached = false;
      }
    }
    return { state, allCached };
  };

  const { state: initial, allCached } = buildState();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!allCached);

  useEffect(() => {
    // Determine which configs need fetching
    const toFetch = configs.filter(({ key }) => !loadFromStorage(key));
    if (toFetch.length === 0) {
      // Everything cached — sync state in case deps changed
      const state = {};
      for (const { key } of configs) {
        state[key] = cache[key] || [];
      }
      setData(state);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      toFetch.map(({ key, url }) =>
        api.get(url)
          .then((r) => {
            const list = r.data.data || r.data || [];
            saveToStorage(key, list);
            return { key, list };
          })
          .catch(() => ({ key, list: [] }))
      )
    ).then((results) => {
      if (cancelled) return;
      setData(() => {
        const state = {};
        for (const { key } of configs) {
          state[key] = cache[key] || [];
        }
        for (const { key, list } of results) {
          state[key] = list;
        }
        return state;
      });
      setLoading(false);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...data, loading };
}

/**
 * Invalidate a specific cache key (e.g. on vault lock/unlock).
 */
export function invalidateReferenceCache(key) {
  if (key) {
    delete cache[key];
    try { localStorage.removeItem(STORAGE_PREFIX + key); } catch {}
  } else {
    Object.keys(cache).forEach((k) => delete cache[k]);
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(STORAGE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
}
