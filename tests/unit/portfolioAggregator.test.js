/**
 * Portfolio Aggregator Tests
 *
 * Tests pure aggregation functions: currency conversion, value extraction,
 * rate map building, snapshot recalculation, and full portfolio aggregation.
 */
import { describe, it, expect } from 'vitest';
import {
  extractValue, buildRateMap, convertCurrency, buildSymbolMap,
  recalculateSnapshot, aggregatePortfolio, extractGainLoss,
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

  it('defaults to 0 for NaN and non-numeric exchange rates', () => {
    const map = buildRateMap([
      { code: 'A', exchange_rate_to_base: 'not-a-number' },
      { code: 'B', exchange_rate_to_base: undefined },
      { code: 'C', exchange_rate_to_base: '' },
    ]);
    expect(map.A).toBe(0);
    expect(map.B).toBe(0);
    expect(map.C).toBe(0);
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

  it('returns amount unchanged when toRate is 0 (no divide-by-zero)', () => {
    const rateMap = { USD: 0.79, BAD: 0 };
    expect(convertCurrency(100, 'USD', 'BAD', rateMap)).toBe(100);
  });

  it('returns amount unchanged when fromRate is 0', () => {
    const rateMap = { BAD: 0, GBP: 1.0 };
    expect(convertCurrency(100, 'BAD', 'GBP', rateMap)).toBe(100);
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

// ── extractGainLoss ─────────────────────────────────────────────────────

const STOCK_FIELDS = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'shares', label: 'Shares', type: 'number', portfolio_role: 'quantity' },
  { key: 'price_per_share', label: 'Price', type: 'number', portfolio_role: 'price' },
  { key: 'cost_price', label: 'Cost Price', type: 'number' },
];

describe('extractGainLoss', () => {
  it('returns gain when current price > cost price', () => {
    const data = { shares: '10', price_per_share: '150', cost_price: '100' };
    const result = extractGainLoss(data, STOCK_FIELDS);
    expect(result).not.toBeNull();
    expect(result.gainLoss).toBe(500); // (150-100) * 10
    expect(result.gainLossPercent).toBeCloseTo(50, 1);
  });

  it('returns loss when current price < cost price', () => {
    const data = { shares: '5', price_per_share: '80', cost_price: '100' };
    const result = extractGainLoss(data, STOCK_FIELDS);
    expect(result.gainLoss).toBe(-100); // (80-100) * 5
    expect(result.gainLossPercent).toBeCloseTo(-20, 1);
  });

  it('returns null when cost_price is missing', () => {
    const data = { shares: '10', price_per_share: '150' };
    expect(extractGainLoss(data, STOCK_FIELDS)).toBeNull();
  });

  it('returns null when cost_price is zero', () => {
    const data = { shares: '10', price_per_share: '150', cost_price: '0' };
    expect(extractGainLoss(data, STOCK_FIELDS)).toBeNull();
  });

  it('returns null when current price is missing', () => {
    const data = { shares: '10', cost_price: '100' };
    expect(extractGainLoss(data, STOCK_FIELDS)).toBeNull();
  });

  it('returns null for null/undefined inputs', () => {
    expect(extractGainLoss(null, STOCK_FIELDS)).toBeNull();
    expect(extractGainLoss({}, null)).toBeNull();
  });

  it('handles zero gain (breakeven)', () => {
    const data = { shares: '10', price_per_share: '100', cost_price: '100' };
    const result = extractGainLoss(data, STOCK_FIELDS);
    expect(result.gainLoss).toBe(0);
    expect(result.gainLossPercent).toBe(0);
  });

  it('handles fractional shares (crypto)', () => {
    const cryptoFields = [
      { key: 'quantity', label: 'Quantity', type: 'number', portfolio_role: 'quantity' },
      { key: 'price_per_unit', label: 'Price', type: 'number', portfolio_role: 'price' },
      { key: 'cost_price', label: 'Cost Price', type: 'number' },
    ];
    const data = { quantity: '0.5', price_per_unit: '60000', cost_price: '40000' };
    const result = extractGainLoss(data, cryptoFields);
    expect(result.gainLoss).toBe(10000); // (60000-40000) * 0.5
    expect(result.gainLossPercent).toBeCloseTo(50, 1);
  });
});

// ── aggregatePortfolio with gain/loss ────────────────────────────────────

describe('aggregatePortfolio gain/loss integration', () => {
  it('includes gainLoss on assets with cost_price', () => {
    const entries = [{
      id: 1,
      entry_type: 'asset',
      decrypted: {
        title: 'Apple Stock',
        shares: '10',
        price_per_share: '200',
        cost_price: '150',
        currency: 'USD',
      },
      template: {
        name: 'Stock', icon: 'trending-up', key: 'asset', subtype: 'stock',
        is_liability: false,
        fields: STOCK_FIELDS,
      },
    }];

    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'USD');
    const asset = result.assets[0];
    expect(asset.gainLoss).toBe(500); // (200-150) * 10
    expect(asset.gainLossPercent).toBeCloseTo(33.33, 0);
  });

  it('includes total_gain_loss in summary', () => {
    const entries = [{
      id: 1,
      entry_type: 'asset',
      decrypted: {
        title: 'Stock A',
        shares: '10',
        price_per_share: '200',
        cost_price: '150',
        currency: 'USD',
      },
      template: {
        name: 'Stock', icon: 'trending-up', key: 'asset', subtype: 'stock',
        is_liability: false, fields: STOCK_FIELDS,
      },
    }];

    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'USD');
    expect(result.summary.total_gain_loss).toBeDefined();
    expect(typeof result.summary.total_gain_loss).toBe('number');
  });

  it('does not include gainLoss when cost_price is absent', () => {
    const entries = [{
      id: 1,
      entry_type: 'asset',
      decrypted: {
        title: 'Apple Stock',
        shares: '10',
        price_per_share: '200',
        currency: 'USD',
      },
      template: {
        name: 'Stock', icon: 'trending-up', key: 'asset', subtype: 'stock',
        is_liability: false, fields: STOCK_FIELDS,
      },
    }];

    const result = aggregatePortfolio(entries, CURRENCIES, 'GBP', 'USD');
    expect(result.assets[0].gainLoss).toBeUndefined();
  });
});

// ── recalculateSnapshot edge cases ──────────────────────────────────────

describe('recalculateSnapshot edge cases', () => {
  it('NaN raw_value does not poison totals', () => {
    const entries = [
      { name: 'Good', raw_value: 1000, currency: 'GBP', is_liability: false },
      { name: 'Bad', raw_value: NaN, currency: 'GBP', is_liability: false },
      { name: 'Also Good', raw_value: 2000, currency: 'GBP', is_liability: false },
    ];
    const result = recalculateSnapshot(entries, { GBP: 1.0 }, 'GBP');
    // NaN should not make total_assets NaN
    expect(Number.isNaN(result.total_assets)).toBe(false);
  });

  it('null entry in array is skipped', () => {
    const entries = [
      null,
      { name: 'Valid', raw_value: 500, currency: 'GBP', is_liability: false },
    ];
    const result = recalculateSnapshot(entries, { GBP: 1.0 }, 'GBP');
    expect(result.total_assets).toBe(500);
  });

  it('entry with raw_value undefined is skipped', () => {
    const entries = [
      { name: 'No Value', currency: 'GBP' },
      { name: 'Has Value', raw_value: 100, currency: 'GBP', is_liability: false },
    ];
    const result = recalculateSnapshot(entries, { GBP: 1.0 }, 'GBP');
    expect(result.total_assets).toBe(100);
  });
});
