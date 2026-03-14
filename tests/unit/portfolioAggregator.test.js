/**
 * Portfolio Aggregator Tests
 *
 * Tests pure aggregation functions: currency conversion, value extraction,
 * rate map building, snapshot recalculation, and full portfolio aggregation.
 */
import { describe, it, expect } from 'vitest';
import {
  extractValue, buildRateMap, convertCurrency, buildSymbolMap,
  recalculateSnapshot, aggregatePortfolio,
} from '../../src/client/lib/portfolioAggregator.js';

// ── Test data ───────────────────────────────────────────────────────────

const CURRENCIES = [
  { code: 'GBP', symbol: '£', exchange_rate_to_base: '1.00000000' },
  { code: 'USD', symbol: '$', exchange_rate_to_base: '0.79000000' },
  { code: 'INR', symbol: '₹', exchange_rate_to_base: '0.00950000' },
  { code: 'EUR', symbol: '€', exchange_rate_to_base: '0.86000000' },
];

const RATE_MAP = { GBP: 1.0, USD: 0.79, INR: 0.0095, EUR: 0.86 };

// ── buildRateMap ────────────────────────────────────────────────────────

describe('buildRateMap', () => {
  it('builds a map from currencies array', () => {
    const map = buildRateMap(CURRENCIES);
    expect(map.GBP).toBe(1.0);
    expect(map.USD).toBe(0.79);
    expect(map.INR).toBe(0.0095);
  });

  it('handles empty array', () => {
    expect(buildRateMap([])).toEqual({});
  });

  it('defaults to 0 for missing/invalid rates', () => {
    const map = buildRateMap([{ code: 'XYZ', exchange_rate_to_base: null }]);
    expect(map.XYZ).toBe(0);
  });
});

// ── buildSymbolMap ──────────────────────────────────────────────────────

describe('buildSymbolMap', () => {
  it('builds symbol lookup', () => {
    const map = buildSymbolMap(CURRENCIES);
    expect(map.GBP).toBe('£');
    expect(map.USD).toBe('$');
  });

  it('falls back to code when symbol is missing', () => {
    const map = buildSymbolMap([{ code: 'BTC', symbol: '' }]);
    expect(map.BTC).toBe('BTC');
  });
});

// ── convertCurrency ─────────────────────────────────────────────────────

describe('convertCurrency', () => {
  it('returns same amount for same currency', () => {
    expect(convertCurrency(100, 'USD', 'USD', RATE_MAP)).toBe(100);
  });

  it('converts USD to GBP', () => {
    // 100 USD * 0.79 / 1.0 = 79 GBP
    expect(convertCurrency(100, 'USD', 'GBP', RATE_MAP)).toBeCloseTo(79, 2);
  });

  it('converts GBP to USD', () => {
    // 100 GBP * 1.0 / 0.79 = 126.58 USD
    expect(convertCurrency(100, 'GBP', 'USD', RATE_MAP)).toBeCloseTo(126.58, 1);
  });

  it('triangulates INR to USD via base', () => {
    // 10000 INR * 0.0095 / 0.79 = 120.253 USD
    expect(convertCurrency(10000, 'INR', 'USD', RATE_MAP)).toBeCloseTo(120.253, 1);
  });

  it('returns amount as-is when from rate is missing', () => {
    expect(convertCurrency(100, 'UNKNOWN', 'GBP', RATE_MAP)).toBe(100);
  });

  it('returns amount as-is when to rate is missing', () => {
    expect(convertCurrency(100, 'GBP', 'UNKNOWN', RATE_MAP)).toBe(100);
  });

  it('returns amount when fromCode is null', () => {
    expect(convertCurrency(100, null, 'GBP', RATE_MAP)).toBe(100);
  });

  it('handles negative amounts', () => {
    expect(convertCurrency(-100, 'USD', 'GBP', RATE_MAP)).toBeCloseTo(-79, 2);
  });

  it('handles zero', () => {
    expect(convertCurrency(0, 'USD', 'GBP', RATE_MAP)).toBe(0);
  });
});

// ── extractValue ────────────────────────────────────────────────────────

describe('extractValue', () => {
  it('uses portfolio_role: value field', () => {
    const data = { current_value: '5000' };
    const fields = [{ key: 'current_value', portfolio_role: 'value' }];
    expect(extractValue(data, fields)).toBe(5000);
  });

  it('computes quantity × price', () => {
    const data = { shares: '10', price_per_unit: '150' };
    const fields = [
      { key: 'shares', portfolio_role: 'quantity' },
      { key: 'price_per_unit', portfolio_role: 'price' },
    ];
    expect(extractValue(data, fields)).toBe(1500);
  });

  it('falls back to value/current_value/face_value keys', () => {
    expect(extractValue({ value: '3000' }, [])).toBe(3000);
    expect(extractValue({ current_value: '4000' }, [])).toBe(4000);
    expect(extractValue({ face_value: '5000' }, [])).toBe(5000);
  });

  it('returns 0 for missing/invalid data', () => {
    expect(extractValue(null, [])).toBe(0);
    expect(extractValue({}, null)).toBe(0);
    expect(extractValue({ value: 'not-a-number' }, [])).toBe(0);
  });

  it('returns 0 when no matching fields exist', () => {
    expect(extractValue({ random_field: '100' }, [])).toBe(0);
  });
});

// ── recalculateSnapshot ─────────────────────────────────────────────────

describe('recalculateSnapshot', () => {
  const snapshotEntries = [
    { name: 'Stocks', template_name: 'Stocks', subtype: 'stocks', is_liability: false, currency: 'USD', raw_value: 5000, icon: 'trending-up' },
    { name: 'Real Estate', template_name: 'Property', subtype: 'property', is_liability: false, currency: 'GBP', raw_value: 300000, icon: 'home' },
    { name: 'Credit Card', template_name: 'Credit Card', subtype: 'credit_card', is_liability: true, currency: 'GBP', raw_value: -2000, icon: 'credit-card' },
  ];

  it('calculates totals in display currency', () => {
    const result = recalculateSnapshot(snapshotEntries, RATE_MAP, 'GBP');

    // Stocks: 5000 USD * 0.79 = 3950 GBP
    // Real Estate: 300000 GBP
    // Credit Card: -2000 GBP (liability, abs = 2000)
    expect(result.total_assets).toBeCloseTo(303950, 0);
    expect(result.total_liabilities).toBeCloseTo(2000, 0);
    expect(result.net_worth).toBeCloseTo(301950, 0);
    expect(result.asset_count).toBe(3);
  });

  it('groups by type', () => {
    const result = recalculateSnapshot(snapshotEntries, RATE_MAP, 'GBP');
    expect(result.by_type.stocks).toBeDefined();
    expect(result.by_type.stocks.count).toBe(1);
    expect(result.by_type.property).toBeDefined();
    expect(result.by_type.credit_card).toBeDefined();
  });

  it('groups by currency', () => {
    const result = recalculateSnapshot(snapshotEntries, RATE_MAP, 'GBP');
    expect(result.by_currency.USD).toBeDefined();
    expect(result.by_currency.USD.count).toBe(1);
    expect(result.by_currency.GBP).toBeDefined();
    expect(result.by_currency.GBP.count).toBe(2);
  });

  it('recalculates with different display currency', () => {
    const inGBP = recalculateSnapshot(snapshotEntries, RATE_MAP, 'GBP');
    const inUSD = recalculateSnapshot(snapshotEntries, RATE_MAP, 'USD');

    // USD totals should be higher than GBP (since GBP is worth more)
    expect(inUSD.net_worth).toBeGreaterThan(inGBP.net_worth);
  });

  it('handles empty entries', () => {
    const result = recalculateSnapshot([], RATE_MAP, 'GBP');
    expect(result.total_assets).toBe(0);
    expect(result.total_liabilities).toBe(0);
    expect(result.net_worth).toBe(0);
    expect(result.asset_count).toBe(0);
  });

  it('skips entries with undefined raw_value', () => {
    const entries = [
      { name: 'No Value', currency: 'GBP' },
      { name: 'Has Value', currency: 'GBP', raw_value: 100, is_liability: false },
    ];
    const result = recalculateSnapshot(entries, RATE_MAP, 'GBP');
    expect(result.asset_count).toBe(1);
  });

  it('recalculates correctly with snapshot-time rates vs current rates', () => {
    const snapshotRates = { GBP: 1.0, USD: 0.70 }; // USD was weaker
    const currentRates = { GBP: 1.0, USD: 0.79 }; // USD stronger now

    const entry = [{ name: 'US Stock', currency: 'USD', raw_value: 10000, is_liability: false }];

    const atSnapshot = recalculateSnapshot(entry, snapshotRates, 'GBP');
    const atCurrent = recalculateSnapshot(entry, currentRates, 'GBP');

    // At snapshot rates: 10000 * 0.70 = 7000 GBP
    // At current rates: 10000 * 0.79 = 7900 GBP
    expect(atSnapshot.net_worth).toBeCloseTo(7000, 0);
    expect(atCurrent.net_worth).toBeCloseTo(7900, 0);
  });
});

// ── aggregatePortfolio ──────────────────────────────────────────────────

describe('aggregatePortfolio', () => {
  const entries = [
    {
      id: 1, entry_type: 'asset',
      decrypted: { title: 'AAPL', currency: 'USD', country: 'US' },
      template: { name: 'Stocks', icon: 'trending-up', subtype: 'stocks', is_liability: false, fields: [{ key: 'value', portfolio_role: 'value' }] },
    },
    {
      id: 2, entry_type: 'asset',
      decrypted: { title: 'House', currency: 'GBP', current_value: '300000', country: 'UK' },
      template: { name: 'Property', icon: 'home', subtype: 'property', is_liability: false, fields: [{ key: 'current_value', portfolio_role: 'value' }] },
    },
    {
      id: 3, entry_type: 'asset',
      decrypted: { title: 'Credit Card', currency: 'GBP', value: '2000', country: 'UK' },
      template: { name: 'Credit Card', icon: 'credit-card', subtype: 'credit_card', is_liability: true, fields: [{ key: 'value', portfolio_role: 'value' }] },
    },
    {
      id: 10, entry_type: 'account',
      decrypted: { title: 'HSBC Current', institution: 'HSBC', currency: 'GBP' },
      template: { name: 'Bank Account', icon: 'bank', subtype: 'bank', is_liability: false, fields: [] },
    },
  ];

  // Set AAPL value
  entries[0].decrypted.value = '5000';

  it('produces summary with correct totals', () => {
    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    expect(result.summary.asset_count).toBe(3); // accounts excluded
    expect(result.summary.total_liabilities).toBeGreaterThan(0);
    expect(result.summary.net_worth).toBe(result.summary.total_assets - result.summary.total_liabilities);
  });

  it('excludes account entries from aggregation', () => {
    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    const accountAssets = result.assets.filter(a => a.entry_type === 'account');
    expect(accountAssets.length).toBe(0);
  });

  it('groups by country', () => {
    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    expect(result.by_country.US).toBeDefined();
    expect(result.by_country.UK).toBeDefined();
  });

  it('groups by type', () => {
    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    expect(result.by_type.stocks).toBeDefined();
    expect(result.by_type.property).toBeDefined();
    expect(result.by_type.credit_card).toBeDefined();
  });

  it('marks liability types correctly', () => {
    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    expect(result.by_type.credit_card.has_liability).toBe(true);
    expect(result.by_type.stocks.has_liability).toBe(false);
  });

  it('builds accounts map from account entries', () => {
    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    expect(result.accounts[10]).toBeDefined();
    expect(result.accounts[10].name).toBe('HSBC Current');
  });

  it('handles empty entries', () => {
    const result = aggregatePortfolio([], CURRENCIES, 'GBP', 'GBP');
    expect(result.summary.asset_count).toBe(0);
    expect(result.summary.net_worth).toBe(0);
    expect(result.assets.length).toBe(0);
  });

  it('converts values when display currency differs from entry currency', () => {
    const inGBP = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'GBP');
    const inUSD = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'USD');

    // Same assets, different display → different totals
    expect(inGBP.summary.net_worth).not.toBeCloseTo(inUSD.summary.net_worth, 0);
  });
});
