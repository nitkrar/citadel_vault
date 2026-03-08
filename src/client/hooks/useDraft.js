import { useState, useEffect, useCallback, useRef } from 'react';

const DEBOUNCE_MS = 1000;

/**
 * useDraft — auto-save form drafts to localStorage.
 *
 * Writes are debounced (1s) to avoid blocking the main thread on every
 * keystroke. A flush on unmount ensures no pending data is lost.
 *
 * @param {string} key   localStorage key (prefixed with 'pv_draft_')
 * @param {*}      initialValue  fallback value when no draft exists
 * @returns {[*, Function, Function, Function]}  [value, setValue, clearDraft, confirmClear]
 */
export default function useDraft(key, initialValue) {
  const storageKey = `pv_draft_${key}`;

  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return JSON.parse(stored);
      }
    } catch {
      // corrupted data — fall through
    }
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  const timerRef = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Debounced persist — write at most once per second
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // storage full or unavailable — ignore
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerRef.current);
  }, [storageKey, value]);

  // Flush on unmount so no pending write is lost
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      try {
        localStorage.setItem(storageKey, JSON.stringify(valueRef.current));
      } catch {
        // ignore
      }
    };
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    clearTimeout(timerRef.current);
    localStorage.removeItem(storageKey);
    setValue(typeof initialValue === 'function' ? initialValue() : initialValue);
  }, [storageKey, initialValue]);

  /**
   * confirmClear — prompt the user before clearing the draft.
   * Returns true if cleared (or nothing to clear), false if user cancelled.
   * Use for Cancel buttons: `if (confirmClear()) closeModal();`
   */
  const confirmClear = useCallback(() => {
    const initial = typeof initialValue === 'function' ? initialValue() : initialValue;
    const current = valueRef.current;
    const isDirty = JSON.stringify(current) !== JSON.stringify(initial);
    if (isDirty && !window.confirm('Discard unsaved changes? Your local draft will be cleared.')) {
      return false;
    }
    clearDraft();
    return true;
  }, [initialValue, clearDraft]);

  return [value, setValue, clearDraft, confirmClear];
}
