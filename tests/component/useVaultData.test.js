/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';

let mockIsUnlocked = false;

vi.mock('../../src/client/contexts/EncryptionContext', () => ({
  useEncryption: () => ({ isUnlocked: mockIsUnlocked }),
}));

const { default: useVaultData } = await import('../../src/client/hooks/useVaultData.js');

describe('useVaultData', () => {
  beforeEach(() => {
    mockIsUnlocked = false;
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Locked vault returns initialValue ─────────────────────────────

  it('returns initialValue and loading=false when vault is locked (requireVault=true)', async () => {
    const fetchFn = vi.fn();
    const { result } = renderHook(() => useVaultData(fetchFn, 'default'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBe('default');
    expect(result.current.error).toBeNull();
    expect(result.current.errorMessage).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns null as default initialValue when vault is locked', async () => {
    const fetchFn = vi.fn();
    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
  });

  it('returns array initialValue when vault is locked', async () => {
    const fetchFn = vi.fn();
    const initial = [];
    const { result } = renderHook(() => useVaultData(fetchFn, initial));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBe(initial);
  });

  // ── 2. Unlocked vault fetches data ───────────────────────────────────

  it('calls fetchFn and returns data when vault is unlocked', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn().mockResolvedValue({ items: [1, 2, 3] });

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual({ items: [1, 2, 3] });
    expect(result.current.error).toBeNull();
  });

  // ── 3. Loading state transitions ────────────────────────────────────

  it('sets loading=true during fetch then loading=false when done', async () => {
    mockIsUnlocked = true;
    let resolvePromise;
    const fetchFn = vi.fn(() => new Promise((resolve) => { resolvePromise = resolve; }));

    const { result } = renderHook(() => useVaultData(fetchFn));

    // Initially loading is true (set in useState)
    expect(result.current.loading).toBe(true);

    // Resolve the fetch
    await act(async () => { resolvePromise('data'); });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe('data');
  });

  // ── 4. Fetch error handling ─────────────────────────────────────────

  it('on fetch error, sets error and resets data to initialValue', async () => {
    mockIsUnlocked = true;
    const error = new Error('Network failure');
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useVaultData(fetchFn, 'fallback'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(error);
    expect(result.current.data).toBe('fallback');
  });

  // ── 5. errorMessage — extracts from error.response.data.error ──────

  it('errorMessage extracts from error.response.data.error', async () => {
    mockIsUnlocked = true;
    const error = new Error('Request failed');
    error.response = { data: { error: 'Vault key expired' } };
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.errorMessage).toBe('Vault key expired');
  });

  // ── 6. errorMessage — falls back to error.message ──────────────────

  it('errorMessage falls back to error.message when no response data', async () => {
    mockIsUnlocked = true;
    const error = new Error('Something broke');
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.errorMessage).toBe('Something broke');
  });

  it('errorMessage falls back to generic message when error has no message', async () => {
    mockIsUnlocked = true;
    const error = { response: null, message: '' };
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.errorMessage).toBe('An unexpected error occurred.');
  });

  // ── 7. errorMessage — null when no error ───────────────────────────

  it('errorMessage is null when there is no error', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn().mockResolvedValue('ok');

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.errorMessage).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ── 8. requireVault=false fetches even when locked ─────────────────

  it('requireVault=false fetches data even when vault is locked', async () => {
    mockIsUnlocked = false;
    const fetchFn = vi.fn().mockResolvedValue('public-data');

    const { result } = renderHook(() => useVaultData(fetchFn, null, { requireVault: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.current.data).toBe('public-data');
  });

  // ── 9. vault-sync-refresh event triggers refetch ───────────────────

  it('dispatching vault-sync-refresh event triggers refetch', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.data).toBe('first'));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Dispatch the sync event
    await act(async () => {
      window.dispatchEvent(new Event('vault-sync-refresh'));
    });

    await waitFor(() => expect(result.current.data).toBe('second'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('removes vault-sync-refresh listener on unmount', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn().mockResolvedValue('data');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => {});

    unmount();

    const vaultSyncCalls = removeSpy.mock.calls.filter(
      ([event]) => event === 'vault-sync-refresh'
    );
    expect(vaultSyncCalls.length).toBeGreaterThanOrEqual(1);
    removeSpy.mockRestore();
  });

  // ── 10. refetch is callable and re-fetches data ────────────────────

  it('refetch can be called manually to re-fetch data', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce('initial-fetch')
      .mockResolvedValueOnce('refetched');

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.data).toBe('initial-fetch'));

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toBe('refetched');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // ── 11. setData allows direct state updates ────────────────────────

  it('setData updates data without calling fetchFn', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn().mockResolvedValue('fetched');

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.data).toBe('fetched'));

    act(() => {
      result.current.setData('manually-set');
    });

    expect(result.current.data).toBe('manually-set');
    // fetchFn should only have been called once (initial), not again
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // ── 12. Re-fetches when isUnlocked changes ────────────────────────

  it('re-fetches data when vault transitions from locked to unlocked', async () => {
    mockIsUnlocked = false;
    const fetchFn = vi.fn().mockResolvedValue('vault-data');

    const { result, rerender } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();

    // Simulate vault unlock
    mockIsUnlocked = true;
    rerender();

    await waitFor(() => expect(result.current.data).toBe('vault-data'));
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('clears data when vault transitions from unlocked to locked', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn().mockResolvedValue('secret');

    const { result, rerender } = renderHook(() => useVaultData(fetchFn, 'empty'));

    await waitFor(() => expect(result.current.data).toBe('secret'));

    // Simulate vault lock
    mockIsUnlocked = false;
    rerender();

    await waitFor(() => expect(result.current.data).toBe('empty'));
    expect(result.current.error).toBeNull();
  });

  // ── 13. Error is cleared on successful refetch ─────────────────────

  it('clears previous error on successful refetch', async () => {
    mockIsUnlocked = true;
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success');

    const { result } = renderHook(() => useVaultData(fetchFn));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.errorMessage).toBe('fail');

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.data).toBe('success');
  });
});
