import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from './Modal';
import { useEncryption } from '../contexts/EncryptionContext';
import { AAD_VAULT_ENTRY } from '../lib/crypto';
import { entryStore } from '../lib/entryStore';
import { apiData } from '../lib/checks';
import { VALID_ENTRY_TYPES } from '../lib/defaults';
import {
    parseCsv, parseXlsx, autoMapColumns, detectEntryType,
    matchSheetToType, generateCsvTemplate, generateXlsxTemplate,
} from '../lib/importUtils';
import {
    Upload, AlertTriangle, CheckCircle, XCircle, Download, Link2,
    FileSpreadsheet, ArrowRight, Loader,
} from 'lucide-react';

const TYPE_LABELS = {
    password: 'Passwords', account: 'Accounts', asset: 'Assets',
    license: 'Licenses', insurance: 'Insurance', custom: 'Custom',
};

/**
 * ImportModal — 2-step client-side import wizard.
 *
 * Step 1: Upload (CSV, XLSX, Google Sheets URL)
 * Step 2: Review auto-mapped data + Import
 *
 * 100% client-side encryption. Server never sees plaintext.
 */
export default function ImportModal({ isOpen, onClose, defaultType, onImportComplete }) {
    const { isUnlocked, encrypt } = useEncryption();
    const [step, setStep] = useState(0);
    const [error, setError] = useState('');

    // Upload state
    const [sheetUrl, setSheetUrl] = useState('');
    const [loadingSheet, setLoadingSheet] = useState(false);

    // Parsed data — array of "sheet" objects for uniform handling
    // Each: { name, headers, rows, type, templateId, mapping }
    const [sheets, setSheets] = useState([]);
    const [activeSheet, setActiveSheet] = useState(0);
    const [sheetEnabled, setSheetEnabled] = useState({});

    // Templates from IndexedDB
    const [templates, setTemplates] = useState([]);

    // Import state
    const [importing, setImporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState(null);

    // ── Load templates ─────────────────────────────────────────────
    const loadTemplates = useCallback(async () => {
        const tpl = await entryStore.getAllTemplates();
        setTemplates(tpl);
        return tpl;
    }, []);

    // ── Process parsed data ────────────────────────────────────────
    const processSheets = useCallback(async (parsedSheets) => {
        const tpl = await loadTemplates();
        const processed = parsedSheets.map(sheet => {
            // Try to detect type from sheet name or headers
            const typeFromName = matchSheetToType(sheet.name);
            const typeFromHeaders = detectEntryType(sheet.headers, tpl);
            const type = typeFromName || typeFromHeaders.type || defaultType || 'password';

            // Find matching template
            const matchingTpl = tpl.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
            const templateId = matchingTpl?.id || typeFromHeaders.templateId || null;

            // Get fields and auto-map
            const fields = matchingTpl?.fields
                ? (typeof matchingTpl.fields === 'string' ? JSON.parse(matchingTpl.fields) : matchingTpl.fields)
                : [];
            const mapping = autoMapColumns(sheet.headers, fields);

            return { ...sheet, type, templateId, mapping, fields };
        });

        setSheets(processed);
        const enabled = {};
        processed.forEach((_, i) => { enabled[i] = true; });
        setSheetEnabled(enabled);
        setActiveSheet(0);
        setStep(1);
    }, [loadTemplates, defaultType]);

    // ── File upload handler ────────────────────────────────────────
    const handleFileUpload = useCallback(async (e) => {
        setError('');
        const file = e.target.files?.[0];
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();

        try {
            if (ext === 'csv') {
                const text = await file.text();
                const { headers, rows } = parseCsv(text);
                await processSheets([{ name: file.name.replace(/\.[^.]+$/, ''), headers, rows }]);
            } else if (ext === 'xlsx' || ext === 'xls') {
                const data = await file.arrayBuffer();
                const { sheets: parsed } = await parseXlsx(data);
                if (parsed.length === 0) throw new Error('No valid sheets found in the file.');
                await processSheets(parsed);
            } else {
                setError('Unsupported format. Use .csv or .xlsx.');
            }
        } catch (err) {
            setError(`Failed to parse file: ${err.message}`);
        }
    }, [processSheets]);

    // ── Google Sheets URL handler ──────────────────────────────────
    const handleSheetUrl = async () => {
        setError('');
        const url = sheetUrl.trim();
        if (!url) return;

        const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (!match) { setError('Invalid Google Sheets URL.'); return; }

        setLoadingSheet(true);
        try {
            const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
            const response = await fetch(exportUrl);
            if (!response.ok) throw new Error('Cannot access sheet. Make sure it is shared as "Anyone with the link".');
            const text = await response.text();
            if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
                throw new Error('Sheet is not publicly accessible. Share it or export as CSV/XLSX.');
            }
            const { headers, rows } = parseCsv(text);
            await processSheets([{ name: 'Google Sheet', headers, rows }]);
        } catch (err) {
            setError(err.message.includes('fetch')
                ? 'Cannot access Google Sheets from browser. Export as CSV/XLSX and upload.'
                : err.message);
        } finally {
            setLoadingSheet(false);
        }
    };

    // ── Column mapping update ──────────────────────────────────────
    const setMapping = (sheetIdx, colIdx, fieldKey) => {
        setSheets(prev => prev.map((s, i) => {
            if (i !== sheetIdx) return s;
            const mapping = { ...s.mapping };
            if (fieldKey === '') {
                delete mapping[colIdx];
            } else {
                // Remove any existing mapping to this field
                Object.keys(mapping).forEach(k => {
                    if (mapping[k] === fieldKey) delete mapping[k];
                });
                mapping[colIdx] = fieldKey;
            }
            return { ...s, mapping };
        }));
    };

    // ── Type change ────────────────────────────────────────────────
    const setSheetType = (sheetIdx, type) => {
        const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
        const fields = tpl?.fields
            ? (typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields)
            : [];

        setSheets(prev => prev.map((s, i) => {
            if (i !== sheetIdx) return s;
            const mapping = autoMapColumns(s.headers, fields);
            return { ...s, type, templateId: tpl?.id || null, mapping, fields };
        }));
    };

    // ── Import ─────────────────────────────────────────────────────
    const handleImport = async () => {
        setError('');
        setImporting(true);
        setProgress(0);

        const enabledSheets = sheets.filter((_, i) => sheetEnabled[i]);
        const allEntries = [];

        // Build entries from all enabled sheets
        for (const sheet of enabledSheets) {
            for (const row of sheet.rows) {
                const item = {};
                Object.entries(sheet.mapping).forEach(([colIdx, fieldKey]) => {
                    const val = row[parseInt(colIdx, 10)];
                    item[fieldKey] = val !== undefined && val !== null ? String(val).trim() : '';
                });
                allEntries.push({ type: sheet.type, templateId: sheet.templateId, data: item });
            }
        }

        if (allEntries.length === 0) { setError('No entries to import.'); setImporting(false); return; }

        try {
            // Encrypt all entries
            const encrypted = [];
            for (let i = 0; i < allEntries.length; i++) {
                const blob = await encrypt(allEntries[i].data, AAD_VAULT_ENTRY);
                encrypted.push({
                    entry_type: allEntries[i].type,
                    template_id: allEntries[i].templateId,
                    encrypted_data: blob,
                });
                setProgress(Math.round(((i + 1) / allEntries.length) * 80));
            }

            // Batch create
            const { data: resp } = await api.post('/vault.php?action=bulk-create', { entries: encrypted });
            const result = apiData({ data: resp });
            setProgress(100);
            setResults({ total: allEntries.length, succeeded: result?.count || allEntries.length });

            // Refresh local store
            if (onImportComplete) onImportComplete();
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Import failed.');
        } finally {
            setImporting(false);
        }
    };

    // ── Download template ──────────────────────────────────────────
    const downloadCsvTemplate = (type) => {
        const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
        const fields = tpl?.fields ? (typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields) : [];
        const csv = generateCsvTemplate(fields);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${type}_template.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    const downloadXlsxTemplateAll = async () => {
        const byType = {};
        for (const type of VALID_ENTRY_TYPES) {
            const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
            const fields = tpl?.fields ? (typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields) : [];
            if (fields.length) byType[TYPE_LABELS[type] || type] = fields;
        }
        const XLSX = await import('xlsx');
        const wb = await generateXlsxTemplate(byType);
        XLSX.writeFile(wb, 'citadel_import_template.xlsx');
    };

    // ── Reset ──────────────────────────────────────────────────────
    const handleClose = () => {
        setStep(0); setError(''); setSheets([]); setSheetUrl('');
        setResults(null); setProgress(0); setImporting(false);
        onClose();
    };

    if (!isOpen || !isUnlocked) return null;

    const currentSheet = sheets[activeSheet];

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Import Entries" size="xl">
            {error && (
                <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{error}</span></div>
            )}

            {/* ── Step 0: Upload ─────────────────────────────────── */}
            {step === 0 && (
                <div>
                    <div style={{ border: '2px dashed var(--border-color, #d1d5db)', borderRadius: 8, padding: 32, textAlign: 'center', cursor: 'pointer' }}
                        onClick={() => document.getElementById('import-file-input')?.click()}>
                        <Upload size={40} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                        <p>Click to upload or drag and drop</p>
                        <p className="text-muted" style={{ fontSize: 13 }}>.csv or .xlsx files</p>
                        <input id="import-file-input" type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFileUpload} />
                    </div>

                    <div className="flex items-center gap-3" style={{ margin: '20px 0' }}>
                        <div style={{ flex: 1, borderTop: '1px solid var(--border-color, #e5e7eb)' }} />
                        <span className="text-muted" style={{ fontSize: 13 }}>or</span>
                        <div style={{ flex: 1, borderTop: '1px solid var(--border-color, #e5e7eb)' }} />
                    </div>

                    <div>
                        <label className="form-label flex items-center gap-1"><Link2 size={14} /> Google Sheets URL</label>
                        <div className="flex gap-2">
                            <input className="form-control" type="url" placeholder="https://docs.google.com/spreadsheets/d/..."
                                value={sheetUrl} onChange={e => setSheetUrl(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSheetUrl(); }} style={{ flex: 1 }} />
                            <button className="btn btn-primary" onClick={handleSheetUrl} disabled={!sheetUrl.trim() || loadingSheet}>
                                {loadingSheet ? 'Loading...' : 'Fetch'}
                            </button>
                        </div>
                        <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                            Imports first tab only. For multi-tab sheets, download as Excel and upload.
                        </p>
                    </div>

                    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
                        <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>Download a template:</p>
                        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                            {VALID_ENTRY_TYPES.filter(t => t !== 'custom').map(type => (
                                <button key={type} className="btn btn-ghost btn-sm" onClick={async () => { await loadTemplates(); downloadCsvTemplate(type); }}>
                                    <Download size={14} /> {TYPE_LABELS[type]} CSV
                                </button>
                            ))}
                            <button className="btn btn-secondary btn-sm" onClick={async () => { await loadTemplates(); downloadXlsxTemplateAll(); }}>
                                <FileSpreadsheet size={14} /> All Types (Excel)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Step 1: Review + Import ────────────────────────── */}
            {step === 1 && !results && (
                <div>
                    {/* Sheet tabs (if multi-sheet) */}
                    {sheets.length > 1 && (
                        <div className="flex gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
                            {sheets.map((s, i) => (
                                <label key={i} className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                                    <input type="checkbox" checked={sheetEnabled[i] || false}
                                        onChange={e => setSheetEnabled(prev => ({ ...prev, [i]: e.target.checked }))} />
                                    <button className={`btn btn-sm ${activeSheet === i ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setActiveSheet(i)}>
                                        {s.name} ({s.rows.length} rows)
                                    </button>
                                </label>
                            ))}
                        </div>
                    )}

                    {currentSheet && (
                        <>
                            {/* Type selector */}
                            <div className="flex gap-3 mb-3 items-end">
                                <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                                    <label className="form-label">Entry Type</label>
                                    <select className="form-control" value={currentSheet.type}
                                        onChange={e => setSheetType(activeSheet, e.target.value)}>
                                        {VALID_ENTRY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
                                    </select>
                                </div>
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', paddingBottom: 8 }}>
                                    {currentSheet.rows.length} rows, {Object.keys(currentSheet.mapping).length}/{currentSheet.headers.length} columns mapped
                                </div>
                            </div>

                            {/* Unmapped required fields warning */}
                            {(() => {
                                const unmapped = (currentSheet.fields || []).filter(f => f.required && !Object.values(currentSheet.mapping).includes(f.key));
                                return unmapped.length > 0 ? (
                                    <div className="alert alert-warning mb-3" style={{ fontSize: 13 }}>
                                        <AlertTriangle size={14} />
                                        <span>Unmapped required fields: {unmapped.map(f => f.label).join(', ')}</span>
                                    </div>
                                ) : null;
                            })()}

                            {/* Mapped data table */}
                            <div className="table-wrapper" style={{ maxHeight: 400, overflow: 'auto' }}>
                                <table>
                                    <thead>
                                        <tr>
                                            {currentSheet.headers.map((h, i) => (
                                                <th key={i} style={{ minWidth: 120 }}>
                                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{h}</div>
                                                    <select className="form-control" style={{ fontSize: 12, padding: '2px 4px' }}
                                                        value={currentSheet.mapping[i] || ''}
                                                        onChange={e => setMapping(activeSheet, i, e.target.value)}>
                                                        <option value="">Skip</option>
                                                        {(currentSheet.fields || []).map(f => (
                                                            <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                                                        ))}
                                                    </select>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {currentSheet.rows.slice(0, 30).map((row, ri) => (
                                            <tr key={ri}>
                                                {currentSheet.headers.map((_, ci) => (
                                                    <td key={ci} style={{
                                                        fontSize: 13,
                                                        color: currentSheet.mapping[ci] ? 'inherit' : 'var(--text-muted)',
                                                        opacity: currentSheet.mapping[ci] ? 1 : 0.5,
                                                    }}>
                                                        {row[ci] !== undefined ? String(row[ci]).slice(0, 50) : ''}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {currentSheet.rows.length > 30 && (
                                <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                                    Showing first 30 of {currentSheet.rows.length} rows.
                                </p>
                            )}
                        </>
                    )}

                    {/* Progress bar */}
                    {importing && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <Loader size={14} className="spin" />
                                <span style={{ fontSize: 13 }}>Encrypting and importing... {progress}%</span>
                            </div>
                            <div style={{ height: 6, background: 'var(--border-color, #e5e7eb)', borderRadius: 3 }}>
                                <div style={{ height: '100%', width: `${progress}%`, background: '#2563eb', borderRadius: 3, transition: 'width 0.2s' }} />
                            </div>
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 mt-4">
                        <button className="btn btn-secondary" onClick={() => { setStep(0); setSheets([]); }}>Back</button>
                        <button className="btn btn-primary" onClick={handleImport}
                            disabled={importing || sheets.every((_, i) => !sheetEnabled[i])}>
                            {importing ? 'Importing...' : `Import ${sheets.filter((_, i) => sheetEnabled[i]).reduce((sum, s) => sum + s.rows.length, 0)} entries`}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Results ────────────────────────────────────────── */}
            {results && (
                <div style={{ textAlign: 'center', padding: 16 }}>
                    <CheckCircle size={48} style={{ color: '#22c55e', marginBottom: 16 }} />
                    <h3>Import Complete</h3>
                    <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
                        Successfully imported {results.succeeded} of {results.total} entries.
                    </p>
                    <button className="btn btn-primary" onClick={handleClose}>Done</button>
                </div>
            )}
        </Modal>
    );
}
