/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';

// localStorage mock (Node 22+ built-in localStorage lacks Storage API methods).
// Uses a Proxy so Object.keys(localStorage) returns stored keys — required by
// invalidateReferenceCache() which iterates localStorage to find pv_ref_* entries.
const store = new Map();
const storageMethods = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
const storageMock = new Proxy(storageMethods, {
  ownKeys() {
    // Expose both the method names and the stored data keys so that
    // Object.keys(localStorage) returns the stored keys as well.
    return [...Object.keys(storageMethods), ...store.keys()];
  },
  getOwnPropertyDescriptor(target, prop) {
    if (store.has(prop)) {
      return { configurable: true, enumerable: true, value: store.get(prop) };
    }
    const desc = Object.getOwnPropertyDescriptor(target, prop);
    if (desc) return desc;
    return undefined;
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
Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true, configurable: true });

// Mock the API client
vi.mock('../../src/client/api/client.js', () => ({
  default: { get: vi.fn() },
}));

// Import AFTER mocks are set up
const { default: useReferenceData, invalidateReferenceCache } = await import(
  '../../src/client/hooks/useReferenceData.js'
);
const { default: api } = await import('../../src/client/api/client.js');

describe('useReferenceData', () => {
  beforeEach(() => {
    // Clear module-level in-memory cache and localStorage
    invalidateReferenceCache();
    store.clear();
    api.get.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ---------------------------------------------------------------
  // 1. Returns empty arrays and loading=true initially when nothing cached
  // ---------------------------------------------------------------
  it('returns empty arrays and loading=true initially when nothing cached', () => {
    api.get.mockReturnValue(new Promise(() => {})); // never resolves

    const configs = [
      { key: 'currencies', url: '/reference/currencies.php' },
      { key: 'countries', url: '/reference/countries.php' },
    ];
    const { result } = renderHook(() => useReferenceData(configs));

    expect(result.current.loading).toBe(true);
    expect(result.current.currencies).toEqual([]);
    expect(result.current.countries).toEqual([]);
  });

  // ---------------------------------------------------------------
  // 2. Fetches data from API on mount when not cached
  // ---------------------------------------------------------------
  it('fetches data from API on mount when not cached', async () => {
    const mockCurrencies = [{ code: 'USD' }, { code: 'EUR' }];
    api.get.mockResolvedValue({ data: { data: mockCurrencies } });

    const configs = [{ key: 'currencies', url: '/reference/currencies.php' }];
    const { result } = renderHook(() => useReferenceData(configs));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.get).toHaveBeenCalledWith('/reference/currencies.php');
    expect(result.current.currencies).toEqual(mockCurrencies);
  });

  // ---------------------------------------------------------------
  // 3. Returns cached data from localStorage when within TTL
  // ---------------------------------------------------------------
  it('returns cached data from localStorage when within TTL', () => {
    const cached = [{ code: 'GBP' }];
    storageMock.setItem(
      'pv_ref_currencies',
      JSON.stringify({ data: cached, ts: Date.now() })
    );

    const configs = [{ key: 'currencies', url: '/reference/currencies.php' }];
    const { result } = renderHook(() => useReferenceData(configs));

    // Should be loaded from cache immediately — no API call
    expect(result.current.loading).toBe(false);
    expect(result.current.currencies).toEqual(cached);
    expect(api.get).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // 4. Re-fetches when TTL expired
  // ---------------------------------------------------------------
  it('re-fetches when TTL expired', async () => {
    const staleData = [{ code: 'OLD' }];
    const freshData = [{ code: 'FRESH' }];

    // Seed localStorage with an expired entry (2 hours ago)
    storageMock.setItem(
      'pv_ref_currencies',
      JSON.stringify({ data: staleData, ts: Date.now() - 2 * 60 * 60 * 1000 })
    );

    api.get.mockResolvedValue({ data: { data: freshData } });

    const configs = [{ key: 'currencies', url: '/reference/currencies.php' }];
    const { result } = renderHook(() => useReferenceData(configs));

    // Should be loading since the cache is stale
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.get).toHaveBeenCalledWith('/reference/currencies.php');
    expect(result.current.currencies).toEqual(freshData);
  });

  // ---------------------------------------------------------------
  // 5. invalidateReferenceCache(key) clears specific key
  // ---------------------------------------------------------------
  it('invalidateReferenceCache(key) clears specific key from cache and localStorage', async () => {
    const data = [{ code: 'USD' }];
    api.get.mockResolvedValue({ data: { data } });

    const configs = [{ key: 'currencies', url: '/reference/currencies.php' }];
    const { result } = renderHook(() => useReferenceData(configs));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verify it was cached
    expect(storageMock.getItem('pv_ref_currencies')).not.toBeNull();

    // Invalidate specific key
    invalidateReferenceCache('currencies');

    // localStorage entry should be removed
    expect(storageMock.getItem('pv_ref_currencies')).toBeNull();

    // Re-rendering hook should trigger a re-fetch since cache is cleared
    api.get.mockClear();
    const freshData = [{ code: 'EUR' }];
    api.get.mockResolvedValue({ data: { data: freshData } });

    const { result: result2 } = renderHook(() => useReferenceData(configs));

    await waitFor(() => expect(result2.current.loading).toBe(false));
    expect(api.get).toHaveBeenCalledWith('/reference/currencies.php');
    expect(result2.current.currencies).toEqual(freshData);
  });

  // ---------------------------------------------------------------
  // 6. invalidateReferenceCache() with no args clears all cache entries
  // ---------------------------------------------------------------
  it('invalidateReferenceCache() with no args clears all in-memory cache entries', async () => {
    const currData = [{ code: 'USD' }];
    const countryData = [{ name: 'US' }];

    api.get.mockImplementation((url) => {
      if (url.includes('currencies')) return Promise.resolve({ data: { data: currData } });
      if (url.includes('countries')) return Promise.resolve({ data: { data: countryData } });
      return Promise.resolve({ data: [] });
    });

    const configs = [
      { key: 'currencies', url: '/reference/currencies.php' },
      { key: 'countries', url: '/reference/countries.php' },
    ];

    const { result } = renderHook(() => useReferenceData(configs));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Invalidate all (no args)
    invalidateReferenceCache();

    // After invalidation, a new hook render should re-fetch both keys
    api.get.mockClear();
    api.get.mockImplementation((url) => {
      if (url.includes('currencies')) return Promise.resolve({ data: { data: [{ code: 'NEW' }] } });
      if (url.includes('countries')) return Promise.resolve({ data: { data: [{ name: 'UK' }] } });
      return Promise.resolve({ data: [] });
    });

    const { result: result2 } = renderHook(() => useReferenceData(configs));
    await waitFor(() => expect(result2.current.loading).toBe(false));

    // Both keys should have been re-fetched
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result2.current.currencies).toEqual([{ code: 'NEW' }]);
    expect(result2.current.countries).toEqual([{ name: 'UK' }]);
  });

  // ---------------------------------------------------------------
  // 7. loading becomes false after fetch completes
  // ---------------------------------------------------------------
  it('loading becomes false after fetch completes', async () => {
    let resolveGet;
    api.get.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      })
    );

    const configs = [{ key: 'currencies', url: '/reference/currencies.php' }];
    const { result } = renderHook(() => useReferenceData(configs));

    // Still loading
    expect(result.current.loading).toBe(true);

    // Now resolve the API call
    resolveGet({ data: { data: [{ code: 'USD' }] } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currencies).toEqual([{ code: 'USD' }]);
  });

  // ---------------------------------------------------------------
  // 8. Handles API error gracefully (returns empty array for failed config)
  // ---------------------------------------------------------------
  it('handles API error gracefully — returns empty array for failed config', async () => {
    api.get.mockRejectedValue(new Error('Network error'));

    const configs = [{ key: 'currencies', url: '/reference/currencies.php' }];
    const { result } = renderHook(() => useReferenceData(configs));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should fall back to empty array on error
    expect(result.current.currencies).toEqual([]);
  });

  // ---------------------------------------------------------------
  // 9. Does not re-fetch configs that are already cached (fetches only missing)
  // ---------------------------------------------------------------
  it('does not re-fetch configs that are already cached — fetches only missing ones', async () => {
    // Pre-cache currencies in localStorage
    const cachedCurrencies = [{ code: 'USD' }, { code: 'EUR' }];
    storageMock.setItem(
      'pv_ref_currencies',
      JSON.stringify({ data: cachedCurrencies, ts: Date.now() })
    );

    const freshCountries = [{ name: 'US' }, { name: 'UK' }];
    api.get.mockResolvedValue({ data: { data: freshCountries } });

    const configs = [
      { key: 'currencies', url: '/reference/currencies.php' },
      { key: 'countries', url: '/reference/countries.php' },
    ];

    const { result } = renderHook(() => useReferenceData(configs));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should only have fetched countries (currencies was cached)
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/reference/countries.php');
    expect(api.get).not.toHaveBeenCalledWith('/reference/currencies.php');

    // Both should be available
    expect(result.current.currencies).toEqual(cachedCurrencies);
    expect(result.current.countries).toEqual(freshCountries);
  });

  // ---------------------------------------------------------------
  // Bonus: handles response where data is at r.data (no nested .data)
  // ---------------------------------------------------------------
  it('handles flat API response shape (r.data without nested .data)', async () => {
    const flatData = [{ id: 1, name: 'Item' }];
    api.get.mockResolvedValue({ data: flatData });

    const configs = [{ key: 'items', url: '/reference/items.php' }];
    const { result } = renderHook(() => useReferenceData(configs));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual(flatData);
  });
});
