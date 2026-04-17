import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pv_display_currency_session';
const CHANGE_EVENT = 'display-currency-changed';

function readStored() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || null;
  } catch { return null; }
}

function writeStored(code) {
  try {
    if (code) sessionStorage.setItem(STORAGE_KEY, code);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* quota / disabled — ignore */ }
}

function emitChange() {
  try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch {}
}

/**
 * Clear the session override. Call this when the user saves a new default
 * so the new default takes effect immediately across all pages.
 */
export function clearDisplayCurrencyOverride() {
  writeStored(null);
  emitChange();
}

/**
 * useDisplayCurrency — session-scoped display currency override.
 *
 * Persists across navigation + refresh within the same tab via sessionStorage.
 * Does NOT write to the server — saving the default is ProfilePage's job.
 * Multiple hook instances on the same page stay in sync via a window event.
 *
 * @returns {{ override: string|null, setDisplayCurrency: (code: string|null) => void }}
 */
export default function useDisplayCurrency() {
  const [override, setOverride] = useState(readStored);

  useEffect(() => {
    const sync = () => setOverride(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const setDisplayCurrency = useCallback((code) => {
    const next = code || null;
    writeStored(next);
    setOverride(next);
    emitChange();
  }, []);

  return { override, setDisplayCurrency };
}
