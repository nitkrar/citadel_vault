import { describe, it, expect } from 'vitest';
import {
  fuzzyMatchField, autoMapColumns, detectEntryType,
  matchSheetToType, parseCsv, generateCsvTemplate,
} from '../../src/client/lib/importUtils.js';

// ── Test fixtures ────────────────────────────────────────────────────

const PASSWORD_FIELDS = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'url', label: 'URL', type: 'url', required: false },
  { key: 'username', label: 'Username', type: 'text', required: false },
  { key: 'password', label: 'Password', type: 'secret', required: false },
  { key: 'notes', label: 'Notes', type: 'textarea', required: false },
];

const ACCOUNT_FIELDS = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'institution', label: 'Institution', type: 'text', required: false },
  { key: 'account_number', label: 'Account Number', type: 'text', required: false },
  { key: 'sort_code', label: 'Sort Code', type: 'text', required: false },
  { key: 'balance', label: 'Balance', type: 'number', required: false },
  { key: 'currency', label: 'Currency', type: 'text', required: false },
];

// ── fuzzyMatchField ──────────────────────────────────────────────────

describe('fuzzyMatchField', () => {
  it('exact match on key', () => {
    expect(fuzzyMatchField('title', PASSWORD_FIELDS)).toBe('title');
  });

  it('exact match on label (case-insensitive)', () => {
    expect(fuzzyMatchField('Username', PASSWORD_FIELDS)).toBe('username');
  });

  it('matches via alias', () => {
    expect(fuzzyMatchField('website', PASSWORD_FIELDS)).toBe('url');
    expect(fuzzyMatchField('login', PASSWORD_FIELDS)).toBe('username');
    expect(fuzzyMatchField('pwd', PASSWORD_FIELDS)).toBe('password');
  });

  it('matches via substring', () => {
    expect(fuzzyMatchField('Site URL', PASSWORD_FIELDS)).toBe('url');
  });

  it('returns null for no match', () => {
    expect(fuzzyMatchField('foobar', PASSWORD_FIELDS)).toBeNull();
  });

  it('returns null for empty header', () => {
    expect(fuzzyMatchField('', PASSWORD_FIELDS)).toBeNull();
    expect(fuzzyMatchField(null, PASSWORD_FIELDS)).toBeNull();
  });

  it('returns null for empty fields', () => {
    expect(fuzzyMatchField('title', [])).toBeNull();
  });
});

// ── autoMapColumns ───────────────────────────────────────────────────

describe('autoMapColumns', () => {
  it('maps matching headers to field keys', () => {
    const mapping = autoMapColumns(['Title', 'URL', 'Username', 'Password'], PASSWORD_FIELDS);
    expect(mapping).toEqual({ 0: 'title', 1: 'url', 2: 'username', 3: 'password' });
  });

  it('skips unmatched headers', () => {
    const mapping = autoMapColumns(['Title', 'Random Column', 'Notes'], PASSWORD_FIELDS);
    expect(mapping[0]).toBe('title');
    expect(mapping[1]).toBeUndefined();
    expect(mapping[2]).toBe('notes');
  });

  it('prevents duplicate field assignment', () => {
    // Both headers would match 'title' — second should be skipped
    const mapping = autoMapColumns(['Title', 'Name', 'URL'], PASSWORD_FIELDS);
    expect(Object.values(mapping).filter(v => v === 'title').length).toBe(1);
  });

  it('handles empty headers', () => {
    expect(autoMapColumns([], PASSWORD_FIELDS)).toEqual({});
  });
});

// ── detectEntryType ──────────────────────────────────────────────────

describe('detectEntryType', () => {
  const templates = [
    { id: 1, template_key: 'password', fields: JSON.stringify(PASSWORD_FIELDS) },
    { id: 2, template_key: 'account', fields: JSON.stringify(ACCOUNT_FIELDS) },
  ];

  it('detects password type from password-like headers', () => {
    const result = detectEntryType(['Title', 'URL', 'Username', 'Password'], templates);
    expect(result.type).toBe('password');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects account type from account-like headers', () => {
    const result = detectEntryType(['Title', 'Bank', 'Account Number', 'Sort Code', 'Balance'], templates);
    expect(result.type).toBe('account');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns default for empty headers', () => {
    const result = detectEntryType([], templates);
    expect(result.type).toBe('password');
    expect(result.confidence).toBe(0);
  });

  it('returns default for empty templates', () => {
    const result = detectEntryType(['Title'], []);
    expect(result.type).toBe('password');
    expect(result.confidence).toBe(0);
  });
});

// ── matchSheetToType ─────────────────────────────────────────────────

describe('matchSheetToType', () => {
  it.each([
    ['Passwords', 'password'], ['passwords', 'password'], ['Logins', 'password'],
    ['Accounts', 'account'], ['Bank Accounts', 'account'],
    ['Assets', 'asset'], ['Investments', 'asset'],
    ['Licenses', 'license'], ['Software', 'license'],
    ['Insurance', 'insurance'], ['Policies', 'insurance'],
    ['Custom', 'custom'], ['Other', 'custom'],
  ])('matchSheetToType(%j) → %s', (sheet, type) => {
    expect(matchSheetToType(sheet)).toBe(type);
  });

  it('returns null for unknown sheet name', () => {
    expect(matchSheetToType('Random Sheet')).toBeNull();
  });
});

// ── parseCsv ─────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    const result = parseCsv('Name,URL\nFoo,https://foo.com\nBar,https://bar.com');
    expect(result.headers).toEqual(['Name', 'URL']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['Foo', 'https://foo.com']);
  });

  it('handles quoted fields with commas', () => {
    const result = parseCsv('Name,Notes\nFoo,"Has, commas"');
    expect(result.rows[0][1]).toBe('Has, commas');
  });

  it('skips empty rows', () => {
    const result = parseCsv('Name\nFoo\n\n   \nBar');
    expect(result.rows).toHaveLength(2);
  });

  it('throws for single-line input', () => {
    expect(() => parseCsv('Just headers')).toThrow('at least a header row and one data row');
  });
});

// ── generateCsvTemplate ──────────────────────────────────────────────

describe('generateCsvTemplate', () => {
  it('generates header row from fields', () => {
    const csv = generateCsvTemplate(PASSWORD_FIELDS);
    expect(csv).toBe('Title,URL,Username,Password,Notes\n');
  });

  it('handles empty fields', () => {
    expect(generateCsvTemplate([])).toBe('\n');
  });
});
