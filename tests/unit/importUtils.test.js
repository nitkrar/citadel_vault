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

  it('handles Windows \\r\\n line endings', () => {
    const result = parseCsv('Name,URL\r\nFoo,https://foo.com\r\nBar,https://bar.com\r\n');
    expect(result.headers).toEqual(['Name', 'URL']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['Foo', 'https://foo.com']);
    expect(result.rows[1]).toEqual(['Bar', 'https://bar.com']);
  });

  it('handles multiline quoted cells', () => {
    const result = parseCsv('Name,Notes\nFoo,"Line 1\nLine 2\nLine 3"');
    expect(result.headers).toEqual(['Name', 'Notes']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0][0]).toBe('Foo');
    expect(result.rows[0][1]).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles escaped quotes "" within fields', () => {
    const result = parseCsv('Name,Notes\nFoo,"He said ""hello"" to me"');
    expect(result.rows[0][1]).toBe('He said "hello" to me');
  });

  it('handles empty fields and trailing commas', () => {
    const result = parseCsv('A,B,C\n1,,3\n,,\n4,5,');
    expect(result.headers).toEqual(['A', 'B', 'C']);
    // Row ",,\n" is all empty — should be filtered
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['1', '', '3']);
    expect(result.rows[1]).toEqual(['4', '5', '']);
  });

  it('handles multiline + escaped quotes + Windows line endings together', () => {
    const csv = 'Name,Notes\r\nFoo,"Line 1\r\nHe said ""hi""\r\nLine 3"\r\n';
    const result = parseCsv(csv);
    expect(result.rows[0][1]).toBe('Line 1\nHe said "hi"\nLine 3');
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

  it('quotes labels containing commas', () => {
    const fields = [
      { key: 'a', label: 'Simple' },
      { key: 'b', label: 'Has, Comma' },
      { key: 'c', label: 'Normal' },
    ];
    expect(generateCsvTemplate(fields)).toBe('Simple,"Has, Comma",Normal\n');
  });

  it('escapes labels containing double quotes', () => {
    const fields = [
      { key: 'a', label: 'Say "Hello"' },
    ];
    expect(generateCsvTemplate(fields)).toBe('"Say ""Hello"""\n');
  });
});

// ── parseCsv edge cases ─────────────────────────────────────────────────

describe('parseCsv edge cases', () => {
  it('handles quoted fields containing newlines', () => {
    // RFC 4180: newlines within quoted fields should not split the row
    const csv = 'title,notes\n"My Entry","Line 1\nLine 2\nLine 3"\n"Second","Simple"';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['title', 'notes']);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe('My Entry');
    expect(rows[0][1]).toBe('Line 1\nLine 2\nLine 3');
    expect(rows[1][0]).toBe('Second');
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'name,address\n"Smith, John","123 Main St, Apt 4"';
    const { headers, rows } = parseCsv(csv);
    expect(rows[0][0]).toBe('Smith, John');
    expect(rows[0][1]).toBe('123 Main St, Apt 4');
  });

  it('handles escaped quotes within quoted fields', () => {
    const csv = 'title,notes\n"He said ""hello""","OK"';
    const { headers, rows } = parseCsv(csv);
    expect(rows[0][0]).toBe('He said "hello"');
  });
});

// ── generateCsvTemplate edge cases ──────────────────────────────────────

describe('generateCsvTemplate edge cases', () => {
  it('properly quotes labels containing commas', () => {
    const fields = [
      { key: 'name', label: 'Full Name, First Last', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' },
    ];
    const csv = generateCsvTemplate(fields);
    const firstLine = csv.split('\n')[0];
    // Label with comma should be quoted
    expect(firstLine).toContain('"Full Name, First Last"');
    expect(firstLine).toContain('Amount');
  });

  it('properly quotes labels containing quotes', () => {
    const fields = [
      { key: 'desc', label: 'Description "short"', type: 'text' },
    ];
    const csv = generateCsvTemplate(fields);
    // Quotes inside should be escaped as ""
    expect(csv).toContain('"Description ""short"""');
  });
});
