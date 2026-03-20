/**
 * PDF exporter for Citadel Vault.
 * Produces a structured A4 report using jsPDF.
 * Two modes: overview (compact one-liners) and full (all fields expanded).
 */

import { cleanEntry, TYPE_LABELS } from './exportHelpers';

const MARGIN_LEFT = 15;
const INDENT = 20;
const LINE_HEIGHT = 6;
const HEADER_HEIGHT = 10;
const PAGE_BOTTOM = 270;
const PAGE_TOP = 20;

// Fields never printed as entry detail lines
const SKIP_FIELDS = new Set(['row_id', 'linked_account_id', 'title', 'name', 'currency', 'value', 'current_value', 'face_value', 'integrations']);

// Currency symbols
const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', INR: '₹', CAD: 'C$', AUD: 'A$' };

function currencySymbol(code) {
  return CURRENCY_SYMBOLS[code?.toUpperCase()] || (code ? code + ' ' : '');
}

function parseFields(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

function findTemplate(templates, type) {
  return templates.find(t => t.template_key === type && !t.owner_id) ?? null;
}

function checkPageBreak(doc, y, needed = LINE_HEIGHT) {
  if (y + needed > PAGE_BOTTOM) { doc.addPage(); return PAGE_TOP; }
  return y;
}

/**
 * Format a value with its currency symbol.
 * e.g. formatValue(12000, 'GBP') → '£12,000'
 */
function formatValue(val, currency) {
  if (val === undefined || val === null || val === '') return '';
  const num = Number(val);
  const sym = currencySymbol(currency);
  if (!isNaN(num)) {
    return `${sym}${num.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return `${sym}${val}`;
}

/**
 * Get the primary value from a cleaned entry (value, current_value, or face_value).
 */
function getPrimaryValue(clean) {
  return clean.value ?? clean.current_value ?? clean.face_value ?? null;
}

/**
 * Build a compact one-liner for overview mode.
 * Accounts: "HSBC Current (savings) - GBP"
 * Assets: "ISA Cash (cash) - £12,000"
 * Passwords: "Gmail Login"
 * Licenses: "JetBrains IDE - expires 2027-01-15"
 * Insurance: "Home Insurance - Aviva - expires 2027-06-01"
 */
function buildOneLiner(clean, type) {
  const title = clean.title ?? clean.name ?? '(untitled)';
  const subtype = clean.subtype;
  const titlePart = subtype ? `${title} (${subtype})` : title;

  if (type === 'account') {
    const currency = clean.currency || '';
    return currency ? `${titlePart} - ${currency}` : titlePart;
  }
  if (type === 'asset') {
    const val = getPrimaryValue(clean);
    return val ? `${titlePart} - ${formatValue(val, clean.currency)}` : titlePart;
  }
  if (type === 'license') {
    const exp = clean.expiry_date;
    return exp ? `${titlePart} - expires ${exp}` : titlePart;
  }
  if (type === 'insurance') {
    const provider = clean.provider || '';
    const exp = clean.expiry_date || clean.maturity_date || '';
    const parts = [titlePart, provider, exp ? `expires ${exp}` : ''].filter(Boolean);
    return parts.join(' - ');
  }
  return titlePart;
}

/**
 * Render expanded fields for full mode. Skips fields already shown inline (title, value, currency).
 */
function renderExpandedFields(doc, entry, templateFields, x, y) {
  const clean = cleanEntry(entry);
  const fieldMeta = {};
  for (const f of templateFields) {
    const key = f.key ?? f.name;
    if (key) fieldMeta[key] = f;
  }

  for (const [key, rawValue] of Object.entries(clean)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (key.startsWith('_')) continue;
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    const meta = fieldMeta[key];
    const label = meta?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    y = checkPageBreak(doc, y, LINE_HEIGHT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`${label}: ${rawValue}`, x, y);
    y += LINE_HEIGHT;
  }
  return y;
}

// ── Section renderers ────────────────────────────────────────────────────

function renderAccountsAndAssets(doc, accounts, assets, templates, mode, y) {
  const header = `== Accounts & Assets (${accounts.length} account${accounts.length !== 1 ? 's' : ''}, ${assets.length} asset${assets.length !== 1 ? 's' : ''}) ==`;
  y = checkPageBreak(doc, y, HEADER_HEIGHT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(header, MARGIN_LEFT, y);
  y += HEADER_HEIGHT;

  const accountFields = parseFields(findTemplate(templates, 'account')?.fields);
  const assetFields = parseFields(findTemplate(templates, 'asset')?.fields);
  const linkedAssetIds = new Set();

  for (const account of accounts) {
    const clean = cleanEntry(account);
    const oneLiner = buildOneLiner(clean, 'account');

    y = checkPageBreak(doc, y, LINE_HEIGHT + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`${account.row_id}. ${oneLiner}`, MARGIN_LEFT, y);
    y += LINE_HEIGHT + 2;

    // Full mode: expanded account fields
    if (mode === 'full') {
      y = renderExpandedFields(doc, account, accountFields, INDENT, y);
    }

    // Linked assets
    const linked = assets.filter(a => String(a.linked_account_id) === String(account.row_id));
    for (const asset of linked) {
      linkedAssetIds.add(asset.row_id);
      const assetClean = cleanEntry(asset);
      const val = getPrimaryValue(assetClean);
      const assetTitle = assetClean.title ?? assetClean.name ?? '(untitled)';
      const valuePart = val ? ` - ${formatValue(val, assetClean.currency)}` : '';

      y = checkPageBreak(doc, y, LINE_HEIGHT);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(80, 80, 80);
      doc.text(`   |-- ${assetTitle}${valuePart}`, MARGIN_LEFT, y);
      y += LINE_HEIGHT;

      // Full mode: expanded asset fields
      if (mode === 'full') {
        y = renderExpandedFields(doc, asset, assetFields, INDENT + 10, y);
      }
    }

    y += 2;
  }

  // Unlinked assets
  const unlinked = assets.filter(a => !linkedAssetIds.has(a.row_id));
  if (unlinked.length > 0) {
    y = checkPageBreak(doc, y, LINE_HEIGHT + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text('Unlinked Assets:', MARGIN_LEFT, y);
    y += LINE_HEIGHT + 2;

    for (const asset of unlinked) {
      const assetClean = cleanEntry(asset);
      const oneLiner = buildOneLiner(assetClean, 'asset');

      y = checkPageBreak(doc, y, LINE_HEIGHT);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);
      doc.text(`   ${asset.row_id}. ${oneLiner}`, MARGIN_LEFT, y);
      y += LINE_HEIGHT;

      if (mode === 'full') {
        y = renderExpandedFields(doc, asset, assetFields, INDENT + 5, y);
      }
    }
  }

  return y;
}

function renderStandardSection(doc, type, entries, templates, mode, y) {
  if (entries.length === 0) return y;

  const label = TYPE_LABELS[type] ?? type;
  y = checkPageBreak(doc, y, HEADER_HEIGHT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(`== ${label} (${entries.length}) ==`, MARGIN_LEFT, y);
  y += HEADER_HEIGHT;

  const fields = parseFields(findTemplate(templates, type)?.fields);

  for (const entry of entries) {
    const clean = cleanEntry(entry);
    const oneLiner = buildOneLiner(clean, type);

    y = checkPageBreak(doc, y, LINE_HEIGHT + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`${entry.row_id}. ${oneLiner}`, MARGIN_LEFT, y);
    y += LINE_HEIGHT + 2;

    if (mode === 'full') {
      y = renderExpandedFields(doc, entry, fields, INDENT, y);
    }

    y += 2;
  }

  return y;
}

// ── Main export ──────────────────────────────────────────────────────────

/**
 * Export vault data to PDF.
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {Object[]} templates - Template objects from IndexedDB
 * @param {'overview'|'full'} mode
 * @param {string} dateSuffix - e.g. "2026-03-19"
 */
export async function exportPdf(grouped, templates, mode, dateSuffix) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = PAGE_TOP;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text(`CITADEL VAULT EXPORT — ${dateSuffix}`, MARGIN_LEFT, y);
  y += 10;

  // Mode label
  const modeLabel = mode === 'full' ? 'Full Detail' : 'Overview';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(modeLabel, MARGIN_LEFT, y);
  y += 8;

  // Warning for full mode
  if (mode === 'full') {
    y = checkPageBreak(doc, y, LINE_HEIGHT + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(180, 0, 0);
    doc.text('WARNING: This document contains unmasked sensitive data.', MARGIN_LEFT, y);
    y += 8;
  }

  y += 4;

  // Accounts & Assets
  const accounts = grouped.account ?? [];
  const assets = grouped.asset ?? [];
  if (accounts.length > 0 || assets.length > 0) {
    y = renderAccountsAndAssets(doc, accounts, assets, templates, mode, y);
    y += 4;
  }

  // Standard sections
  for (const type of ['password', 'license', 'insurance', 'custom']) {
    const entries = grouped[type] ?? [];
    if (entries.length === 0) continue;
    y = renderStandardSection(doc, type, entries, templates, mode, y);
    y += 4;
  }

  doc.save(`citadel-export-${dateSuffix}.pdf`);
}
