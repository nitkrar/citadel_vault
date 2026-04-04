import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import * as workerDispatcher from '../lib/workerDispatcher';
import useCurrencies from './useCurrencies';
import useTemplates from './useTemplates';
import useAppConfig from './useAppConfig';
import api from '../api/client';

const PRICE_CACHE_KEY = 'pv_ticker_prices';

function getCachedPrices() {
  try {
    const raw = sessionStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function setCachedPrices(prices) {
  try {
    sessionStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(prices));
  } catch { /* quota exceeded — ignore */ }
}

/**
 * usePortfolioData — React hook that wires aggregation to vault lifecycle.
 *
 * Consumes entries from VaultDataContext, templates + currencies from reference data,
 * base_currency from config endpoint, and runs aggregatePortfolio via worker dispatcher.
 *
 * @returns {object} { portfolio, loading, error, refetch, displayCurrency, setDisplayCurrency, baseCurrency, ratesLastUpdated }
 */
export default function usePortfolioData() {
  const { user } = useAuth();
  const { entries: allEntries, decryptedCache, loading: entriesLoading, refetch } = useVaultEntries();

  // Display currency: initialized from user preference, overridable locally
  const [displayCurrencyOverride, setDisplayCurrencyOverride] = useState(null);

  const { currencies, loading: currLoading } = useCurrencies();
  const { templates, loading: tplLoading } = useTemplates();
  const { config, loading: cfgLoading } = useAppConfig();
  const refLoading = currLoading || tplLoading || cfgLoading;

  const baseCurrency = config?.base_currency || 'GBP';
  const displayCurrency = displayCurrencyOverride || user?.display_currency || baseCurrency;

  // Derive portfolio entries from context (replaces independent entryStore loading)
  const decryptedEntries = useMemo(() => {
    return allEntries
      .filter(e => e.entry_type === 'asset' || e.entry_type === 'account')
      .map(e => {
        const d = decryptedCache[e.id];
        if (!d) return null;
        const tmpl = templates.find(t => t.id === e.template_id);
        return {
          id: e.id,
          entry_type: e.entry_type,
          template_id: e.template_id,
          decrypted: d,
          template: tmpl ? {
            name: tmpl.name,
            icon: tmpl.icon,
            key: tmpl.template_key,
            subtype: tmpl.subtype,
            is_liability: tmpl.is_liability === 1 || tmpl.is_liability === '1' || tmpl.is_liability === true,
            fields: tmpl.fields || [],
          } : (e.template || null),
        };
      })
      .filter(Boolean);
  }, [allEntries, decryptedCache, templates]);

  const error = null; // Context handles errors internally

  // Run aggregation via worker dispatcher (async for worker path)
  const [portfolio, setPortfolio] = useState(null);

  useEffect(() => {
    if (!decryptedEntries?.length || !currencies?.length) {
      setPortfolio(null);
      return;
    }
    let cancelled = false;
    workerDispatcher.aggregateBatch(decryptedEntries, currencies, baseCurrency, displayCurrency)
      .then(r => { if (!cancelled) setPortfolio(r); })
      .catch(() => { if (!cancelled) setPortfolio(null); });
    return () => { cancelled = true; };
  }, [decryptedEntries, currencies, baseCurrency, displayCurrency]);

  // Save display currency preference to server
  const setDisplayCurrency = useCallback((code) => {
    setDisplayCurrencyOverride(code);
    // Persist to server (fire and forget)
    api.put('/preferences.php', { display_currency: code }).catch(() => {});
  }, []);

  return {
    portfolio,
    loading: refLoading || entriesLoading,
    error,
    refetch,
    displayCurrency,
    setDisplayCurrency,
    baseCurrency,
    currencies,
    ratesLastUpdated: portfolio?.rates_last_updated || null,
  };
}
