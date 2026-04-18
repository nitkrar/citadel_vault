import { useState, useCallback } from 'react';
import { useVaultEntries } from '../contexts/VaultDataContext';
import useTemplates from './useTemplates';
import { fetchTickerPrices } from '../lib/priceApi';

const PRICE_CACHE_KEY = 'pv_ticker_prices';

/**
 * useRefreshPrices — Centralized hook for all "Refresh All" operations.
 *
 * Handles price refresh (stock/crypto tickers) with consolidated toast feedback
 * state. Both VaultPage and PortfolioPage call handleRefreshAll() and render
 * SaveToast from this hook.
 *
 * refreshAndApplyPrices is also exported for callers that only need prices.
 */
export default function useRefreshPrices() {
  const { entries, decryptedCache, updateEntryLocal } = useVaultEntries();
  const { templates } = useTemplates();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToast, setRefreshToast] = useState(null);

  const refreshAndApplyPrices = useCallback(async () => {
    if (!entries?.length || !templates?.length) return { count: 0 };

    // Collect tickers from stock/crypto entries
    const tickerEntries = [];
    for (const entry of entries) {
      const d = decryptedCache[entry.id];
      if (!d) continue;
      const tpl = templates.find(t => t.id === entry.template_id) || entry.template;
      const subtype = tpl?.subtype;
      const ticker = subtype === 'stock' ? d.ticker
                   : subtype === 'crypto' ? d.coin
                   : null;
      if (ticker) {
        tickerEntries.push({
          id: entry.id,
          ticker,
          decrypted: d,
          priceKey: subtype === 'crypto' ? 'price_per_unit' : 'price_per_share',
        });
      }
    }
    if (tickerEntries.length === 0) return { count: 0 };

    // Fetch from API
    const unique = [...new Set(tickerEntries.map(e => e.ticker))];
    const { prices } = await fetchTickerPrices(unique);

    // Apply to entries (encrypt → server → IndexedDB → React state)
    let count = 0;
    for (const te of tickerEntries) {
      const p = prices[te.ticker];
      if (!p) continue;
      const updated = { ...te.decrypted, [te.priceKey]: String(p.price), currency: p.currency };
      await updateEntryLocal(te.id, updated);
      count++;
    }

    // Clear stale cache — prices are now in entries
    try { sessionStorage.removeItem(PRICE_CACHE_KEY); } catch { /* ignore */ }

    return { count };
  }, [entries, decryptedCache, templates, updateEntryLocal]);

  /**
   * handleRefreshAll — Price refresh with toast feedback.
   */
  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    setRefreshToast(null);
    const results = [];

    try {
      const promises = [];

      // Refresh prices (stock/crypto)
      promises.push(
        refreshAndApplyPrices()
          .then(r => { if (r.count > 0) results.push(`${r.count} price${r.count !== 1 ? 's' : ''}`); })
          .catch(() => results.push('prices failed'))
      );

      await Promise.all(promises);
      const hasFailure = results.some(r => r.includes('failed'));
      setRefreshToast({
        message: results.length > 0 ? `Refreshed ${results.join(', ')}` : 'Everything up to date',
        type: hasFailure ? 'error' : 'success',
        key: Date.now(),
      });
    } catch {
      setRefreshToast({ message: 'Refresh failed', type: 'error', key: Date.now() });
    } finally {
      setRefreshing(false);
    }
  }, [refreshAndApplyPrices]);

  return {
    refreshAndApplyPrices,
    handleRefreshAll,
    refreshing,
    refreshToast,
    clearRefreshToast: () => setRefreshToast(null),
  };
}
