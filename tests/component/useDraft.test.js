/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Node.js 22+ ships a built-in `localStorage` global (a plain key-value object
// without the Web Storage API). It shadows jsdom's `window.localStorage`.
// Replace the global with a proper Storage-compatible mock so the hook (which
// references `localStorage` directly) uses the right implementation.
const store = new Map();
const storageMock = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, val) => store.set(key, String(val)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true, configurable: true });

// Import hook AFTER the mock is in place so its `localStorage` references resolve correctly
const { default: useDraft } = await import('../../src/client/hooks/useDraft.js');

describe('useDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('returns initialValue when localStorage is empty', () => {
    const { result } = renderHook(() => useDraft('test', 'hello'));
    expect(result.current[0]).toBe('hello');
  });

  it('returns stored value from localStorage', () => {
    storageMock.setItem('pv_draft_test', JSON.stringify({ name: 'saved' }));
    const { result } = renderHook(() => useDraft('test', {}));
    expect(result.current[0]).toEqual({ name: 'saved' });
  });

  it('calls initialValue as function when it is a function', () => {
    const factory = vi.fn(() => ({ count: 0 }));
    const { result } = renderHook(() => useDraft('test', factory));
    expect(factory).toHaveBeenCalledOnce();
    expect(result.current[0]).toEqual({ count: 0 });
  });

  it('falls back to initialValue when localStorage has invalid JSON', () => {
    storageMock.setItem('pv_draft_test', '{broken json!!!');
    const { result } = renderHook(() => useDraft('test', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('setValue triggers localStorage write after 1000ms debounce', () => {
    const { result } = renderHook(() => useDraft('test', ''));

    act(() => { result.current[1]('updated'); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(storageMock.getItem('pv_draft_test')).toBe(JSON.stringify('updated'));
  });

  it('setValue does NOT write to localStorage immediately', () => {
    const { result } = renderHook(() => useDraft('test', ''));

    act(() => { result.current[1]('changed'); });

    // Only advance partway — not enough for debounce to fire
    act(() => { vi.advanceTimersByTime(500); });

    // localStorage should not yet contain 'changed'
    expect(storageMock.getItem('pv_draft_test')).not.toBe(JSON.stringify('changed'));
  });

  it('clearDraft removes from localStorage and resets value to initialValue', () => {
    storageMock.setItem('pv_draft_test', JSON.stringify('saved'));
    const { result } = renderHook(() => useDraft('test', 'default'));

    expect(result.current[0]).toBe('saved');

    act(() => { result.current[2](); }); // clearDraft

    expect(result.current[0]).toBe('default');
    expect(storageMock.getItem('pv_draft_test')).toBeNull();
  });

  it('confirmClear returns true without prompting when value equals initialValue', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { result } = renderHook(() => useDraft('test', 'initial'));

    let returned;
    act(() => { returned = result.current[3](); }); // confirmClear

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(returned).toBe(true);
    confirmSpy.mockRestore();
  });

  it('confirmClear returns true and clears when user confirms', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderHook(() => useDraft('test', 'initial'));

    // Make it dirty
    act(() => { result.current[1]('dirty'); });

    let returned;
    act(() => { returned = result.current[3](); }); // confirmClear

    expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved changes? Your local draft will be cleared.');
    expect(returned).toBe(true);
    expect(result.current[0]).toBe('initial'); // reset to initial
    confirmSpy.mockRestore();
  });

  it('confirmClear returns false and keeps value when user cancels', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() => useDraft('test', 'initial'));

    // Make it dirty
    act(() => { result.current[1]('dirty'); });

    let returned;
    act(() => { returned = result.current[3](); }); // confirmClear

    expect(confirmSpy).toHaveBeenCalled();
    expect(returned).toBe(false);
    expect(result.current[0]).toBe('dirty'); // value unchanged
    confirmSpy.mockRestore();
  });

  it('writes current value to localStorage on unmount even if debounce pending', () => {
    const { result, unmount } = renderHook(() => useDraft('test', ''));

    act(() => { result.current[1]('pending'); });

    // Do NOT advance timers — debounce has not fired
    unmount();

    expect(storageMock.getItem('pv_draft_test')).toBe(JSON.stringify('pending'));
  });

  it('uses pv_draft_ prefix for the storage key', () => {
    const { result } = renderHook(() => useDraft('myform', 'val'));

    act(() => { result.current[1]('new'); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(storageMock.getItem('pv_draft_myform')).toBe(JSON.stringify('new'));
    // No key without prefix
    expect(storageMock.getItem('myform')).toBeNull();
  });
});
