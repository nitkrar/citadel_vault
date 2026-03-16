import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import { entryStore } from '../lib/entryStore';
import * as workerDispatcher from '../lib/workerDispatcher';
import useVaultData from './useVaultData';
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
 * Loads entries from entryStore, templates + currencies from reference data,
 * base_currency from config endpoint, and runs aggregatePortfolio in useMemo.
 *
 * @returns {object} { portfolio, loading, error, refetch, displayCurrency, setDisplayCurrency, baseCurrency, ratesLastUpdated }
 */
export default function usePortfolioData() {
  const { isUnlocked, decrypt } = useEncryption();
  const { user } = useAuth();

  // Display currency: initialized from user preference, overridable locally
  const [displayCurrencyOverride, setDisplayCurrencyOverride] = useState(null);

  const { currencies, loading: currLoading } = useCurrencies();
  const { templates, loading: tplLoading } = useTemplates();
  const { config, loading: cfgLoading } = useAppConfig();
  const refLoading = currLoading || tplLoading || cfgLoading;

  const baseCurrency = config?.base_currency || 'GBP';
  const displayCurrency = displayCurrencyOverride || user?.display_currency || baseCurrency;

  // Fetch and decrypt entries
  const fetchEntries = useCallback(async () => {
    const entries = await entryStore.getAll();
    const decrypted = [];

    for (const entry of entries) {
      if (entry.entry_type !== 'asset' && entry.entry_type !== 'account') continue;
      try {
        const d = await decrypt(entry.encrypted_data);
        if (d) {
          // Find the template for this entry
          const tmpl = templates.find(t => t.id === entry.template_id);
          decrypted.push({
            id: entry.id,
            entry_type: entry.entry_type,
            template_id: entry.template_id,
            decrypted: d,
            template: tmpl ? {
              name: tmpl.name,
              icon: tmpl.icon,
              key: tmpl.template_key,
              subtype: tmpl.subtype,
              is_liability: tmpl.is_liability === 1 || tmpl.is_liability === '1' || tmpl.is_liability === true,
              fields: tmpl.fields || [],
            } : (entry.template || null),
          });
        }
      } catch { /* skip entries that fail to decrypt */ }
    }

    return decrypted;
  }, [decrypt, templates]);

  const { data: decryptedEntries, loading: entriesLoading, error, refetch } = useVaultData(fetchEntries, []);

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

  // Refresh prices from server for stock/crypto entries
  const refreshPrices = useCallback(async () => {
    if (!decryptedEntries || decryptedEntries.length === 0) return { count: 0, prices: {} };

    // Collect tickers from decrypted stock/crypto entries
    const tickers = [];
    for (const entry of decryptedEntries) {
      const subtype = entry.template?.subtype;
      if (subtype === 'stock' && entry.decrypted?.ticker) {
        tickers.push(entry.decrypted.ticker);
      } else if (subtype === 'crypto' && entry.decrypted?.coin) {
        tickers.push(entry.decrypted.coin);
      }
    }

    if (tickers.length === 0) return { count: 0, prices: {} };

    const unique = [...new Set(tickers)];
    const cached = getCachedPrices();

    // Filter to only uncached tickers
    const uncached = unique.filter(t => !cached[t]);

    let fetchedPrices = {};
    if (uncached.length > 0) {
      const { data: resp } = await api.post('/prices.php', { tickers: uncached });
      const result = resp?.data || resp;
      fetchedPrices = result?.prices || {};
    }

    // Merge into cache
    const merged = { ...cached, ...fetchedPrices };
    setCachedPrices(merged);

    return { count: Object.keys(fetchedPrices).length, prices: merged };
  }, [decryptedEntries]);

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
    refreshPrices,
  };
}
