import { useState, useMemo, useCallback } from 'react';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import { entryStore } from '../lib/entryStore';
import { aggregatePortfolio } from '../lib/portfolioAggregator';
import useVaultData from './useVaultData';
import useCurrencies from './useCurrencies';
import useTemplates from './useTemplates';
import useAppConfig from './useAppConfig';
import api from '../api/client';

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
        const d = await decrypt(entry.data);
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

  // Run aggregation in useMemo (instant on currency switch)
  const portfolio = useMemo(() => {
    if (!decryptedEntries || decryptedEntries.length === 0 || !currencies || currencies.length === 0) {
      return null;
    }
    return aggregatePortfolio(decryptedEntries, currencies, baseCurrency, displayCurrency);
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
