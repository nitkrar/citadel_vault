/**
 * Shared export helpers — row ID assignment, linkage remapping, type grouping.
 * Used by all format-specific exporters (JSON, CSV, XLSX, PDF).
 */

import { VALID_ENTRY_TYPES } from './defaults';

const TYPE_LABELS = {
  password: 'Passwords', account: 'Accounts', asset: 'Assets',
  license: 'Licenses', insurance: 'Insurance', custom: 'Custom',
};

/**
 * Group decrypted entries by entry_type.
 * Each entry must have { _dbId, _entryType, ...decryptedFields }.
 * Returns { password: [...], account: [...], ... }
 */
export function groupByType(entries) {
  const grouped = {};
  for (const type of VALID_ENTRY_TYPES) {
    grouped[type] = [];
  }
  for (const entry of entries) {
    const type = entry._entryType;
    if (grouped[type]) {
      grouped[type].push(entry);
    }
  }
  return grouped;
}

/**
 * Assign per-type sequential row IDs (1-based) and remap linked_account_id.
 * Mutates entries in-place. Returns the grouped object for chaining.
 *
 * @param {Object} grouped - Output of groupByType()
 * @returns {Object} Same grouped object with row_id assigned and linkage remapped
 */
export function assignRowIdsAndRemap(grouped) {
  // Build DB ID → row_id map for accounts
  const dbIdToAccountRowId = {};

  // Assign per-type row IDs
  for (const type of VALID_ENTRY_TYPES) {
    const entries = grouped[type] || [];
    entries.forEach((entry, i) => {
      entry.row_id = i + 1;
      if (type === 'account') {
        dbIdToAccountRowId[entry._dbId] = entry.row_id;
      }
    });
  }

  // Remap linked_account_id on assets
  for (const asset of (grouped.asset || [])) {
    if (asset.linked_account_id) {
      const mapped = dbIdToAccountRowId[asset.linked_account_id];
      asset.linked_account_id = mapped || asset.linked_account_id;
    }
  }

  return grouped;
}

/**
 * Strip internal fields (_dbId, _entryType) from an entry for export.
 * Returns a clean copy.
 */
export function cleanEntry(entry) {
  const clean = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === '_dbId' || k === '_entryType') continue;
    if (k === '_plaid' || k.startsWith('_plaid')) continue; // Legacy integration data
    if (k === 'integrations') continue; // Provider integration data
    if (v === undefined || v === null || v === '') continue;
    clean[k] = v;
  }
  return clean;
}

/**
 * Quote a value for CSV output (RFC 4180).
 */
export function quoteCsvValue(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build CSV string from an array of objects.
 * @param {Object[]} items - Array of cleaned entry objects
 * @param {string[]} [keyOrder] - Optional column order. If omitted, auto-detected.
 * @returns {string} CSV content
 */
export function buildCsv(items, keyOrder) {
  if (items.length === 0) return '';
  const allKeys = new Set();
  items.forEach(d => Object.keys(d).forEach(k => allKeys.add(k)));
  const keys = keyOrder || ['row_id', ...Array.from(allKeys).filter(k => k !== 'row_id').sort()];
  const header = keys.map(k => quoteCsvValue(k)).join(',');
  const rows = items.map(d =>
    keys.map(k => quoteCsvValue(d[k] ?? '')).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Trigger a file download in the browser.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Template helpers ───────────────────────────────────────────────────

export function parseFields(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

export function findTemplate(templates, type, subtype) {
  if (subtype) {
    const specific = templates?.find(t => t.template_key === type && !t.owner_id && t.subtype === subtype);
    if (specific) return specific;
  }
  return templates?.find(t => t.template_key === type && !t.owner_id && !t.subtype && !t.country_code) ?? null;
}

export function getTemplateFields(templates, type, subtype) {
  return parseFields(findTemplate(templates, type, subtype)?.fields);
}

// ── Field visibility filtering ─────────────────────────────────────────

/** Fields with type 'secret' — passwords, API keys, recovery keys, PINs */
const isSecretField = (meta) => meta?.type === 'secret';

/** Monetary value fields — balances, prices, valuations */
const MONETARY_KEYS = new Set([
  'balance', 'value', 'current_value', 'face_value', 'purchase_price',
  'price_per_share', 'price_per_unit', 'premium_amount', 'coverage_amount',
  'cash_value', 'credit_limit', 'cost_price',
]);
const isMonetaryField = (key, meta) =>
  MONETARY_KEYS.has(key) ||
  (meta?.type === 'number' && (meta?.portfolio_role === 'value' || meta?.portfolio_role === 'price'));

/** Rate & quantity fields */
const RATE_KEYS = new Set([
  'interest_rate', 'employer_match', 'coupon_rate', 'shares', 'quantity',
]);
const isRateField = (key) => RATE_KEYS.has(key);

/**
 * Strip fields from a cleaned entry based on visibility toggles.
 * Returns a new object (does not mutate input).
 *
 * @param {Object} entry - Cleaned entry (output of cleanEntry)
 * @param {Object[]} templateFields - Parsed template field definitions
 * @param {{ secrets?: boolean, monetary?: boolean, rates?: boolean }} visibility
 * @returns {Object} Filtered entry
 */
export function applyFieldVisibility(entry, templateFields, visibility) {
  if (!visibility) return entry;

  const meta = {};
  for (const f of (templateFields || [])) {
    const k = f.key ?? f.name;
    if (k) meta[k] = f;
  }

  const filtered = {};
  for (const [k, v] of Object.entries(entry)) {
    const m = meta[k];
    if (visibility.secrets === false && isSecretField(m)) continue;
    if (visibility.monetary === false && isMonetaryField(k, m)) continue;
    if (visibility.rates === false && isRateField(k)) continue;
    filtered[k] = v;
  }
  return filtered;
}

/**
 * Prepare export data: clean + filter all entries using subtype-aware templates.
 * Returns a new grouped object — same shape as input but with processed entries.
 *
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {Object[]} templates - Template objects from IndexedDB
 * @param {{ secrets?: boolean, monetary?: boolean, rates?: boolean }} [fieldVisibility]
 * @returns {Object} New grouped object with cleaned+filtered entries
 */
export function prepareExportData(grouped, templates, fieldVisibility) {
  const result = {};
  for (const [type, entries] of Object.entries(grouped)) {
    result[type] = (entries || []).map(entry => {
      const clean = cleanEntry(entry);
      if (!fieldVisibility) return clean;
      const tmplFields = getTemplateFields(templates, type, clean.subtype);
      return applyFieldVisibility(clean, tmplFields, fieldVisibility);
    });
  }
  return result;
}

export { TYPE_LABELS, VALID_ENTRY_TYPES, MONETARY_KEYS, RATE_KEYS, isSecretField, isMonetaryField, isRateField };
