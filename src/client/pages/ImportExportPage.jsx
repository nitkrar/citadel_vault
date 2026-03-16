import { useState } from 'react';
import { FileDown, Upload, Lock, AlertTriangle, Check } from 'lucide-react';
import { useEncryption } from '../contexts/EncryptionContext';
import { entryStore } from '../lib/entryStore';
import { VALID_ENTRY_TYPES } from '../lib/defaults';
import ImportModal from '../components/ImportModal';

export default function ImportExportPage() {
  const { isUnlocked, decrypt } = useEncryption();

  // Import
  const [showImport, setShowImport] = useState(false);

  // Export
  const [selectedTypes, setSelectedTypes] = useState(new Set(VALID_ENTRY_TYPES));
  const [format, setFormat] = useState('json');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const toggleType = (type) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedTypes.size === 0) return;
    setExporting(true);
    setExported(false);

    try {
      const entries = await entryStore.getAll();
      const filtered = entries.filter(e => selectedTypes.has(e.entry_type));

      const decrypted = [];
      for (const entry of filtered) {
        try {
          const d = await decrypt(entry.encrypted_data);
          if (d) decrypted.push({ type: entry.entry_type, ...d });
        } catch { /* skip */ }
      }

      if (decrypted.length === 0) {
        alert('No entries to export.');
        setExporting(false);
        return;
      }

      let blob, filename;
      const dateSuffix = new Date().toISOString().split('T')[0];

      if (format === 'json') {
        const json = JSON.stringify(decrypted, null, 2);
        blob = new Blob([json], { type: 'application/json' });
        filename = `citadel-export-${dateSuffix}.json`;
      } else if (format === 'csv') {
        const allKeys = new Set();
        decrypted.forEach(d => Object.keys(d).forEach(k => allKeys.add(k)));
        const keys = ['type', ...Array.from(allKeys).filter(k => k !== 'type').sort()];
        const header = keys.join(',');
        const rows = decrypted.map(d =>
          keys.map(k => {
            const val = d[k] ?? '';
            const str = String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"` : str;
          }).join(',')
        );
        blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
        filename = `citadel-export-${dateSuffix}.csv`;
      } else if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet(decrypted);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Vault Export');
        XLSX.writeFile(wb, `citadel-export-${dateSuffix}.xlsx`);
        setExported(true);
        setExporting(false);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
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
        <button className="btn btn-primary" onClick={() => setShowImport(true)}>
          <Upload size={16} /> Import from File
        </button>
      </div>

      {/* ── Export Section ──────────────────────────────────────── */}
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }} className="flex items-center gap-2"><FileDown size={20} /> Export</h2>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 20, color: '#92400e', fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Exported files contain <strong>unencrypted data</strong>. Store them securely.</span>
        </div>

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
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              {['json', 'csv', 'xlsx'].map(f => (
                <button key={f} className={`btn btn-sm ${format === f ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFormat(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>

            <button className="btn btn-primary" onClick={handleExport}
              disabled={exporting || selectedTypes.size === 0}>
              {exporting ? 'Exporting...' : exported ? <><Check size={16} /> Exported</> : <><FileDown size={16} /> Export</>}
            </button>
          </div>
        </div>
      </div>

      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} onImportComplete={() => setExported(false)} />
    </div>
  );
}
