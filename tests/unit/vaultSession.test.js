/** @vitest-environment jsdom */
/**
 * vaultSession.js — Unit Tests
 *
 * Verifies that lock() and destroy() clear all sensitive resources.
 * This is the single source of truth for vault cleanup — if a new
 * resource is added, add a test here and it will catch gaps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Storage mocks ───────────────────────────────────────────────────

function makeStorageMock() {
  const store = new Map();
  const methods = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
  return new Proxy(methods, {
    ownKeys() {
      return [...Object.keys(methods), ...store.keys()];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (store.has(prop)) return { configurable: true, enumerable: true, value: store.get(prop) };
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      return desc || undefined;
    },
    get(target, prop) {
      if (prop in target) return target[prop];
      if (store.has(prop)) return store.get(prop);
      return undefined;
    },
    set(target, prop, value) {
      if (prop in target) { target[prop] = value; return true; }
      store.set(prop, String(value));
      return true;
    },
  });
}

const localStorageMock = makeStorageMock();
const sessionStorageMock = makeStorageMock();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true, configurable: true });

// ── Module mocks ────────────────────────────────────────────────────

vi.mock('../../src/client/lib/crypto', () => ({
  lockVault: vi.fn(),
}));

vi.mock('../../src/client/lib/entryStore', () => ({
  entryStore: {
    clear: vi.fn().mockResolvedValue(undefined),
    switchUser: vi.fn(),
  },
}));

vi.mock('../../src/client/lib/workerDispatcher', () => ({
  setKey: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock('../../src/client/lib/cachePolicy', () => ({
  onVaultLock: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import * as crypto from '../../src/client/lib/crypto';
import { entryStore } from '../../src/client/lib/entryStore';
import * as workerDispatcher from '../../src/client/lib/workerDispatcher';
import * as cachePolicy from '../../src/client/lib/cachePolicy';
import { lock, destroy } from '../../src/client/lib/vaultSession';

// ── Tests ───────────────────────────────────────────────────────────

describe('vaultSession.lock()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('pv_session_dek', 'secret-dek');
  });

  it('clears in-memory DEK', async () => {
    await lock();
    expect(crypto.lockVault).toHaveBeenCalled();
  });

  it('clears worker DEK (sends clearKey)', async () => {
    await lock();
    expect(workerDispatcher.setKey).toHaveBeenCalledWith(null);
  });

  it('removes pv_session_dek from sessionStorage', async () => {
    await lock();
    expect(sessionStorage.getItem('pv_session_dek')).toBeNull();
  });

  it('runs cache policy lock (conditionally clears IndexedDB)', async () => {
    await lock();
    expect(cachePolicy.onVaultLock).toHaveBeenCalled();
  });

  it('does NOT terminate worker (kept alive for re-unlock)', async () => {
    await lock();
    expect(workerDispatcher.terminate).not.toHaveBeenCalled();
  });

  it('does NOT clear localStorage caches', async () => {
    localStorage.setItem('pv_ref_templates', 'data');
    await lock();
    expect(localStorage.getItem('pv_ref_templates')).toBe('data');
    localStorage.clear();
  });

  it('preserves pv_session_dek when preserveSession is true', async () => {
    await lock({ preserveSession: true });
    expect(sessionStorage.getItem('pv_session_dek')).toBe('secret-dek');
    expect(crypto.lockVault).toHaveBeenCalled();
    expect(workerDispatcher.setKey).toHaveBeenCalledWith(null);
  });

  it('clears pv_session_dek when preserveSession is false (default)', async () => {
    await lock({ preserveSession: false });
    expect(sessionStorage.getItem('pv_session_dek')).toBeNull();
  });
});

describe('vaultSession.destroy()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('pv_session_dek', 'secret-dek');
    sessionStorage.setItem('pv_cache_timestamp', '1711111111111');
    sessionStorage.setItem('pv_ticker_prices', '{"AAPL":150}');
    sessionStorage.setItem('pv_vault_last_tab', 'asset');
    localStorage.setItem('pv_draft_entry_123', '{"title":"draft"}');
    localStorage.setItem('pv_ref_templates', '[{"id":1}]');
    localStorage.setItem('pv_ref_currencies', '["USD"]');
    localStorage.setItem('unrelated_key', 'keep-me');
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('clears in-memory DEK', async () => {
    await destroy();
    expect(crypto.lockVault).toHaveBeenCalled();
  });

  it('clears worker DEK and terminates worker', async () => {
    await destroy();
    expect(workerDispatcher.setKey).toHaveBeenCalledWith(null);
    expect(workerDispatcher.terminate).toHaveBeenCalled();
  });

  it('removes pv_session_dek from sessionStorage', async () => {
    await destroy();
    expect(sessionStorage.getItem('pv_session_dek')).toBeNull();
  });

  it('removes all pv_ session keys', async () => {
    await destroy();
    expect(sessionStorage.getItem('pv_cache_timestamp')).toBeNull();
    expect(sessionStorage.getItem('pv_ticker_prices')).toBeNull();
    expect(sessionStorage.getItem('pv_vault_last_tab')).toBeNull();
  });

  it('clears IndexedDB entries', async () => {
    await destroy();
    expect(entryStore.clear).toHaveBeenCalled();
  });

  it('clears pv_draft_* and pv_ref_* from localStorage', async () => {
    await destroy();
    expect(localStorage.getItem('pv_draft_entry_123')).toBeNull();
    expect(localStorage.getItem('pv_ref_templates')).toBeNull();
    expect(localStorage.getItem('pv_ref_currencies')).toBeNull();
  });

  it('does NOT clear unrelated localStorage keys', async () => {
    await destroy();
    expect(localStorage.getItem('unrelated_key')).toBe('keep-me');
  });
});
