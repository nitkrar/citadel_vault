import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock entryStore before importing cachePolicy
vi.mock('../../src/client/lib/entryStore', () => ({
  entryStore: {
    getAll: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

import { configure, shouldKeepOnLock, onVaultLock, hasFreshCache, markCacheRefreshed, clearAll, getConfig } from '../../src/client/lib/cachePolicy.js';
import { entryStore } from '../../src/client/lib/entryStore';

// Mock sessionStorage
const sessionStore = {};
vi.stubGlobal('sessionStorage', {
  getItem: vi.fn((key) => sessionStore[key] || null),
  setItem: vi.fn((key, val) => { sessionStore[key] = val; }),
  removeItem: vi.fn((key) => { delete sessionStore[key]; }),
});

describe('cachePolicy', () => {
  beforeEach(() => {
    configure({ cacheMode: 'instant_unlock', cacheTtlHours: 0 });
    vi.clearAllMocks();
    Object.keys(sessionStore).forEach(k => delete sessionStore[k]);
  });

  describe('configure', () => {
    it('defaults to instant_unlock', () => {
      configure({});
      expect(getConfig().mode).toBe('instant_unlock');
    });

    it('accepts always_fetch', () => {
      configure({ cacheMode: 'always_fetch' });
      expect(getConfig().mode).toBe('always_fetch');
    });

    it('parses ttlHours as integer', () => {
      configure({ cacheTtlHours: '24' });
      expect(getConfig().ttlHours).toBe(24);
    });

    it('defaults ttlHours to 1 for invalid', () => {
      configure({ cacheTtlHours: 'abc' });
      expect(getConfig().ttlHours).toBe(1);
    });
  });

  describe('shouldKeepOnLock', () => {
    it('true for instant_unlock', () => {
      configure({ cacheMode: 'instant_unlock' });
      expect(shouldKeepOnLock()).toBe(true);
    });

    it('false for always_fetch', () => {
      configure({ cacheMode: 'always_fetch' });
      expect(shouldKeepOnLock()).toBe(false);
    });
  });

  describe('onVaultLock', () => {
    it('does not clear in instant_unlock mode', async () => {
      configure({ cacheMode: 'instant_unlock' });
      await onVaultLock();
      expect(entryStore.clear).not.toHaveBeenCalled();
    });

    it('clears in always_fetch mode', async () => {
      configure({ cacheMode: 'always_fetch' });
      await onVaultLock();
      expect(entryStore.clear).toHaveBeenCalled();
    });
  });

  describe('hasFreshCache', () => {
    it('returns false in always_fetch mode', async () => {
      configure({ cacheMode: 'always_fetch' });
      expect(await hasFreshCache()).toBe(false);
    });

    it('returns false when no cached entries', async () => {
      entryStore.getAll.mockResolvedValue([]);
      expect(await hasFreshCache()).toBe(false);
    });

    it('returns true when entries exist and no TTL', async () => {
      entryStore.getAll.mockResolvedValue([{ id: 1 }]);
      configure({ cacheMode: 'instant_unlock', cacheTtlHours: 0 });
      expect(await hasFreshCache()).toBe(true);
    });

    it('returns false when TTL expired', async () => {
      entryStore.getAll.mockResolvedValue([{ id: 1 }]);
      configure({ cacheMode: 'instant_unlock', cacheTtlHours: 1 });
      // Cached 2 hours ago
      sessionStore['pv_cache_timestamp'] = String(Date.now() - 2 * 3600000);
      expect(await hasFreshCache()).toBe(false);
    });

    it('returns true when TTL not expired', async () => {
      entryStore.getAll.mockResolvedValue([{ id: 1 }]);
      configure({ cacheMode: 'instant_unlock', cacheTtlHours: 1 });
      sessionStore['pv_cache_timestamp'] = String(Date.now() - 30 * 60000); // 30 min ago
      expect(await hasFreshCache()).toBe(true);
    });
  });

  describe('markCacheRefreshed', () => {
    it('sets timestamp in sessionStorage', () => {
      markCacheRefreshed();
      expect(sessionStorage.setItem).toHaveBeenCalledWith('pv_cache_timestamp', expect.any(String));
    });
  });

  describe('clearAll', () => {
    it('clears entryStore and sessionStorage', async () => {
      await clearAll();
      expect(entryStore.clear).toHaveBeenCalled();
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('pv_cache_timestamp');
    });
  });
});
