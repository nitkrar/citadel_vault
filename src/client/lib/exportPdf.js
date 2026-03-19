/**
 * PDF exporter for Citadel Vault.
 * Produces a structured A4 report using jsPDF.
 * Supports three detail levels: summary, masked, full.
 */

import { cleanEntry, TYPE_LABELS } from './exportHelpers';

const MARGIN_LEFT = 15;
const LINE_HEIGHT_BODY = 6;
const LINE_HEIGHT_HEADER = 10;
const PAGE_BOTTOM = 270;
const PAGE_TOP = 20;

// Internal fields that are never printed as entry fields.
const SKIP_FIELDS = new Set(['row_id', 'linked_account_id']);

/**
 * Parse template fields — may be a JSON string or already an array.
 * Returns [] on failure.
 */
function parseFields(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Find the system template (no owner_id) for a given type.
 */
function findTemplate(templates, type) {
  return templates.find(t => t.template_key === type && !t.owner_id) ?? null;
}

/**
 * Render a single entry's fields at the current Y position.
 * Shows ALL fields from the entry, using template definitions for labels and masking hints.
 * Returns the updated Y position.
 */
function renderEntryFields(doc, entry, templateFields, detailLevel, y) {
  const clean = cleanEntry(entry);

  // Build a map from template fields for labels and type info
  const fieldMeta = {};
  for (const f of templateFields) {
    const key = f.key ?? f.name;
    if (key) fieldMeta[key] = f;
  }

  // Show all fields from the actual entry data (not just template-defined)
  for (const [key, rawValue] of Object.entries(clean)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (key === 'title' || key === 'name') continue; // already shown as entry title
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    // Skip internal/Plaid fields
    if (key.startsWith('_')) continue;

    const meta = fieldMeta[key];
    let displayValue = String(rawValue);

    // In masked mode, hide secret fields
    if (detailLevel === 'masked' && meta?.type === 'secret') {
      displayValue = '********';
    }

    const label = meta?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    y = checkPageBreak(doc, y, LINE_HEIGHT_BODY);
    doc.text(`   ${label}: ${displayValue}`, MARGIN_LEFT, y);
    y += LINE_HEIGHT_BODY;
  }

  return y;
}

/**
 * Add a new page if we're too close to the bottom. Returns updated Y.
 */
function checkPageBreak(doc, y, neededHeight = LINE_HEIGHT_BODY) {
  if (y + neededHeight > PAGE_BOTTOM) {
    doc.addPage();
    return PAGE_TOP;
  }
  return y;
}

/**
 * Print a section header line. Returns updated Y.
 */
function renderSectionHeader(doc, text, y) {
  y = checkPageBreak(doc, y, LINE_HEIGHT_HEADER);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(text, MARGIN_LEFT, y);
  y += LINE_HEIGHT_HEADER;
  return y;
}

/**
 * Print an entry title line ("N. {title}"). Returns updated Y.
 */
function renderEntryTitle(doc, rowId, title, y) {
  y = checkPageBreak(doc, y, LINE_HEIGHT_BODY + 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`${rowId}. ${title ?? '(untitled)'}`, MARGIN_LEFT, y);
  y += LINE_HEIGHT_BODY + 2;
  return y;
}

/**
 * Switch to normal body text style.
 */
function setBodyStyle(doc) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
}

/**
 * Render the Accounts & Assets combined section.
 * Accounts are listed first; their linked assets are indented beneath them.
 * Unlinked assets follow after all accounts.
 */
function renderAccountsAndAssets(doc, accounts, assets, templates, detailLevel, y) {
  const accountCount = accounts.length;
  const assetCount = assets.length;

  const header = `== Accounts & Assets (${accountCount} account${accountCount !== 1 ? 's' : ''}, ${assetCount} asset${assetCount !== 1 ? 's' : ''}) ==`;
  y = renderSectionHeader(doc, header, y);

  const accountTemplate = findTemplate(templates, 'account');
  const accountFields = accountTemplate ? parseFields(accountTemplate.fields) : [];

  const assetTemplate = findTemplate(templates, 'asset');
  const assetFields = assetTemplate ? parseFields(assetTemplate.fields) : [];

  const linkedAssetIds = new Set();

  for (const account of accounts) {
    const clean = cleanEntry(account);
    const title = clean.title ?? clean.name ?? '(untitled)';

    y = renderEntryTitle(doc, account.row_id, title, y);

    if (detailLevel !== 'summary') {
      setBodyStyle(doc);
      y = renderEntryFields(doc, account, accountFields, detailLevel, y);
    }

    // Find assets linked to this account
    const linkedAssets = assets.filter(
      a => String(a.linked_account_id) === String(account.row_id)
    );

    for (const asset of linkedAssets) {
      linkedAssetIds.add(asset.row_id);
      const assetClean = cleanEntry(asset);
      const assetTitle = assetClean.title ?? assetClean.name ?? '(untitled)';

      y = checkPageBreak(doc, y, LINE_HEIGHT_BODY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(80, 80, 80);

      if (detailLevel === 'summary') {
        doc.text(`   |-- ${assetTitle}`, MARGIN_LEFT, y);
        y += LINE_HEIGHT_BODY;
      } else {
        doc.text(`   |-- ${assetTitle}`, MARGIN_LEFT, y);
        y += LINE_HEIGHT_BODY;
        setBodyStyle(doc);
        y = renderEntryFields(doc, asset, assetFields, detailLevel, y);
      }
    }

    // Blank line between accounts
    y += 2;
  }

  // Unlinked assets
  const unlinkedAssets = assets.filter(a => !linkedAssetIds.has(a.row_id));

  if (unlinkedAssets.length > 0) {
    y = checkPageBreak(doc, y, LINE_HEIGHT_BODY + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text('Unlinked Assets:', MARGIN_LEFT, y);
    y += LINE_HEIGHT_BODY + 2;

    for (const asset of unlinkedAssets) {
      const assetClean = cleanEntry(asset);
      const assetTitle = assetClean.title ?? assetClean.name ?? '(untitled)';

      y = checkPageBreak(doc, y, LINE_HEIGHT_BODY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(60, 60, 60);

      if (detailLevel === 'summary') {
        doc.text(`   ${asset.row_id}. ${assetTitle}`, MARGIN_LEFT, y);
        y += LINE_HEIGHT_BODY;
      } else {
        y = renderEntryTitle(doc, asset.row_id, assetTitle, y);
        setBodyStyle(doc);
        y = renderEntryFields(doc, asset, assetFields, detailLevel, y);
      }
    }
  }

  return y;
}

/**
 * Render a standard section (password, license, insurance, custom).
 * Returns updated Y.
 */
function renderStandardSection(doc, type, entries, templates, detailLevel, y) {
  if (entries.length === 0) return y;

  const label = TYPE_LABELS[type] ?? type;
  const header = `== ${label} (${entries.length}) ==`;
  y = renderSectionHeader(doc, header, y);

  const template = findTemplate(templates, type);
  const fields = template ? parseFields(template.fields) : [];

  for (const entry of entries) {
    const clean = cleanEntry(entry);
    const title = clean.title ?? clean.name ?? '(untitled)';

    y = renderEntryTitle(doc, entry.row_id, title, y);

    if (detailLevel !== 'summary') {
      setBodyStyle(doc);
      y = renderEntryFields(doc, entry, fields, detailLevel, y);
    }

    // Small gap between entries
    y += 2;
  }

  return y;
}

/**
 * Export vault data to a PDF file and trigger browser download.
 *
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {Object[]} templates - Template objects from IndexedDB
 * @param {'summary'|'masked'|'full'} detailLevel
 * @param {string} dateSuffix - e.g. "2026-03-19"
 */
export async function exportPdf(grouped, templates, detailLevel, dateSuffix) {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = PAGE_TOP;

  // --- Title ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text(`CITADEL VAULT EXPORT — ${dateSuffix}`, MARGIN_LEFT, y);
  y += 10;

  // --- Subtitle ---
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(`Detail level: ${detailLevel}`, MARGIN_LEFT, y);
  y += 8;

  // --- Warning for full detail ---
  if (detailLevel === 'full') {
    y = checkPageBreak(doc, y, LINE_HEIGHT_BODY + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(180, 0, 0);
    doc.text('WARNING: This document contains unmasked sensitive data.', MARGIN_LEFT, y);
    y += 8;
  }

  // Spacer before content
  y += 4;

  // --- Accounts & Assets (combined section) ---
  const accounts = grouped.account ?? [];
  const assets = grouped.asset ?? [];

  if (accounts.length > 0 || assets.length > 0) {
    y = renderAccountsAndAssets(doc, accounts, assets, templates, detailLevel, y);
    y += 4;
  }

  // --- Standard sections (in order, skipping account + asset) ---
  const STANDARD_TYPES = ['password', 'license', 'insurance', 'custom'];

  for (const type of STANDARD_TYPES) {
    const entries = grouped[type] ?? [];
    if (entries.length === 0) continue;

    y = renderStandardSection(doc, type, entries, templates, detailLevel, y);
    y += 4;
  }

  // --- Save ---
  const filename = `citadel-export-${dateSuffix}.pdf`;
  doc.save(filename);
}
