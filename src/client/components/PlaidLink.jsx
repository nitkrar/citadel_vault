import { useState, useCallback } from 'react';
import api from '../api/client';

const PLAID_LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

let scriptLoaded = false;

function loadPlaidScript() {
  return new Promise((resolve, reject) => {
    if (scriptLoaded || window.Plaid) {
      scriptLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = PLAID_LINK_SCRIPT;
    script.onload = () => { scriptLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Plaid Link SDK'));
    document.head.appendChild(script);
  });
}

/**
 * usePlaidLink — Hook for Plaid Link integration.
 *
 * @param {object} opts
 * @param {function} opts.onSuccess — Called with { itemId, accounts, metadata } after successful connection
 * @param {function} opts.onExit — Called when user closes Link
 * @param {string[]} opts.countryCodes — Default ['US', 'GB']
 * @param {string} opts.itemId — For re-auth (update mode), pass existing item_id
 */
export function usePlaidLink({ onSuccess, onExit, countryCodes = ['US', 'GB'], itemId } = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const open = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadPlaidScript();

      // Get link token from backend
      const action = itemId ? 'create-update-link-token' : 'create-link-token';
      const body = itemId ? { item_id: itemId } : { country_codes: countryCodes };
      const { data: resp } = await api.post(`/plaid.php?action=${action}`, body);
      const linkToken = (resp.data || resp).link_token;

      if (!linkToken) throw new Error('Failed to get link token');

      // Open Plaid Link
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            setLoading(true);
            const { data: exchangeResp } = await api.post('/plaid.php?action=exchange-token', {
              public_token: publicToken,
            });
            const result = exchangeResp.data || exchangeResp;
            onSuccess?.({
              itemId: result.item_id,
              accounts: result.accounts,
              metadata,
            });
          } catch (err) {
            setError(err.response?.data?.error || 'Failed to connect bank');
          } finally {
            setLoading(false);
          }
        },
        onExit: (err, metadata) => {
          setLoading(false);
          if (err) setError(err.display_message || err.error_message || 'Connection cancelled');
          onExit?.(err, metadata);
        },
      });
      handler.open();
    } catch (err) {
      setError(err.message || 'Failed to open bank connection');
      setLoading(false);
    }
  }, [countryCodes, itemId, onSuccess, onExit]);

  return { open, loading, error };
}
