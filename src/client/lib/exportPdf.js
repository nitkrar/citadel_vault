/**
 * PDF exporter for Citadel Vault.
 * Builds styled HTML from the template design, renders in hidden iframe, triggers print.
 * Two modes: overview (compact one-liners) and full (all fields expanded).
 * No jsPDF dependency — uses browser's native Print to PDF.
 */

import { cleanEntry, TYPE_LABELS, isSecretField, isMonetaryField, isRateField } from './exportHelpers';
import { extractValue } from './portfolioAggregator';

// ── Helpers ──────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€', JPY: '¥', INR: '₹', CAD: 'C$', AUD: 'A$' };
const sym = (c) => CURRENCY_SYMBOLS[c?.toUpperCase()] || (c ? c + ' ' : '');

function fmtVal(val, currency) {
  if (val === undefined || val === null || val === '') return '';
  const n = Number(val);
  const s = sym(currency);
  if (!isNaN(n)) return `${s}${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return `${s}${val}`;
}

/** Cached template fields lookup — avoids repeated find+parse per entry */
let _templateFieldsCache = {};
function getEntryValue(entry, templates) {
  const type = entry._entryType || entry.entry_type || entry.template_key;
  const subtype = entry.subtype;
  const cacheKey = subtype ? `${type}:${subtype}` : type;
  if (!_templateFieldsCache[cacheKey]) {
    const tmpl = findTemplate(templates, type, subtype);
    _templateFieldsCache[cacheKey] = tmpl ? parseFields(tmpl.fields) : [];
  }
  const val = extractValue(entry, _templateFieldsCache[cacheKey]);
  return val || null;
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function parseFields(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

function findTemplate(templates, type, subtype) {
  // Prefer subtype-specific template, fall back to generic
  if (subtype) {
    const specific = templates.find(t => t.template_key === type && !t.owner_id && t.subtype === subtype);
    if (specific) return specific;
  }
  return templates.find(t => t.template_key === type && !t.owner_id && !t.subtype && !t.country_code) ?? null;
}

function getTemplateFields(templates, type, subtype) {
  return parseFields(findTemplate(templates, type, subtype)?.fields);
}

/**
 * Compute subtotals by currency from a list of entries.
 * Returns formatted string like "£350,825 GBP · $21,000 USD"
 */
/**
 * Compute totals per currency from asset entries.
 * Returns { byCurrency: { GBP: 350825, USD: 21000 }, subtotalStr: "£350,825 GBP · $21,000 USD" }
 */
function computeSubtotals(entries, templates) {
  const byCurrency = {};
  for (const e of entries) {
    const c = cleanEntry(e);
    const val = Number(getEntryValue(c, templates));
    if (isNaN(val) || !c.currency) continue;
    byCurrency[c.currency] = (byCurrency[c.currency] || 0) + val;
  }
  const subtotalStr = Object.entries(byCurrency)
    .map(([cur, total]) => `${fmtVal(total, cur)} ${cur}`)
    .join(' · ');
  return { byCurrency, subtotalStr };
}

/**
 * Build net worth summary tiles HTML.
 * Shows per-currency native totals + grand total in base currency.
 */
function buildNetWorthTiles(assets, rateMap, baseCurrency, templates) {
  const { byCurrency } = computeSubtotals(assets, templates);
  if (Object.keys(byCurrency).length === 0) return '';

  const baseRate = (cur) => rateMap?.[cur] || (cur === baseCurrency ? 1 : 0);

  // Compute grand total in base currency
  let grandTotal = 0;
  const assetCount = assets.length;
  const fxParts = [];

  let tilesHtml = '';
  for (const [cur, total] of Object.entries(byCurrency)) {
    const rate = baseRate(cur);
    const converted = rate > 0 ? total * rate : 0;
    grandTotal += converted;

    if (cur === baseCurrency) {
      tilesHtml += `<div class="nw-tile">
        <span class="nw-tile__currency">${esc(cur)}</span>
        <span class="nw-tile__amount">${esc(fmtVal(total, cur))}</span>
        <span class="nw-tile__converted">base currency</span>
      </div>`;
    } else {
      tilesHtml += `<div class="nw-tile">
        <span class="nw-tile__currency">${esc(cur)}</span>
        <span class="nw-tile__amount">${esc(fmtVal(total, cur))}</span>
        <span class="nw-tile__converted">&asymp; ${esc(fmtVal(converted, baseCurrency))}</span>
      </div>`;
      if (rate > 0) fxParts.push(`1 ${cur} = ${sym(baseCurrency)}${rate.toFixed(4)}`);
    }
  }

  // Grand total tile
  const currencyCount = Object.keys(byCurrency).length;
  tilesHtml += `<div class="nw-tile nw-tile--total">
    <span class="nw-tile__label">Net Worth</span>
    <span class="nw-tile__currency">Total in ${esc(baseCurrency)}</span>
    <span class="nw-tile__amount">${esc(fmtVal(grandTotal, baseCurrency))}</span>
    <span class="nw-tile__converted">${currencyCount} currenc${currencyCount !== 1 ? 'ies' : 'y'} &middot; ${assetCount} asset${assetCount !== 1 ? 's' : ''}</span>
  </div>`;

  const footnote = fxParts.length > 0
    ? `<div class="net-worth__footnote">FX rates at time of export &nbsp;&middot;&nbsp; ${fxParts.join(' &nbsp;&middot;&nbsp; ')} &nbsp;&middot;&nbsp; Values are indicative only</div>`
    : '';

  return `<div class="net-worth"><div class="net-worth__tiles">${tilesHtml}</div>${footnote}</div>`;
}

// Fields always excluded from detail field grids (shown via dedicated UI elements)
const SKIP_KEYS = new Set(['row_id', 'linked_account_id', 'title', 'name', 'currency', 'value', 'current_value', 'face_value', 'integrations', 'subtype']);

function getExtraFields(clean, templateFields, { fieldVisibility } = {}) {
  const meta = {};
  for (const f of templateFields) { const k = f.key ?? f.name; if (k) meta[k] = f; }
  const fv = fieldVisibility || {};

  const fields = [];
  for (const [k, v] of Object.entries(clean)) {
    if (SKIP_KEYS.has(k) || k.startsWith('_') || v === undefined || v === null || v === '') continue;
    const m = meta[k];
    const isSecret = isSecretField(m);
    const isCurrency = isMonetaryField(k, m);
    if (fv.secrets === false && isSecret) continue;
    if (fv.monetary === false && (isCurrency || isMonetaryField(k, m))) continue;
    if (fv.rates === false && isRateField(k)) continue;
    const label = m?.label ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    fields.push({ label, value: String(v), isSecret, isCurrency, currency: clean.currency });
  }
  return fields;
}

// ── CSS (from template) ──────────────────────────────────────────────────

function getCSS() {
  return `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --bg-primary:#fff; --bg-secondary:#f8f9fa; --bg-tertiary:#f1f3f5; --text-primary:#1a1a2e; --text-muted:#6b7280; --text-faint:#9ca3af; --border-color:#e5e7eb; --border-strong:#d1d5db; --color-primary:#2563eb; --color-success:#16a34a; --color-danger:#dc2626; --color-warning:#f59e0b; --tree-line:#cbd5e1; }
html, body { background:var(--bg-primary); color:var(--text-primary); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:13px; line-height:1.5; }
.page { width:210mm; min-height:297mm; margin:0 auto; padding:15mm; }
@media print { .page { margin:0; padding:15mm; width:210mm; } body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
.page-break { page-break-after:always; break-after:page; height:0; }
.net-worth { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px; padding:14px 16px; margin-bottom:14px; break-inside:avoid; }
.net-worth__tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; }
.nw-tile { background:var(--bg-primary); border:1px solid var(--border-color); border-radius:6px; padding:10px 12px; display:flex; flex-direction:column; gap:2px; }
.nw-tile--total { background:var(--text-primary); color:#fff; border-color:var(--text-primary); }
.nw-tile--total .nw-tile__currency { color:rgba(255,255,255,0.7); }
.nw-tile--total .nw-tile__converted { color:rgba(255,255,255,0.6); }
.nw-tile__label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; opacity:0.7; }
.nw-tile__currency { font-size:11px; font-weight:600; color:var(--text-muted); }
.nw-tile__amount { font-size:18px; font-weight:700; color:var(--color-success); }
.nw-tile--total .nw-tile__amount { color:#fff; }
.nw-tile__converted { font-size:11px; color:var(--text-faint); }
.net-worth__footnote { margin-top:10px; font-size:11px; color:var(--text-faint); border-top:1px solid var(--border-color); padding-top:8px; }
.doc-header { border-bottom:2px solid var(--border-color); padding-bottom:12px; margin-bottom:14px; }
.doc-header__row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.doc-header__title { font-size:20px; font-weight:700; letter-spacing:0.05em; }
.doc-header__meta { font-size:12px; color:var(--text-muted); margin-top:3px; }
.badge { display:inline-block; padding:3px 11px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:0.04em; white-space:nowrap; flex-shrink:0; margin-top:3px; }
.warning-banner { margin-top:10px; background:#fef2f2; border:1px solid #fecaca; color:var(--color-danger); padding:7px 12px; border-radius:6px; font-size:12px; font-weight:600; }
.section { background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px; padding:14px 16px; margin-bottom:12px; break-inside:avoid; }
.section__header { display:flex; align-items:center; gap:8px; padding-bottom:10px; margin-bottom:12px; border-bottom:1px solid var(--border-color); }
.section__title { font-size:14px; font-weight:700; letter-spacing:0.03em; text-transform:uppercase; }
.count-badge { display:inline-block; background:var(--color-primary); color:#fff; font-size:10px; font-weight:600; padding:1px 8px; border-radius:999px; }
.section__subtotal { margin-left:auto; font-size:12px; font-weight:700; color:var(--color-success); white-space:nowrap; }
.account-block { margin-bottom:10px; break-inside:avoid; }
.account-block:last-child { margin-bottom:0; }
.account-row { display:flex; align-items:baseline; gap:6px; font-size:13px; font-weight:700; }
.account-row__num { color:var(--text-faint); min-width:18px; }
.account-row__name { color:var(--text-primary); }
.account-row__meta { color:var(--text-muted); font-weight:400; font-size:12px; }
.tree { margin-top:2px; margin-left:22px; position:relative; }
.tree::before { content:''; position:absolute; left:0; top:0; bottom:10px; width:1px; background:var(--tree-line); }
.tree__item { position:relative; padding:3px 0 3px 18px; display:flex; align-items:baseline; gap:6px; font-size:12.5px; }
.tree__item::before { content:''; position:absolute; left:0; top:50%; width:14px; height:1px; background:var(--tree-line); }
.tree__item::after { content:''; position:absolute; left:12px; top:50%; transform:translateY(-50%); width:5px; height:5px; border-radius:50%; background:var(--tree-line); }
.tree__name { color:var(--text-primary); font-weight:600; }
.tree__type { color:var(--text-muted); font-size:11.5px; }
.tree__value { margin-left:auto; color:var(--color-success); font-weight:600; white-space:nowrap; }
.tree__empty { padding:3px 0 3px 18px; font-size:12px; color:var(--text-faint); font-style:italic; position:relative; }
.tree__empty::before { content:''; position:absolute; left:0; top:50%; width:14px; height:1px; background:var(--tree-line); }
.unlinked-divider { border:none; border-top:1px dashed var(--border-color); margin:10px 0; }
.unlinked-label { font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.07em; margin-bottom:6px; }
.unlinked-list { list-style:none; }
.unlinked-list__item { display:flex; align-items:baseline; gap:6px; padding:2px 0; font-size:12.5px; }
.unlinked-list__num { color:var(--text-faint); min-width:18px; }
.unlinked-list__name { color:var(--text-primary); font-weight:600; }
.unlinked-list__type { color:var(--text-muted); font-size:11.5px; }
.unlinked-list__val { margin-left:auto; color:var(--color-success); font-weight:600; white-space:nowrap; }
.acct-card { background:var(--bg-primary); border:1px solid var(--border-strong); border-left:3px solid var(--color-primary); border-radius:6px; margin-bottom:10px; overflow:hidden; break-inside:avoid; }
.acct-card:last-child { margin-bottom:0; }
.acct-card__head { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--bg-tertiary); border-bottom:1px solid var(--border-color); }
.acct-card__name { font-size:13px; font-weight:700; }
.acct-card__num { color:var(--text-faint); margin-right:5px; }
.acct-card__tags { display:flex; gap:5px; }
.tag { display:inline-block; padding:1px 7px; border-radius:4px; font-size:10.5px; font-weight:600; background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-muted); }
.field-grid { display:grid; grid-template-columns:130px 1fr; gap:0; padding:8px 12px; }
.field-grid__label { color:var(--text-muted); font-size:12px; padding:3px 8px 3px 0; border-bottom:1px solid var(--bg-tertiary); }
.field-grid__value { color:var(--text-primary); font-size:12.5px; padding:3px 0; border-bottom:1px solid var(--bg-tertiary); }
.field-grid__label:nth-last-child(2), .field-grid__value:last-child { border-bottom:none; }
.mono { font-family:'Courier New',Courier,monospace; font-size:11.5px; }
.val-currency { color:var(--color-success); font-weight:600; }
.assets-panel { border-top:1px solid var(--border-color); background:var(--bg-secondary); }
.assets-panel__label { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--text-muted); padding:5px 12px 4px; border-bottom:1px solid var(--border-color); }
.asset-row { display:grid; grid-template-columns:1fr auto; align-items:start; padding:7px 12px; border-bottom:1px solid var(--border-color); gap:12px; }
.asset-row:last-child { border-bottom:none; }
.asset-row__name { font-size:12.5px; font-weight:700; }
.asset-row__type { display:inline-block; font-size:10.5px; font-weight:600; color:var(--text-muted); background:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:3px; padding:0 5px; margin-left:5px; }
.asset-chips { display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:4px; }
.chip { font-size:11.5px; color:var(--text-muted); }
.chip__label { margin-right:2px; }
.chip__value { color:var(--text-primary); }
.chip__value--mono { font-family:'Courier New',Courier,monospace; font-size:11px; }
.chip__value--currency { color:var(--color-success); font-weight:600; }
.asset-row__value { font-size:13px; font-weight:700; color:var(--color-success); white-space:nowrap; text-align:right; }
.unlinked-panel { border-top:1px dashed var(--border-color); margin-top:10px; padding-top:10px; }
.entry-card { display:grid; grid-template-columns:160px 1fr; border:1px solid var(--border-strong); border-radius:6px; overflow:hidden; margin-bottom:8px; break-inside:avoid; }
.entry-card:last-child { margin-bottom:0; }
.entry-card__id { background:var(--bg-tertiary); border-right:1px solid var(--border-color); padding:10px 12px; display:flex; flex-direction:column; justify-content:center; gap:4px; }
.entry-card__num { font-size:11px; color:var(--text-faint); }
.entry-card__name { font-size:13px; font-weight:700; line-height:1.3; }
.entry-card__tag { display:inline-block; font-size:10px; font-weight:600; color:var(--color-primary); background:#eff6ff; border:1px solid #bfdbfe; border-radius:3px; padding:0 5px; margin-top:2px; width:fit-content; }
.entry-card__fields { background:var(--bg-primary); padding:8px 12px; display:grid; grid-template-columns:110px 1fr; gap:0; align-content:center; }
.entry-card__label { color:var(--text-muted); font-size:11.5px; padding:3px 6px 3px 0; border-bottom:1px solid var(--bg-tertiary); }
.entry-card__value { color:var(--text-primary); font-size:12px; padding:3px 0; border-bottom:1px solid var(--bg-tertiary); }
.entry-card__label:nth-last-child(2), .entry-card__value:last-child { border-bottom:none; }`;
}

// ── HTML builders ────────────────────────────────────────────────────────

function buildHeader(dateSuffix, fieldVisibility) {
  const fv = fieldVisibility || {};
  const warning = fv.secrets !== false
    ? `<div class="warning-banner">&#9888;&#xFE0E;&nbsp; Contains unmasked sensitive data — keep this document secure</div>`
    : '';
  return `<div class="doc-header">
    <div class="doc-header__row">
      <div>
        <div class="doc-header__title">CITADEL VAULT EXPORT</div>
        <div class="doc-header__meta">Exported on ${esc(dateSuffix)}</div>
      </div>
    </div>${warning}
  </div>`;
}

function buildFieldGrid(fields) {
  return fields.map(f => {
    const valClass = f.isSecret ? 'mono' : (f.isCurrency ? 'val-currency' : '');
    return `<span class="field-grid__label">${esc(f.label)}</span><span class="field-grid__value ${valClass}">${esc(f.value)}</span>`;
  }).join('');
}

function buildFullAccountsAssets(accounts, assets, templates, { fieldVisibility } = {}) {
  if (accounts.length === 0 && assets.length === 0) return '';
  const fv = fieldVisibility || {};

  const linkedIds = new Set();
  let cardsHtml = '';

  for (const acct of accounts) {
    const c = cleanEntry(acct);
    const title = esc(c.title ?? c.name ?? '(untitled)');
    const tags = [c.subtype, c.currency].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const acctFields = getTemplateFields(templates, 'account', c.subtype);
    const fields = getExtraFields(c, acctFields, { fieldVisibility: fv });
    const fieldGridHtml = fields.length > 0 ? `<div class="field-grid">${buildFieldGrid(fields)}</div>` : '';

    const linked = assets.filter(a => String(a.linked_account_id) === String(acct.row_id));
    let assetsPanel = '';
    if (linked.length > 0) {
      const assetRows = linked.map(a => {
        linkedIds.add(a.row_id);
        const ac = cleanEntry(a);
        const showValue = fv.monetary !== false;
        const val = showValue ? getEntryValue(ac, templates) : null;
        const assetFieldsDef = getTemplateFields(templates, 'asset', ac.subtype);
        const aFields = getExtraFields(ac, assetFieldsDef, { fieldVisibility: fv });
        const chips = aFields.map(f => {
          const cls = f.isSecret ? 'chip__value--mono' : (f.isCurrency ? 'chip__value--currency' : 'chip__value');
          return `<span class="chip"><span class="chip__label">${esc(f.label)}:</span><span class="${cls}">${esc(f.value)}</span></span>`;
        }).join('');
        return `<div class="asset-row">
          <div>
            <div class="asset-row__name">${esc(ac.title ?? ac.name)}${ac.subtype ? ` <span class="asset-row__type">${esc(ac.subtype)}</span>` : ''}</div>
            ${chips ? `<div class="asset-chips">${chips}</div>` : ''}
          </div>
          ${val ? `<div class="asset-row__value">${esc(fmtVal(val, ac.currency))}</div>` : ''}
        </div>`;
      }).join('');
      assetsPanel = `<div class="assets-panel"><div class="assets-panel__label">Linked Assets</div>${assetRows}</div>`;
    }

    cardsHtml += `<div class="acct-card">
      <div class="acct-card__head">
        <span class="acct-card__name"><span class="acct-card__num">${acct.row_id}.</span>${title}</span>
        <div class="acct-card__tags">${tags}</div>
      </div>
      ${fieldGridHtml}${assetsPanel}
    </div>`;
  }

  // Unlinked assets
  const unlinked = assets.filter(a => !linkedIds.has(a.row_id));
  let unlinkedHtml = '';
  if (unlinked.length > 0) {
    const cards = unlinked.map((a, i) => {
      const ac = cleanEntry(a);
      const tags = [ac.subtype, ac.currency].filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');
      const unlinkedAssetFields = getTemplateFields(templates, 'asset', ac.subtype);
      const fields = getExtraFields(ac, unlinkedAssetFields, { fieldVisibility: fv });
      const fieldGridHtml = fields.length > 0 ? `<div class="field-grid">${buildFieldGrid(fields)}</div>` : '';
      return `<div class="acct-card" style="border-left-color:var(--text-faint)">
        <div class="acct-card__head">
          <span class="acct-card__name"><span class="acct-card__num">${i + 1}.</span>${esc(ac.title ?? ac.name)}</span>
          <div class="acct-card__tags">${tags}</div>
        </div>
        ${fieldGridHtml}
      </div>`;
    }).join('');
    unlinkedHtml = `<div class="unlinked-panel"><div class="unlinked-label">Unlinked Assets</div>${cards}</div>`;
  }

  const subtotalHtml = fv.monetary === false ? '' : (() => {
    const { subtotalStr } = computeSubtotals(assets, templates);
    return subtotalStr ? `<span class="section__subtotal">${esc(subtotalStr)}</span>` : '';
  })();
  return `<div class="section">
    <div class="section__header">
      <span class="section__title">Accounts &amp; Assets</span>
      <span class="count-badge">${accounts.length} account${accounts.length !== 1 ? 's' : ''} · ${assets.length} asset${assets.length !== 1 ? 's' : ''}</span>
      ${subtotalHtml}
    </div>
    ${cardsHtml}${unlinkedHtml}
  </div>`;
}

function buildFullEntryCards(type, entries, templates, { fieldVisibility } = {}) {
  if (entries.length === 0) return '';
  const label = TYPE_LABELS[type] ?? type;

  const cards = entries.map(e => {
    const c = cleanEntry(e);
    const title = esc(c.title ?? c.name ?? '(untitled)');
    const tag = c.vendor || c.provider || c.institution || '';
    const fieldsDef = getTemplateFields(templates, type, c.subtype);
    const fields = getExtraFields(c, fieldsDef, { fieldVisibility });
    const fieldsHtml = fields.map(f => {
      const cls = f.isSecret ? 'mono' : '';
      return `<span class="entry-card__label">${esc(f.label)}</span><span class="entry-card__value ${cls}">${esc(f.value)}</span>`;
    }).join('');

    return `<div class="entry-card">
      <div class="entry-card__id">
        <span class="entry-card__num">${String(e.row_id).padStart(2, '0')}</span>
        <span class="entry-card__name">${title}</span>
        ${tag ? `<span class="entry-card__tag">${esc(tag)}</span>` : ''}
      </div>
      <div class="entry-card__fields">${fieldsHtml}</div>
    </div>`;
  }).join('');

  return `<div class="section">
    <div class="section__header">
      <span class="section__title">${esc(label)}</span>
      <span class="count-badge">${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'}</span>
    </div>
    ${cards}
  </div>`;
}

// ── Main export ──────────────────────────────────────────────────────────

/**
 * Export vault data to PDF via browser print.
 * @param {Object} grouped - Output of assignRowIdsAndRemap()
 * @param {Object[]} templates - Template objects from IndexedDB
 * @param {string} dateSuffix - e.g. "2026-03-20"
 * @param {Object} [rateMap] - Currency code → exchange_rate_to_base (for net worth tiles)
 * @param {string} [baseCurrency] - Base currency code (default 'GBP')
 * @param {{ secrets?: boolean, monetary?: boolean, rates?: boolean, netWorth?: boolean }} [fieldVisibility]
 */
export async function exportPdf(grouped, templates, dateSuffix, rateMap, baseCurrency = 'GBP', fieldVisibility) {
  _templateFieldsCache = {}; // reset per export
  const fv = fieldVisibility || {};
  const accounts = grouped.account ?? [];
  const assets = grouped.asset ?? [];
  const standardTypes = ['password', 'license', 'insurance', 'custom'];

  let body = '';

  // Net worth tiles (if rate data available and not hidden)
  if (fv.netWorth !== false && rateMap && assets.length > 0) {
    body += buildNetWorthTiles(assets, rateMap, baseCurrency, templates);
  }

  body += buildFullAccountsAssets(accounts, assets, templates, { fieldVisibility: fv });
  for (const type of standardTypes) {
    body += buildFullEntryCards(type, grouped[type] ?? [], templates, { fieldVisibility: fv });
  }

  const title = `citadel-export-${dateSuffix}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${getCSS()}</style></head>
<body><div class="page">${buildHeader(dateSuffix, fv)}${body}</div></body></html>`;

  // Render in hidden iframe and print
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:210mm;height:297mm;border:none;';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  // Wait for rendering to complete
  await new Promise(resolve => {
    iframe.onload = resolve;
    setTimeout(resolve, 500); // fallback
  });

  iframe.contentWindow.print();

  // Cleanup after print dialog closes
  setTimeout(() => document.body.removeChild(iframe), 2000);
}
