import { useCallback } from 'react';
import { useVaultEntries } from '../contexts/VaultDataContext';
import useTemplates from './useTemplates';
import api from '../api/client';

const PRICE_CACHE_KEY = 'pv_ticker_prices';

/**
 * useRefreshPrices — Centralized hook for fetching latest prices and
 * writing them back to vault entries.
 *
 * Used by both PortfolioPage and VaultPage to ensure consistent behavior.
 * Fetches prices from /prices.php, then calls updateEntryLocal per entry
 * (which encrypts → API PUT → IndexedDB → React state → cross-tab sync).
 * Clears the sessionStorage price cache after applying.
 */
export default function useRefreshPrices() {
  const { entries, decryptedCache, updateEntryLocal } = useVaultEntries();
  const { templates } = useTemplates();

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
    const { data: resp } = await api.post('/prices.php', { tickers: unique });
    const prices = (resp?.data || resp)?.prices || {};

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

  return { refreshAndApplyPrices };
}
