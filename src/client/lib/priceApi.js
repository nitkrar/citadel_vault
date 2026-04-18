import api from '../api/client';

export async function fetchTickerPrice(ticker) {
  const t = ticker.trim();
  const { data: resp } = await api.post('/prices.php?action=refresh', {
    type: 'ticker',
    tickers: [t],
  });
  const result = resp?.data || resp;
  return {
    price: result?.ticker?.prices?.[t] || null,
    error: result?.ticker?.errors?.[t] || null,
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
