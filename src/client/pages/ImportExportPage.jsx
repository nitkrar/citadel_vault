import { useState, useCallback } from 'react';
import { FileDown, Upload, Lock, AlertTriangle, Check, CheckCircle } from 'lucide-react';
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
const PDF_MODES = [
  { value: 'overview', label: 'Overview', desc: 'Details only — no amounts, secrets, or passwords' },
  { value: 'full', label: 'Full Detail', desc: 'Every field, secrets included' },
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
  const [pdfMode, setPdfMode] = useState('overview');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const toggleType = (type) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const handlePdfModeChange = (mode) => {
    setPdfMode(mode);
    if (mode === 'overview') {
      setSelectedTypes(prev => {
        const next = new Set(prev);
        next.delete('password');
        next.delete('license');
        return next;
      });
    }
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

      if (format === 'json') {
        exportJson(grouped, dateSuffix);
      } else if (format === 'csv') {
        await exportCsvZip(grouped, dateSuffix);
      } else if (format === 'xlsx') {
        await exportXlsx(grouped, dateSuffix);
      } else if (format === 'pdf') {
        const templates = await entryStore.getAllTemplates();
        const rateMap = buildRateMap(currencies || []);
        await exportPdf(grouped, templates, pdfMode, dateSuffix, rateMap, baseCurrency);
      }

      setExported(true);
    } catch (err) {
      alert('Export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

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
          <Upload size={16} /> Import from File
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

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 20, color: '#92400e', fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Exported files contain <strong>unencrypted data</strong>. Store them securely.</span>
        </div>

        {format === 'pdf' && pdfMode === 'full' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 12px', marginBottom: 20, color: '#991b1b', fontSize: 13 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span><strong>Full detail</strong> includes all secrets (passwords, keys) in plain text.</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ marginBottom: 12, fontSize: 14 }}>Entry types</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {VALID_ENTRY_TYPES.map(type => (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedTypes.has(type)} onChange={() => toggleType(type)} />
                  <span style={{ textTransform: 'capitalize' }}>{type}s</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ marginBottom: 12, fontSize: 14 }}>Format</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {FORMAT_OPTIONS.map(f => (
                <button key={f} className={`btn btn-sm ${format === f ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>

            {format === 'pdf' && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 8, fontSize: 14 }}>PDF mode</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {PDF_MODES.map(m => (
                    <label key={m.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" name="pdfMode" checked={pdfMode === m.value}
                        onChange={() => handlePdfModeChange(m.value)} />
                      <span><strong>{m.label}</strong> — {m.desc}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button className="btn btn-primary" onClick={handleExport}
              disabled={exporting || selectedTypes.size === 0}>
              {exporting ? 'Exporting...' : exported ? <><Check size={16} /> Exported</> : <><FileDown size={16} /> Export</>}
            </button>
          </div>
        </div>
      </div>

      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onImportComplete={handleImportComplete} />
    </div>
  );
}
