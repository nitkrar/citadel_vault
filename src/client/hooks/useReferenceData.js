import { useState, useEffect } from 'react';
import api from '../api/client';

/**
 * Module-level cache so data is fetched once per session
 * (survives page navigation within the SPA).
 */
const cache = {};

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

  // Build initial state from cache
  const buildState = () => {
    const state = {};
    let allCached = true;
    for (const { key } of configs) {
      if (cache[key]) {
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
    const toFetch = configs.filter(({ key }) => !cache[key]);
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
            cache[key] = list;
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
  } else {
    Object.keys(cache).forEach((k) => delete cache[k]);
  }
}
