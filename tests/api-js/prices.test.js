/**
 * Prices API Integration Tests
 *
 * Tests the Yahoo Finance price proxy with server-side caching.
 * Endpoints: POST /prices.php, GET/DELETE /prices.php?action=cache
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

// ── POST — Fetch prices for tickers ─────────────────────────────────
describe('Prices API — POST (fetch prices)', () => {
  it('fetches a valid ticker with price data', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['AAPL'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('prices');
    expect(data.prices).toHaveProperty('AAPL');
    const priceData = data.prices.AAPL;
    expect(priceData).toHaveProperty('price');
    expect(typeof priceData.price).toBe('number');
    expect(priceData.price).toBeGreaterThan(0);
    expect(priceData).toHaveProperty('currency');
    expect(priceData).toHaveProperty('exchange');
    expect(priceData).toHaveProperty('name');
  });

  it('fetches multiple tickers', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['AAPL', 'MSFT'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(Object.keys(data.prices)).toHaveLength(2);
    expect(data.prices).toHaveProperty('AAPL');
    expect(data.prices).toHaveProperty('MSFT');
  });

  it('returns invalid ticker in errors', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['ZZZZZZINVALID99'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.errors).toHaveProperty('ZZZZZZINVALID99');
  });

  it('handles mix of valid and invalid tickers', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['AAPL', 'ZZZZZZINVALID99'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    const priceCount = Array.isArray(data.prices) ? 0 : Object.keys(data.prices).length;
    const errorCount = Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length;
    expect(priceCount + errorCount).toBe(2);
  });

  it('returns 400 for empty tickers array', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: [] } });
    expect(resp.status).toBe(400);
  });

  it('returns 400 when tickers field is missing', async () => {
    const resp = await api.post('/prices.php', { json: {} });
    expect(resp.status).toBe(400);
  });

  it('returns cached: true on second fetch of same ticker', async () => {
    // First fetch to populate cache
    await api.post('/prices.php', { json: { tickers: ['AAPL'] } });
    // Second fetch should hit cache
    const resp = await api.post('/prices.php', { json: { tickers: ['AAPL'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.prices.AAPL.cached).toBe(true);
  });

  it('returns currency USD for crypto ticker BTC-USD', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['BTC-USD'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    if (!data.prices['BTC-USD']) {
      // Skip if BTC-USD not available from Yahoo Finance
      return;
    }
    expect(data.prices['BTC-USD'].currency).toBe('USD');
  });

  it('normalizes GBp to GBP for UK tickers', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['BARC.L'] } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    if (!data.prices['BARC.L']) {
      // Skip if BARC.L not available from Yahoo Finance
      return;
    }
    expect(data.prices['BARC.L'].currency).toBe('GBP');
  });

  it('rejects tickers with special characters (sanitization)', async () => {
    const resp = await api.post('/prices.php', { json: { tickers: ['AAPL; DROP TABLE', '<script>'] } });
    expect(resp.status).toBe(400); // all filtered → no valid tickers
  });

  it('processes at most 50 tickers', async () => {
    const tickers = Array.from({ length: 60 }, (_, i) => `FAKE${i}`);
    const resp = await api.post('/prices.php', { json: { tickers } });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    const priceCount = Array.isArray(data.prices) ? 0 : Object.keys(data.prices).length;
    const errorCount = Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length;
    expect(priceCount + errorCount).toBeLessThanOrEqual(50);
  });
});

// ── Admin cache management ──────────────────────────────────────────
describe('Prices API — admin cache management', () => {
  it('GET action=cache returns cached price list', async () => {
    // Ensure at least one cached entry
    await api.post('/prices.php', { json: { tickers: ['AAPL'] } });

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
    await api.post('/prices.php', { json: { tickers: ['AAPL'] } });

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
    const resp = await unauthRequest('POST', '/prices.php', { json: { tickers: ['AAPL'] } });
    expect(resp.status).toBe(401);
  });

  it('GET cache without auth returns 401', async () => {
    const resp = await unauthRequest('GET', '/prices.php', { params: { action: 'cache' } });
    expect(resp.status).toBe(401);
  });
});
