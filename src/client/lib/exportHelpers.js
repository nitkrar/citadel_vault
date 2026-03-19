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
    if (k === '_plaid' || k.startsWith('_plaid')) continue; // Strip Plaid integration data
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

export { TYPE_LABELS, VALID_ENTRY_TYPES };
