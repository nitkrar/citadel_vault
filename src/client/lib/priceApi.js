import api from '../api/client';

export async function fetchTickerPrice(ticker) {
  const t = ticker.trim();
  const { data: resp } = await api.post('/prices.php?action=refresh', {
    type: 'ticker',
    tickers: [t],
  });
  const result = resp?.data || resp;
  const price = result?.ticker?.prices?.[t] || null;
  return {
    price,
    error: result?.ticker?.errors?.[t] || null,
    canonicalTicker: price?.canonical_ticker || null,
    afterHours: Boolean(price?.after_hours),
  };
}

export async function fetchTickerPrices(tickers) {
  const unique = [...new Set(tickers.map(t => t.trim()).filter(Boolean))];
  if (!unique.length) return { prices: {}, errors: {} };

  const { data: resp } = await api.post('/prices.php?action=refresh', {
    type: 'ticker',
    tickers: unique,
  });
  const result = resp?.data || resp;
  return {
    prices: result?.ticker?.prices || {},
    errors: result?.ticker?.errors || {},
  };
}
