import { useState, useCallback } from 'react';
import { FileDown, Upload, Lock, AlertTriangle, Check, CheckCircle, Info } from 'lucide-react';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import { entryStore } from '../lib/entryStore';
import { VALID_ENTRY_TYPES } from '../lib/defaults';
import { buildRateMap } from '../lib/portfolioAggregator';
import { groupByType, assignRowIdsAndRemap } from '../lib/exportHelpers';
import { exportJson } from '../lib/exportJson';
import { exportCsvZip } from '../lib/exportCsvZip';
import { exportXlsx } from '../lib/exportXlsx';
import { exportPdf } from '../lib/exportPdf';
import useCurrencies from '../hooks/useCurrencies';
import useAppConfig from '../hooks/useAppConfig';
import ImportModal from '../components/ImportModal';

const FORMAT_OPTIONS = ['json', 'csv', 'xlsx', 'pdf'];

const FIELD_VISIBILITY_OPTIONS = [
  { key: 'secrets', label: 'Secrets', desc: 'Passwords, API keys, recovery keys, PINs' },
  { key: 'monetary', label: 'Monetary values', desc: 'Balances, prices, valuations, coverage amounts' },
  { key: 'rates', label: 'Rates & quantities', desc: 'Interest rates, employer match, shares, quantities' },
  { key: 'netWorth', label: 'Net worth summary', desc: 'Currency totals and portfolio valuation header', pdfOnly: true },
];

export default function ImportExportPage() {
  const { isUnlocked } = useEncryption();
  const { entries: allEntries, decryptedCache, refetch } = useVaultEntries();
  const { currencies } = useCurrencies();
  const { config } = useAppConfig();
  const baseCurrency = config?.base_currency || 'GBP';

  // Import
  const [showImport, setShowImport] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);

  const handleImportComplete = useCallback(async () => {
    try {
      await refetch();
    } catch { /* refresh failed — export will use stale data */ }
    setImportSuccess(true);
    setExported(false);
  }, [refetch]);

  // Export
  const [selectedTypes, setSelectedTypes] = useState(new Set(VALID_ENTRY_TYPES));
  const [format, setFormat] = useState('json');
  const [fieldVisibility, setFieldVisibility] = useState({
    secrets: true, monetary: true, rates: true, netWorth: true,
  });
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const toggleType = (type) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const selectAllTypes = (all) => {
    setSelectedTypes(all ? new Set(VALID_ENTRY_TYPES) : new Set());
  };

  const toggleVisibility = (key) => {
    setFieldVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExport = async () => {
    if (selectedTypes.size === 0) return;
    setExporting(true);
    setExported(false);

    try {
      const filtered = allEntries.filter(e => selectedTypes.has(e.entry_type));

      // Build decrypted list from context cache, attaching internal metadata
      const decrypted = filtered
        .map(e => {
          const d = decryptedCache[e.id];
          return d ? { _dbId: e.id, _entryType: e.entry_type, ...d } : null;
        })
        .filter(Boolean);

      if (decrypted.length === 0) {
        alert('No entries to export.');
        setExporting(false);
        return;
      }

      // Group by type, assign row IDs, remap linkage
      const grouped = assignRowIdsAndRemap(groupByType(decrypted));
      const dateSuffix = new Date().toISOString().split('T')[0];
      const templates = await entryStore.getAllTemplates();

      // JSON always exports everything; others respect field visibility
      const fv = format === 'json' ? null : fieldVisibility;

      if (format === 'json') {
        exportJson(grouped, dateSuffix);
      } else if (format === 'csv') {
        await exportCsvZip(grouped, dateSuffix, templates, fv);
      } else if (format === 'xlsx') {
        await exportXlsx(grouped, dateSuffix, templates, fv);
      } else if (format === 'pdf') {
        const rateMap = buildRateMap(currencies || []);
        await exportPdf(grouped, templates, dateSuffix, rateMap, baseCurrency, fv);
      }

      setExported(true);
    } catch (err) {
      alert('Export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

  const isJson = format === 'json';
  const isPdf = format === 'pdf';
  const showSecretsWarning = !isJson && fieldVisibility.secrets;

  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state"><Lock size={40} className="empty-icon" /><h3>Vault is locked</h3><p>Unlock to import or export data.</p></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Import / Export</h1><p className="page-subtitle">Move data in and out of your vault (100% client-side)</p></div>
      </div>

      {/* ── Import Section ─────────────────────────────────────── */}
      <div className="card mb-4" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }} className="flex items-center gap-2"><Upload size={20} /> Import</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
          Upload a CSV or Excel file to bulk-add entries. Supports Google Sheets URLs.
          All data is encrypted in your browser before being stored.
        </p>
        <button className="btn btn-primary" onClick={() => { setShowImport(true); setImportSuccess(false); }}>
          <Upload size={16} /> Import
        </button>
        {importSuccess && (
          <div className="flex items-center gap-2" style={{ marginTop: 12, color: '#16a34a', fontSize: 13 }}>
            <CheckCircle size={16} /> Import complete — entries are ready to export.
          </div>
        )}
      </div>

      {/* ── Export Section ──────────────────────────────────────── */}
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }} className="flex items-center gap-2"><FileDown size={20} /> Export</h2>

        <div className="alert alert-warning" style={{ fontSize: 12, padding: '6px 10px', marginBottom: 8 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
          <span>Exported files contain <strong>unencrypted data</strong>. Store them securely.</span>
        </div>

        {showSecretsWarning && (
          <div className="alert alert-danger" style={{ fontSize: 12, padding: '6px 10px', marginBottom: 8 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            <span>Secrets (passwords, API keys) will appear in <strong>plain text</strong>.</span>
          </div>
        )}

        {isJson && (
          <div className="alert alert-info" style={{ fontSize: 12, padding: '6px 10px', marginBottom: 8 }}>
            <Info size={13} style={{ flexShrink: 0 }} />
            <span>JSON is the full-backup format — all fields are always included.</span>
          </div>
        )}

        {/* Format selector */}
        <div style={{ marginBottom: 20, marginTop: 12 }}>
          <h3 style={{ marginBottom: 8, fontSize: 14 }}>Format</h3>
          <div className="format-tabs">
            {FORMAT_OPTIONS.map(f => (
              <button key={f} className={`format-tab${format === f ? ' active' : ''}`}
                onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Field visibility toggles */}
        {!isJson && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 8, fontSize: 14 }}>Field visibility</h3>
            <div className="fv-list">
              {FIELD_VISIBILITY_OPTIONS
                .filter(opt => !opt.pdfOnly || isPdf)
                .map(opt => (
                  <div key={opt.key} className="fv-row" onClick={() => toggleVisibility(opt.key)}>
                    <label className="fv-toggle" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={fieldVisibility[opt.key]}
                        onChange={() => toggleVisibility(opt.key)} />
                      <span className="fv-track" />
                    </label>
                    <div className="fv-text">
                      <div className="fv-label">
                        {opt.label}
                        {opt.pdfOnly && <span className="fv-badge pdf-only">PDF only</span>}
                      </div>
                      <div className="fv-desc">{opt.desc}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Entry types */}
        <div style={{ marginBottom: 20 }}>
          <div className="flex items-center" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>Entry types</h3>
            <div className="flex gap-2" style={{ fontSize: 12 }}>
              <button className="link-btn" onClick={() => selectAllTypes(true)}>Select all</button>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              <button className="link-btn" onClick={() => selectAllTypes(false)}>Clear</button>
            </div>
          </div>
          <div className="type-chips">
            {VALID_ENTRY_TYPES.map(type => (
              <button key={type}
                className={`type-chip${selectedTypes.has(type) ? ' selected' : ''}`}
                onClick={() => toggleType(type)}>
                <span className="chip-dot" />
                <span style={{ textTransform: 'capitalize' }}>{type}s</span>
              </button>
            ))}
          </div>
        </div>

        {/* Export button */}
        <button className="btn btn-primary" onClick={handleExport}
          disabled={exporting || selectedTypes.size === 0}>
          {exporting ? 'Exporting...' : exported ? <><Check size={16} /> Exported</> : <><FileDown size={16} /> Export</>}
        </button>
      </div>

      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onImportComplete={handleImportComplete} />
    </div>
  );
}
