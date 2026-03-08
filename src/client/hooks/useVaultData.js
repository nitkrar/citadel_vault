import { useState, useEffect, useCallback, useRef } from 'react';
import { useEncryption } from '../contexts/EncryptionContext';
import { isTruthy } from '../lib/checks';

/**
 * useVaultData — Centralized hook for vault-aware data fetching.
 *
 * Automatically:
 *  - Fetches data when vault is unlocked
 *  - Clears data when vault is locked
 *  - Re-fetches when vault state changes (lock → unlock)
 *  - Handles loading state
 *
 * @param {Function} fetchFn     - Async function that returns data.
 * @param {*}        initialValue - Value when vault is locked (default: null).
 * @param {Object}   options
 * @param {boolean}  options.requireVault - If false, fetches even when locked (default: true).
 *
 * @returns {{ data, loading, error, refetch, setData }}
 */
export default function useVaultData(fetchFn, initialValue = null, options = {}) {
  const { requireVault = true } = options;
  const { vaultUnlocked } = useEncryption();
  const isUnlocked = isTruthy(vaultUnlocked);

  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Use a ref so the fetch function always sees the latest vault state
  const isUnlockedRef = useRef(isUnlocked);
  isUnlockedRef.current = isUnlocked;

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;

  const refetch = useCallback(async () => {
    if (requireVault && !isUnlockedRef.current) {
      setData(initialValueRef.current);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchFnRef.current();
      setData(result);
    } catch (err) {
      setError(err);
      setData(initialValueRef.current);
    } finally {
      setLoading(false);
    }
  }, [requireVault]);

  // Re-fetch whenever vault state changes
  useEffect(() => {
    refetch();
  }, [isUnlocked, refetch]);

  // Extract a human-readable error message from axios/API errors
  const errorMessage = error
    ? error.response?.data?.error || error.message || 'An unexpected error occurred.'
    : null;

  return { data, loading, error, errorMessage, refetch, setData };
}
