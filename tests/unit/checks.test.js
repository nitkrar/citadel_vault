import { describe, it, expect } from 'vitest';
import {
  isTruthy, isFalsy, hasValue, valueOr, toNumber, isPositiveNumber,
  toStr, isNonEmptyString, toArray, isNonEmptyArray, apiData,
  dbBool, MASKED, fmtCurrency, daysUntil, fmtDate, pluralize,
} from '../../src/client/lib/checks.js';

describe('isTruthy', () => {
  it.each([
    [true, true], [1, true], ['true', true], ['1', true], ['yes', true],
    ['TRUE', true], ['Yes', true], [' true ', true],
    [false, false], [0, false], ['false', false], ['0', false], ['no', false],
    [null, false], [undefined, false], ['', false], [2, false], ['2', false],
    [[], false], [{}, false],
  ])('isTruthy(%j) → %s', (input, expected) => {
    expect(isTruthy(input)).toBe(expected);
  });
});

describe('isFalsy', () => {
  it('is inverse of isTruthy', () => {
    expect(isFalsy(true)).toBe(false);
    expect(isFalsy(false)).toBe(true);
    expect(isFalsy(null)).toBe(true);
    expect(isFalsy('yes')).toBe(false);
  });
});

describe('hasValue', () => {
  it.each([
    [null, false], [undefined, false], ['', false], [0, false], [false, false],
    [NaN, false], [[], false], [{}, false],
    ['hello', true], [1, true], [true, true], [[1], true], [{ a: 1 }, true],
  ])('hasValue(%j) → %s', (input, expected) => {
    expect(hasValue(input)).toBe(expected);
  });
});

describe('valueOr', () => {
  it('returns value when it has a value', () => {
    expect(valueOr('hello', 'fallback')).toBe('hello');
  });
  it('returns fallback when value is empty', () => {
    expect(valueOr(null, 'fallback')).toBe('fallback');
    expect(valueOr('', 'fallback')).toBe('fallback');
    expect(valueOr(0, 'fallback')).toBe('fallback');
  });
});

describe('toNumber', () => {
  it.each([
    [null, null], [undefined, null], ['', null], ['abc', null],
    ['42', 42], [42, 42], ['3.14', 3.14], [0, 0], ['0', 0],
  ])('toNumber(%j) → %j', (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });
});

describe('isPositiveNumber', () => {
  it.each([
    [1, true], ['5', true], [0.01, true],
    [0, false], [-1, false], [null, false], ['abc', false], [Infinity, false],
  ])('isPositiveNumber(%j) → %s', (input, expected) => {
    expect(isPositiveNumber(input)).toBe(expected);
  });
});

describe('toStr', () => {
  it('trims strings', () => expect(toStr('  hello  ')).toBe('hello'));
  it('returns empty for null', () => expect(toStr(null)).toBe(''));
  it('returns empty for undefined', () => expect(toStr(undefined)).toBe(''));
  it('converts numbers', () => expect(toStr(42)).toBe('42'));
});

describe('isNonEmptyString', () => {
  it('true for real strings', () => expect(isNonEmptyString('hi')).toBe(true));
  it('false for empty string', () => expect(isNonEmptyString('')).toBe(false));
  it('false for whitespace', () => expect(isNonEmptyString('   ')).toBe(false));
  it('false for non-strings', () => expect(isNonEmptyString(42)).toBe(false));
});

describe('toArray', () => {
  it('returns array as-is', () => expect(toArray([1, 2])).toEqual([1, 2]));
  it('returns [] for null', () => expect(toArray(null)).toEqual([]));
  it('returns [] for string', () => expect(toArray('hello')).toEqual([]));
});

describe('isNonEmptyArray', () => {
  it('true for non-empty', () => expect(isNonEmptyArray([1])).toBe(true));
  it('false for empty', () => expect(isNonEmptyArray([])).toBe(false));
  it('false for non-array', () => expect(isNonEmptyArray('hi')).toBe(false));
});

describe('apiData', () => {
  it('unwraps resp.data.data', () => {
    expect(apiData({ data: { data: [1, 2] } })).toEqual([1, 2]);
  });
  it('falls back to resp.data', () => {
    expect(apiData({ data: 'raw' })).toBe('raw');
  });
  it('returns fallback for null response', () => {
    expect(apiData(null, 'default')).toBe('default');
  });
  it('returns fallback when data.data is null', () => {
    expect(apiData({ data: { data: null } }, 'default')).toBe('default');
  });
});

describe('dbBool', () => {
  it('is aliased to isTruthy', () => {
    expect(dbBool).toBe(isTruthy);
  });
});

describe('fmtCurrency', () => {
  it('formats valid number with symbol', () => {
    const result = fmtCurrency(1234.5, '£');
    expect(result).toContain('£');
    // Locale-dependent formatting — just check it has digits
    expect(result).toMatch(/£[\d,]+\.50/);
  });
  it('returns -- for invalid', () => expect(fmtCurrency('abc')).toBe('--'));
  it('returns masked when masked=true', () => expect(fmtCurrency(100, '', true)).toBe(MASKED));
});

describe('daysUntil', () => {
  it('returns null for empty', () => expect(daysUntil(null)).toBeNull());
  it('returns positive for future date', () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    expect(daysUntil(future)).toBeGreaterThanOrEqual(4);
  });
  it('returns negative for past date', () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(daysUntil(past)).toBeLessThan(0);
  });
});

describe('fmtDate', () => {
  it('returns -- for null', () => expect(fmtDate(null)).toBe('--'));
  it('formats a real date', () => {
    const result = fmtDate('2026-01-15');
    expect(result).not.toBe('--');
  });
});

describe('pluralize', () => {
  it('singular for 1', () => expect(pluralize(1, 'item')).toBe('item'));
  it('auto-plural for 0', () => expect(pluralize(0, 'item')).toBe('items'));
  it('auto-plural for 2', () => expect(pluralize(2, 'item')).toBe('items'));
  it('custom plural', () => expect(pluralize(2, 'person', 'people')).toBe('people'));
});
