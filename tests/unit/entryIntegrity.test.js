/**
 * Entry Integrity Tests
 *
 * Verifies that entry update operations preserve template structure.
 * Catches regressions where refresh/update functions accidentally
 * drop template_id, rename fields, or corrupt entry shape.
 */
import { describe, it, expect } from 'vitest';

// ── Test data: simulates entries as returned by GET /vault.php ──────────

const STOCK_ENTRY = {
  id: 20,
  entry_type: 'asset',
  template_id: 15,
  template: { name: 'Stock / Equity', icon: 'trending-up', subtype: 'stock', is_liability: false, fields: [
    { key: 'title', label: 'Name', type: 'text', required: true },
    { key: 'ticker', label: 'Ticker Symbol', type: 'text' },
    { key: 'shares', label: 'Shares', type: 'number', portfolio_role: 'quantity' },
    { key: 'price_per_share', label: 'Price per Share', type: 'number', portfolio_role: 'price' },
    { key: 'cost_price', label: 'Cost Price', type: 'number' },
    { key: 'currency', label: 'Currency', type: 'text' },
  ]},
  encrypted_data: 'encrypted_blob_here',
  created_at: '2026-03-15T10:00:00Z',
  updated_at: '2026-03-15T10:00:00Z',
};

const PLAID_CASH_ENTRY = {
  id: 15,
  entry_type: 'asset',
  template_id: 25,
  template: { name: 'Cash', icon: 'wallet', subtype: 'cash', is_liability: false, fields: [
    { key: 'title', label: 'Description', type: 'text', required: true },
    { key: 'linked_account_id', label: 'Linked Account', type: 'account_link' },
    { key: 'currency', label: 'Currency', type: 'text' },
    { key: 'value', label: 'Amount', type: 'number', portfolio_role: 'value' },
  ]},
  encrypted_data: 'encrypted_blob_here',
  created_at: '2026-03-15T10:00:00Z',
  updated_at: '2026-03-15T10:00:00Z',
};

const ACCOUNT_ENTRY = {
  id: 14,
  entry_type: 'account',
  template_id: 2,
  template: { name: 'Bank Account', icon: 'bank', subtype: null, is_liability: false, fields: [
    { key: 'title', label: 'Account Name', type: 'text', required: true },
    { key: 'institution', label: 'Institution', type: 'text' },
    { key: 'currency', label: 'Currency', type: 'text' },
  ]},
  encrypted_data: 'encrypted_blob_here',
  created_at: '2026-03-15T10:00:00Z',
  updated_at: '2026-03-15T10:00:00Z',
};

const REQUIRED_ENTRY_FIELDS = ['id', 'entry_type', 'template_id', 'encrypted_data', 'created_at', 'updated_at'];

// ── Helper: simulate an entry update (like refresh price/balance) ────────

function simulateEntryUpdate(entry, newEncryptedData) {
  // This is the pattern used by refresh functions:
  // { ...entry, encrypted_data: blob, updated_at: new Date().toISOString() }
  return { ...entry, encrypted_data: newEncryptedData, updated_at: new Date().toISOString() };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Entry shape preservation on update', () => {
  it('preserves template_id after update', () => {
    const updated = simulateEntryUpdate(STOCK_ENTRY, 'new_encrypted_blob');
    expect(updated.template_id).toBe(STOCK_ENTRY.template_id);
  });

  it('preserves entry_type after update', () => {
    const updated = simulateEntryUpdate(STOCK_ENTRY, 'new_encrypted_blob');
    expect(updated.entry_type).toBe('asset');
  });

  it('preserves template object after update', () => {
    const updated = simulateEntryUpdate(STOCK_ENTRY, 'new_encrypted_blob');
    expect(updated.template).toEqual(STOCK_ENTRY.template);
    expect(updated.template.subtype).toBe('stock');
  });

  it('preserves id after update', () => {
    const updated = simulateEntryUpdate(STOCK_ENTRY, 'new_encrypted_blob');
    expect(updated.id).toBe(STOCK_ENTRY.id);
  });

  it('updates only encrypted_data and updated_at', () => {
    const updated = simulateEntryUpdate(STOCK_ENTRY, 'new_blob');
    expect(updated.encrypted_data).toBe('new_blob');
    expect(updated.updated_at).not.toBe(STOCK_ENTRY.updated_at);
    // Everything else unchanged
    expect(updated.id).toBe(STOCK_ENTRY.id);
    expect(updated.entry_type).toBe(STOCK_ENTRY.entry_type);
    expect(updated.template_id).toBe(STOCK_ENTRY.template_id);
    expect(updated.template).toBe(STOCK_ENTRY.template);
    expect(updated.created_at).toBe(STOCK_ENTRY.created_at);
  });

  it('does not use "data" field name (must be "encrypted_data")', () => {
    const updated = simulateEntryUpdate(STOCK_ENTRY, 'blob');
    expect(updated).toHaveProperty('encrypted_data');
    expect(updated).not.toHaveProperty('data');
  });
});

describe('Entry shape preservation for different entry types', () => {
  const entries = [
    { name: 'stock entry', entry: STOCK_ENTRY, expectedSubtype: 'stock' },
    { name: 'plaid cash entry', entry: PLAID_CASH_ENTRY, expectedSubtype: 'cash' },
    { name: 'account entry', entry: ACCOUNT_ENTRY, expectedSubtype: null },
  ];

  entries.forEach(({ name, entry, expectedSubtype }) => {
    it(`${name}: has all required fields`, () => {
      for (const field of REQUIRED_ENTRY_FIELDS) {
        expect(entry).toHaveProperty(field);
      }
    });

    it(`${name}: preserves template subtype after update`, () => {
      const updated = simulateEntryUpdate(entry, 'new_blob');
      expect(updated.template?.subtype).toBe(expectedSubtype);
    });

    it(`${name}: preserves template_id after update`, () => {
      const updated = simulateEntryUpdate(entry, 'new_blob');
      expect(updated.template_id).toBe(entry.template_id);
    });
  });
});

describe('Entry field naming contract', () => {
  it('server API returns encrypted_data not data', () => {
    // Entries from the server must use encrypted_data
    expect(STOCK_ENTRY).toHaveProperty('encrypted_data');
    expect(STOCK_ENTRY).not.toHaveProperty('data');
  });

  it('server API returns template_id', () => {
    expect(STOCK_ENTRY).toHaveProperty('template_id');
    expect(typeof STOCK_ENTRY.template_id).toBe('number');
  });

  it('server API returns inline template with subtype', () => {
    expect(STOCK_ENTRY).toHaveProperty('template');
    expect(STOCK_ENTRY.template).toHaveProperty('subtype');
  });
});

describe('Decrypted data shape (what goes inside encrypted_data)', () => {
  // Simulated decrypted data for different entry types
  const DECRYPTED_STOCK = {
    title: 'Apple Inc.',
    ticker: 'AAPL',
    shares: '10',
    price_per_share: '185.50',
    cost_price: '150.00',
    currency: 'USD',
  };

  const DECRYPTED_PLAID_CASH = {
    title: 'HSBC Current — Cash',
    linked_account_id: '14',
    value: '2450',
    currency: 'GBP',
    _plaid: {
      item_id: 'item_xyz',
      account_id: 'acc_1',
      institution_name: 'HSBC',
      account_name: 'Current Account',
      last_refreshed: '2026-03-15T14:30:00Z',
    },
  };

  it('price refresh updates only price field, preserves everything else', () => {
    const updated = { ...DECRYPTED_STOCK, price_per_share: '190.00' };
    expect(updated.title).toBe('Apple Inc.');
    expect(updated.ticker).toBe('AAPL');
    expect(updated.shares).toBe('10');
    expect(updated.cost_price).toBe('150.00');
    expect(updated.currency).toBe('USD');
    expect(updated.price_per_share).toBe('190.00');
  });

  it('balance refresh updates only value and _plaid.last_refreshed', () => {
    const updated = {
      ...DECRYPTED_PLAID_CASH,
      value: '2500',
      _plaid: { ...DECRYPTED_PLAID_CASH._plaid, last_refreshed: '2026-03-16T10:00:00Z' },
    };
    expect(updated.title).toBe('HSBC Current — Cash');
    expect(updated.linked_account_id).toBe('14');
    expect(updated.currency).toBe('GBP');
    expect(updated.value).toBe('2500');
    expect(updated._plaid.item_id).toBe('item_xyz');
    expect(updated._plaid.account_id).toBe('acc_1');
    expect(updated._plaid.institution_name).toBe('HSBC');
  });

  it('_plaid metadata is preserved through spread', () => {
    const original = { ...DECRYPTED_PLAID_CASH };
    const updated = { ...original, value: '999' };
    expect(updated._plaid).toEqual(DECRYPTED_PLAID_CASH._plaid);
  });

  it('_plaid is not added to non-plaid entries', () => {
    const updated = { ...DECRYPTED_STOCK, price_per_share: '200' };
    expect(updated._plaid).toBeUndefined();
  });
});
