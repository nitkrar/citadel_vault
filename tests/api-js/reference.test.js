/**
 * Reference API Integration Tests
 *
 * Tests the reference.php endpoints: currencies, countries, config,
 * historical-rates, exchanges CRUD, inline editing, and is_active filtering.
 *
 * Migrated from: tests/api/test_reference.py
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData } from '../helpers/apiClient.js';

// ── Historical Rates ────────────────────────────────────────────────
describe('Historical Rates', () => {
  describe('GET /reference.php?resource=historical-rates', () => {
    it('returns rates map for a valid date or 404 if none', async () => {
      const resp = await api.get('/reference.php', {
        params: { resource: 'historical-rates', date: '2026-03-14' },
      });

      if (resp.status === 404) {
        // No rates for this date — acceptable if rates haven't been refreshed
        const body = await resp.json();
        expect(body.error || '').toContain('No rates found');
        return; // skip remainder
      }

      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('base_currency');
      expect(data).toHaveProperty('rates');
      expect(typeof data.rates).toBe('object');

      for (const [code, rate] of Object.entries(data.rates)) {
        expect(typeof rate).toBe('number');
        expect(rate).toBeGreaterThan(0);
      }
    });

    it('returns 400 when date param is missing', async () => {
      const resp = await api.get('/reference.php', {
        params: { resource: 'historical-rates' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for garbage date string', async () => {
      const resp = await api.get('/reference.php', {
        params: { resource: 'historical-rates', date: 'not-a-date' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 404 for a far future date with no data', async () => {
      const resp = await api.get('/reference.php', {
        params: { resource: 'historical-rates', date: '2030-01-01' },
      });
      expect(resp.status).toBe(404);
    });
  });
});

// ── Regression: existing endpoints still work ───────────────────────
describe('Reference Regression', () => {
  it('GET currencies returns a non-empty list with code field', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'currencies' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('code');
  });

  it('GET countries returns a list', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'countries' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET config returns base_currency', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'config' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('base_currency');
  });

  it('returns 404 for unknown resource', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'nonexistent' },
    });
    expect(resp.status).toBe(404);
  });
});

// ── Countries: is_active filtering ──────────────────────────────────
describe('Countries Active Filtering', () => {
  /** Get the last country (to avoid disrupting common ones). */
  async function getTestCountry() {
    const resp = await api.get('/reference.php', {
      params: { resource: 'countries', all: '1' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.length).toBeGreaterThan(0);
    return data[data.length - 1];
  }

  it('countries include is_active field', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'countries', all: '1' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('is_active');
  });

  it('default GET returns active-only countries', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'countries' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    for (const c of data) {
      expect(Number(c.is_active)).toBe(1);
    }
  });

  it('all=1 returns inactive countries too', async () => {
    const country = await getTestCountry();
    // Deactivate
    await api.put(`/reference.php?resource=countries&id=${country.id}`, {
      json: { is_active: 0 },
    });
    try {
      // Default GET should exclude it
      const activeResp = await api.get('/reference.php', {
        params: { resource: 'countries' },
      });
      const activeData = await extractData(activeResp);
      const activeIds = activeData.map((c) => c.id);
      expect(activeIds).not.toContain(country.id);

      // all=1 should include it
      const allResp = await api.get('/reference.php', {
        params: { resource: 'countries', all: '1' },
      });
      const allData = await extractData(allResp);
      const allIds = allData.map((c) => c.id);
      expect(allIds).toContain(country.id);
    } finally {
      // Re-activate
      await api.put(`/reference.php?resource=countries&id=${country.id}`, {
        json: { is_active: 1 },
      });
    }
  });

  it('PUT is_active toggles country active status', async () => {
    const country = await getTestCountry();

    // Toggle off
    const offResp = await api.put(
      `/reference.php?resource=countries&id=${country.id}`,
      { json: { is_active: 0 } },
    );
    expect(offResp.status).toBe(200);
    const offData = await extractData(offResp);
    expect(Number(offData.is_active)).toBe(0);

    // Toggle back on
    const onResp = await api.put(
      `/reference.php?resource=countries&id=${country.id}`,
      { json: { is_active: 1 } },
    );
    expect(onResp.status).toBe(200);
    const onData = await extractData(onResp);
    expect(Number(onData.is_active)).toBe(1);
  });
});

// ── Inline editing: countries ───────────────────────────────────────
describe('Inline Edit Countries', () => {
  async function getTestCountry() {
    const resp = await api.get('/reference.php', {
      params: { resource: 'countries', all: '1' },
    });
    const data = await extractData(resp);
    return data[data.length - 1];
  }

  it('PUT name updates country name', async () => {
    const country = await getTestCountry();
    const originalName = country.name;
    const newName = originalName + ' (Test)';
    try {
      const resp = await api.put(
        `/reference.php?resource=countries&id=${country.id}`,
        { json: { name: newName } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.name).toBe(newName);
    } finally {
      await api.put(`/reference.php?resource=countries&id=${country.id}`, {
        json: { name: originalName },
      });
    }
  });

  it('PUT code updates country code', async () => {
    const country = await getTestCountry();
    const originalCode = country.code;
    const newCode = 'ZZ';
    try {
      const resp = await api.put(
        `/reference.php?resource=countries&id=${country.id}`,
        { json: { code: newCode } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.code).toBe(newCode);
    } finally {
      await api.put(`/reference.php?resource=countries&id=${country.id}`, {
        json: { code: originalCode },
      });
    }
  });

  it('PUT flag_emoji updates country flag', async () => {
    const country = await getTestCountry();
    const originalFlag = country.flag_emoji;
    try {
      const resp = await api.put(
        `/reference.php?resource=countries&id=${country.id}`,
        { json: { flag_emoji: '\u{1F3F3}\u{FE0F}' } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.flag_emoji).not.toBeNull();
    } finally {
      await api.put(`/reference.php?resource=countries&id=${country.id}`, {
        json: { flag_emoji: originalFlag },
      });
    }
  });

  it('PUT default_currency_id updates default currency', async () => {
    const country = await getTestCountry();
    const originalCurrency = country.default_currency_id;
    try {
      const resp = await api.put(
        `/reference.php?resource=countries&id=${country.id}`,
        { json: { default_currency_id: 1 } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Number(data.default_currency_id)).toBe(1);
    } finally {
      await api.put(`/reference.php?resource=countries&id=${country.id}`, {
        json: { default_currency_id: originalCurrency },
      });
    }
  });

  it('PUT with empty body returns 400', async () => {
    const country = await getTestCountry();
    const resp = await api.put(
      `/reference.php?resource=countries&id=${country.id}`,
      { json: {} },
    );
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error || '').toContain('No fields');
  });

  it('PUT on non-existent country returns 404', async () => {
    const resp = await api.put('/reference.php?resource=countries&id=999999', {
      json: { name: 'Test' },
    });
    expect(resp.status).toBe(404);
  });
});

// ── Inline editing: currencies ──────────────────────────────────────
describe('Inline Edit Currencies', () => {
  async function getTestCurrency() {
    const resp = await api.get('/reference.php', {
      params: { resource: 'currencies', all: '1' },
    });
    const data = await extractData(resp);
    return data[data.length - 1];
  }

  it('PUT code updates currency code', async () => {
    const currency = await getTestCurrency();
    const originalCode = currency.code;
    const newCode = originalCode + 'X';
    try {
      const resp = await api.put(
        `/reference.php?resource=currencies&id=${currency.id}`,
        { json: { code: newCode } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.code).toBe(newCode);
    } finally {
      await api.put(`/reference.php?resource=currencies&id=${currency.id}`, {
        json: { code: originalCode },
      });
    }
  });

  it('PUT name updates currency name', async () => {
    const currency = await getTestCurrency();
    const originalName = currency.name;
    const newName = originalName + ' (Test)';
    try {
      const resp = await api.put(
        `/reference.php?resource=currencies&id=${currency.id}`,
        { json: { name: newName } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.name).toBe(newName);
    } finally {
      await api.put(`/reference.php?resource=currencies&id=${currency.id}`, {
        json: { name: originalName },
      });
    }
  });

  it('PUT symbol updates currency symbol', async () => {
    const currency = await getTestCurrency();
    const originalSymbol = currency.symbol;
    try {
      const resp = await api.put(
        `/reference.php?resource=currencies&id=${currency.id}`,
        { json: { symbol: '\u00A4' } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.symbol).toBe('\u00A4');
    } finally {
      await api.put(`/reference.php?resource=currencies&id=${currency.id}`, {
        json: { symbol: originalSymbol },
      });
    }
  });

  it('PUT with empty body returns 400', async () => {
    const currency = await getTestCurrency();
    const resp = await api.put(
      `/reference.php?resource=currencies&id=${currency.id}`,
      { json: {} },
    );
    expect(resp.status).toBe(400);
  });

  it('PUT on non-existent currency returns 404', async () => {
    const resp = await api.put(
      '/reference.php?resource=currencies&id=999999',
      { json: { name: 'Test' } },
    );
    expect(resp.status).toBe(404);
  });
});

// ── Exchanges: CRUD operations ──────────────────────────────────────
describe('Exchanges CRUD', () => {
  it('GET returns seeded list of at least 8 exchanges', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'exchanges' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(8);
  });

  it('GET includes country_name from JOIN', async () => {
    const resp = await api.get('/reference.php', {
      params: { resource: 'exchanges' },
    });
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.length).toBeGreaterThan(0);
    const hasCountryName = data.some((e) => e.country_name);
    expect(hasCountryName).toBe(true);
  });

  it('POST creates a new exchange and returns 201', async () => {
    const payload = {
      country_code: 'ZZ',
      name: 'Test Exchange',
      suffix: 'ZZ',
      display_order: 99,
    };
    const resp = await api.post('/reference.php?resource=exchanges', {
      json: payload,
    });
    expect(resp.status).toBe(201);
    const data = await extractData(resp);
    expect(data.name).toBe('Test Exchange');
    expect(data.country_code).toBe('ZZ');
    expect(data.suffix).toBe('ZZ');
    // Cleanup
    await api.delete(`/reference.php?resource=exchanges&id=${data.id}`);
  });

  it('POST with missing required fields returns 400', async () => {
    const resp = await api.post('/reference.php?resource=exchanges', {
      json: { suffix: 'X' },
    });
    expect(resp.status).toBe(400);
  });

  it('PUT updates exchange fields', async () => {
    // Create a test exchange first
    const createResp = await api.post('/reference.php?resource=exchanges', {
      json: { country_code: 'ZZ', name: 'Update Test', suffix: 'UT' },
    });
    expect(createResp.status).toBe(201);
    const created = await extractData(createResp);
    const exId = created.id;
    try {
      const resp = await api.put(
        `/reference.php?resource=exchanges&id=${exId}`,
        { json: { name: 'Updated Name', suffix: 'UN' } },
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.name).toBe('Updated Name');
      expect(data.suffix).toBe('UN');
    } finally {
      await api.delete(`/reference.php?resource=exchanges&id=${exId}`);
    }
  });

  it('PUT on non-existent exchange returns 404', async () => {
    const resp = await api.put(
      '/reference.php?resource=exchanges&id=999999',
      { json: { name: 'Ghost' } },
    );
    expect(resp.status).toBe(404);
  });

  it('PUT with empty body returns 400', async () => {
    // Use a seeded exchange
    const getResp = await api.get('/reference.php', {
      params: { resource: 'exchanges' },
    });
    const exchanges = await extractData(getResp);
    const ex = exchanges[0];
    const resp = await api.put(
      `/reference.php?resource=exchanges&id=${ex.id}`,
      { json: {} },
    );
    expect(resp.status).toBe(400);
  });

  it('DELETE removes a created exchange', async () => {
    const createResp = await api.post('/reference.php?resource=exchanges', {
      json: { country_code: 'ZZ', name: 'Delete Me', suffix: 'DM' },
    });
    expect(createResp.status).toBe(201);
    const created = await extractData(createResp);
    const exId = created.id;
    const resp = await api.delete(
      `/reference.php?resource=exchanges&id=${exId}`,
    );
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data.deleted).toBe(true);
  });

  it('DELETE on non-existent exchange returns 404', async () => {
    const resp = await api.delete(
      '/reference.php?resource=exchanges&id=999999',
    );
    expect(resp.status).toBe(404);
  });
});
