/**
 * Prices API Integration Tests
 *
 * Tests the unified market data refresh endpoint and admin cache management.
 * Endpoints: POST /prices.php?action=refresh, GET/DELETE /prices.php?action=cache
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

/**
 * Extract data from API response, tolerating PHP deprecation warnings
 * that may prefix the JSON body (e.g. curl_close() in PHP 8.5).
 */
async function extractData(resp) {
  const text = await resp.text();
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  const body = JSON.parse(text.slice(jsonStart));
  return body?.data ?? body;
}

// ── POST ?action=refresh — Ticker refresh with explicit list ────────
describe('Prices API — refresh with ticker list', () => {
  it('fetches a valid ticker with price data', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('ticker');
    expect(data.ticker).toHaveProperty('prices');
    expect(data.ticker.prices).toHaveProperty('AAPL');
    const priceData = data.ticker.prices.AAPL;
    expect(priceData).toHaveProperty('price');
    expect(typeof priceData.price).toBe('number');
    expect(priceData.price).toBeGreaterThan(0);
    expect(priceData).toHaveProperty('currency');
    expect(priceData).toHaveProperty('exchange');
    expect(priceData).toHaveProperty('name');
  });

  it('fetches multiple tickers', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL', 'MSFT'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(Object.keys(data.ticker.prices)).toHaveLength(2);
    expect(data.ticker.prices).toHaveProperty('AAPL');
    expect(data.ticker.prices).toHaveProperty('MSFT');
  });

  it('returns invalid ticker in errors', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['ZZZZZZINVALID99'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.ticker.errors).toHaveProperty('ZZZZZZINVALID99');
  });

  it('handles mix of valid and invalid tickers', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL', 'ZZZZZZINVALID99'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    const priceCount = Array.isArray(data.ticker.prices) ? 0 : Object.keys(data.ticker.prices).length;
    const errorCount = Array.isArray(data.ticker.errors) ? data.ticker.errors.length : Object.keys(data.ticker.errors).length;
    expect(priceCount + errorCount).toBe(2);
  });

  it('treats empty tickers array as stale refresh', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: [] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.ticker).toHaveProperty('updated');
  });

  it('returns cached: true on second fetch of same ticker', async () => {
    // First fetch to populate cache
    await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL'] } });
    // Second fetch should hit cache
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.ticker.prices.AAPL.cached).toBe(true);
  });

  it('returns currency USD for crypto ticker BTC-USD', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['BTC-USD'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    if (!data.ticker.prices['BTC-USD']) {
      return; // Skip if BTC-USD not available
    }
    expect(data.ticker.prices['BTC-USD'].currency).toBe('USD');
  });

  it('normalizes GBp to GBP for UK tickers', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['BARC.L'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    if (!data.ticker.prices['BARC.L']) {
      return; // Skip if BARC.L not available
    }
    expect(data.ticker.prices['BARC.L'].currency).toBe('GBP');
  });

  it('rejects tickers with special characters (sanitization)', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL; DROP TABLE', '<script>'] } });
    expect(resp.status).toBe(400);
  });

  it('processes at most 50 tickers', async () => {
    const tickers = Array.from({ length: 60 }, (_, i) => `FAKE${i}`);
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    const priceCount = Array.isArray(data.ticker.prices) ? 0 : Object.keys(data.ticker.prices).length;
    const errorCount = Array.isArray(data.ticker.errors) ? data.ticker.errors.length : Object.keys(data.ticker.errors).length;
    expect(priceCount + errorCount).toBeLessThanOrEqual(50);
  });
});

// ── POST ?action=refresh — Stale refresh (no ticker list) ───────────
describe('Prices API — refresh stale (no ticker list)', () => {
  it('refreshes all stale tickers without input', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'ticker' } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.ticker).toHaveProperty('updated');
  });

  it('type=all refreshes both forex and ticker', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'all' } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('forex');
    expect(data).toHaveProperty('ticker');
  });

  it('defaults to type=all when no type specified', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: {} });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('forex');
    expect(data).toHaveProperty('ticker');
  });

  it('type=forex refreshes only forex', async () => {
    const resp = await api.post('/prices.php?action=refresh', { json: { type: 'forex' } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('forex');
    expect(data).not.toHaveProperty('ticker');
  });
});

// ── Admin cache management ──────────────────────────────────────────
describe('Prices API — admin cache management', () => {
  it('GET action=cache returns cached price list', async () => {
    // Ensure at least one cached entry
    await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL'] } });

    const resp = await api.get('/prices.php', { params: { action: 'cache' } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('ticker');
    expect(data[0]).toHaveProperty('price');
  });

  it('DELETE action=cache clears all cached prices', async () => {
    // Populate cache
    await api.post('/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL'] } });

    // Clear it
    const resp = await api.delete('/prices.php?action=cache');
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.cleared).toBe(true);

    // Verify empty
    const resp2 = await api.get('/prices.php', { params: { action: 'cache' } });
    expect(resp2.status).toBe(200);
    const data2 = await extractData(resp2);
    expect(data2).toHaveLength(0);
  });
});

// ── Auth enforcement ────────────────────────────────────────────────
describe('Prices API — auth enforcement', () => {
  it('POST without auth returns 401', async () => {
    const resp = await unauthRequest('POST', '/prices.php?action=refresh', { json: { type: 'ticker', tickers: ['AAPL'] } });
    expect(resp.status).toBe(401);
  });

  it('GET cache without auth returns 401', async () => {
    const resp = await unauthRequest('GET', '/prices.php', { params: { action: 'cache' } });
    expect(resp.status).toBe(401);
  });
});
