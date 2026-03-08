/**
 * checks.js — Resilient truthiness and data validation utilities.
 * Used across the app to avoid null/undefined/type-coercion bugs.
 *
 * RULE: Only explicit truthy values are truthy. Everything else is falsy.
 * No implicit coercion, no "== 1", no "!== null" games.
 */

// =============================================================================
// Boolean checks
// =============================================================================

/**
 * Returns true ONLY for: boolean true, string "true"/"1"/"yes", number 1.
 * Everything else (null, undefined, false, 0, "", "false", "0", "no") → false.
 */
export function isTruthy(value) {
  if (value === true) return true;
  if (value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  return false;
}

/**
 * Inverse of isTruthy. Returns true when value is definitively false.
 * null/undefined also return true (absence = falsy).
 */
export function isFalsy(value) {
  return !isTruthy(value);
}

// =============================================================================
// Presence checks
// =============================================================================

/**
 * Returns true if value exists and is not empty.
 * false for: null, undefined, "", [], {}, 0, false, NaN.
 */
export function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (value === '') return false;
  if (value === 0 || value === false) return false;
  if (typeof value === 'number' && isNaN(value)) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Returns the value if it has a value (hasValue), otherwise returns fallback.
 */
export function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

// =============================================================================
// Number checks
// =============================================================================

/**
 * Safely parse to number. Returns null if not a valid number.
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

/**
 * Returns true if value is a valid finite number > 0.
 */
export function isPositiveNumber(value) {
  const n = toNumber(value);
  return n !== null && n > 0 && isFinite(n);
}

// =============================================================================
// String checks
// =============================================================================

/**
 * Safely get a trimmed string. Returns '' for null/undefined.
 */
export function toStr(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Returns true if value is a non-empty string after trimming.
 */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// =============================================================================
// Array/Object checks
// =============================================================================

/**
 * Safely get an array. Returns [] for null/undefined/non-arrays.
 */
export function toArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

/**
 * Returns true if value is a non-empty array.
 */
export function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Safely access nested data from API responses.
 * Handles: resp.data.data, resp.data, resp, or fallback.
 */
export function apiData(response, fallback = null) {
  if (!response) return fallback;
  const d = response.data;
  if (d && typeof d === 'object' && 'data' in d) {
    return d.data ?? fallback;
  }
  return d ?? fallback;
}

// =============================================================================
// DB boolean field helpers (MySQL returns 0/1 as strings or ints)
// =============================================================================

/**
 * Convert a DB boolean field (0, 1, "0", "1", true, false) to boolean.
 * Alias for isTruthy — named for clarity at call site.
 */
export const dbBool = isTruthy;

// =============================================================================
// Format helpers
// =============================================================================

/** Masked placeholder for hidden amounts. */
export const MASKED = '\u2022\u2022\u2022\u2022\u2022\u2022';

/**
 * Format a number as currency string. Returns '--' for invalid.
 */
export function fmtCurrency(value, symbol = '', masked = false) {
  if (masked) return MASKED;
  const n = toNumber(value);
  if (n === null) return '--';
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Days until a date. Returns null if no date provided.
 */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / 86400000);
}

/**
 * Format a date string for display. Returns '--' for empty/null.
 */
export function fmtDate(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Pluralize a word based on count.
 */
export function pluralize(count, singular, plural) {
  return count === 1 ? singular : (plural || singular + 's');
}
