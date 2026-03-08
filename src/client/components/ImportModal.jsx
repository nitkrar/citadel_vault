import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from './Modal';
import { ENTITY_FIELDS, getEntityDisplayName } from '../lib/entityFieldConfigs';
import { buildResolvers, autoMapColumns, resolveRow } from '../lib/importResolvers';
import { AlertTriangle, Upload, CheckCircle, XCircle, Download, ArrowRight, ArrowLeft, Link2, FileSpreadsheet } from 'lucide-react';

const STEP_LABELS = ['Upload / Link', 'Map Columns', 'Preview & Validate', 'Import'];

/**
 * Extract Google Sheet ID from various URL formats.
 */
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * ImportModal — multi-step file import from CSV/Excel/Google Sheets.
 */
export default function ImportModal({
  isOpen,
  onClose,
  entityType,
  onImportComplete,
  referenceData = {},
}) {
  const fields = useMemo(() => ENTITY_FIELDS[entityType] || [], [entityType]);
  const resolvers = useMemo(() => buildResolvers(entityType, referenceData), [entityType, referenceData]);

  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [rawHeaders, setRawHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [parsedRows, setParsedRows] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [loadingSheet, setLoadingSheet] = useState(false);

  // Parse CSV text into headers + rows
  const parseCsv = (text) => {
    const lines = text.trim().split('\n').map((line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    });

    if (lines.length < 2) {
      throw new Error('Must have at least a header row and one data row.');
    }

    return {
      headers: lines[0],
      rows: lines.slice(1).filter((row) => row.some((cell) => cell.trim())),
    };
  };

  // Parse XLSX buffer into headers + rows
  const parseXlsx = async (data) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(data, { type: 'array' });

    // Try to find a sheet matching entity name
    let sheetName = wb.SheetNames[0];
    const entityNames = {
      assets: ['assets', 'asset'],
      accounts: ['accounts', 'account'],
      licenses: ['licenses', 'license'],
      insurance: ['insurance', 'policies', 'insurance policies'],
      vault: ['vault', 'passwords', 'password vault'],
    };
    const matches = entityNames[entityType] || [];
    for (const name of wb.SheetNames) {
      if (matches.includes(name.toLowerCase().trim())) {
        sheetName = name;
        break;
      }
    }

    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (json.length < 2) {
      throw new Error('Sheet must have at least a header row and one data row.');
    }

    return {
      headers: json[0].map((h) => String(h || '')),
      rows: json.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim())),
    };
  };

  // Load parsed data into state and advance to mapping step
  const loadData = (headers, rows) => {
    setRawHeaders(headers);
    setRawRows(rows);
    const mapping = autoMapColumns(headers, fields);
    setColumnMapping(mapping);
    setStep(1);
  };

  // Handle file upload
  const handleFileUpload = useCallback(async (e) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    try {
      if (ext === 'csv') {
        const text = await file.text();
        const { headers, rows } = parseCsv(text);
        loadData(headers, rows);
      } else if (ext === 'xlsx' || ext === 'xls') {
        const data = await file.arrayBuffer();
        const { headers, rows } = await parseXlsx(data);
        loadData(headers, rows);
      } else {
        setError('Unsupported file format. Use .csv or .xlsx.');
      }
    } catch (err) {
      setError(`Failed to parse file: ${err.message}`);
    }
  }, [entityType, fields]);

  // Handle Google Sheets URL
  const handleSheetUrl = async () => {
    setError('');
    const url = sheetUrl.trim();
    if (!url) return;

    const sheetId = extractSheetId(url);
    if (!sheetId) {
      setError('Invalid Google Sheets URL. Expected format: https://docs.google.com/spreadsheets/d/...');
      return;
    }

    setLoadingSheet(true);
    try {
      // Try fetching as CSV via the public export URL
      // This works for sheets shared as "Anyone with the link"
      const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(exportUrl);

      if (!response.ok) {
        throw new Error('Could not access the sheet. Make sure it is shared as "Anyone with the link can view".');
      }

      const text = await response.text();

      // Check if we got an HTML page (auth redirect) instead of CSV
      if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
        throw new Error('Sheet is not publicly accessible. Share it as "Anyone with the link can view", or export as CSV/XLSX and upload the file.');
      }

      const { headers, rows } = parseCsv(text);
      loadData(headers, rows);
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        // CORS error
        setError('Cannot access Google Sheets directly from the browser. Please share the sheet as "Anyone with the link", or export it as CSV/XLSX and upload the file.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoadingSheet(false);
    }
  };

  const setMapping = (colIdx, fieldKey) => {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (fieldKey === '') {
        delete next[colIdx];
      } else {
        Object.keys(next).forEach((k) => {
          if (next[k] === fieldKey) delete next[k];
        });
        next[colIdx] = fieldKey;
      }
      return next;
    });
  };

  // Step 2 → 3: Parse and validate
  const processRows = () => {
    setError('');
    const mapped = rawRows.map((row) => {
      const item = {};
      Object.entries(columnMapping).forEach(([colIdx, fieldKey]) => {
        const val = row[parseInt(colIdx, 10)];
        item[fieldKey] = val !== undefined && val !== null ? String(val).trim() : '';
      });
      return item;
    });

    const resolved = mapped.map((row) => resolveRow(row, resolvers));

    const errors = {};
    resolved.forEach((row, i) => {
      fields.forEach((f) => {
        if (f.required && (!row[f.key] || row[f.key] === '')) {
          errors[`${i}-${f.key}`] = `${f.label} is required`;
        }
      });
    });

    setParsedRows(resolved);
    setValidationErrors(errors);
    setStep(2);
  };

  // Step 3 → 4: Import
  const handleImport = async () => {
    setError('');
    setImporting(true);

    const items = parsedRows.map((row) => {
      const item = {};
      fields.forEach((f) => {
        const val = row[f.key];
        if (f.type === 'checkbox') {
          item[f.key] = val ? 1 : 0;
        } else if (f.type === 'number') {
          item[f.key] = val !== '' && val !== undefined && val !== null ? parseFloat(val) : null;
        } else if (f.type === 'select' && f.refKey) {
          item[f.key] = val ? parseInt(val, 10) || null : null;
        } else if (f.type === 'date') {
          item[f.key] = val || null;
        } else {
          item[f.key] = val || null;
        }
      });
      return item;
    });

    try {
      const res = await api.post('/bulk.php?action=create', {
        entity: entityType,
        items,
      });
      setResults(res.data.data);
      setStep(3);
      if (onImportComplete) onImportComplete();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // Download CSV template
  const downloadCsvTemplate = () => {
    const headers = fields.map((f) => f.label);
    const csv = headers.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entityType}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download XLSX template
  const downloadXlsxTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const headers = fields.map((f) => f.label);
      const ws = XLSX.utils.aoa_to_sheet([headers]);

      // Set column widths
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }));

      const wb = XLSX.utils.book_new();
      const sheetName = getEntityDisplayName(entityType);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${entityType}_template.xlsx`);
    } catch {
      // Fallback to CSV if XLSX generation fails
      downloadCsvTemplate();
    }
  };

  const handleClose = () => {
    setStep(0);
    setError('');
    setRawHeaders([]);
    setRawRows([]);
    setColumnMapping({});
    setParsedRows([]);
    setValidationErrors({});
    setResults(null);
    setSheetUrl('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Import ${getEntityDisplayName(entityType)}`}
      size="xl"
      footer={
        step === 3 ? (
          <button className="btn btn-primary" onClick={handleClose}>Done</button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={step > 0 && step < 3 ? () => setStep(step - 1) : handleClose}>
              {step > 0 && step < 3 ? <><ArrowLeft size={14} /> Back</> : 'Cancel'}
            </button>
            {step === 1 && (
              <button className="btn btn-primary" onClick={processRows}>
                Preview <ArrowRight size={14} />
              </button>
            )}
            {step === 2 && (
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={importing || Object.keys(validationErrors).length > 0}
              >
                {importing ? 'Importing...' : `Import ${parsedRows.length} Items`}
              </button>
            )}
          </>
        )
      }
    >
      {error && (
        <div className="alert alert-danger mb-3">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-4">
        {STEP_LABELS.map((label, i) => (
          <div
            key={i}
            className="flex items-center gap-1"
            style={{
              padding: '4px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: 12,
              fontWeight: step === i ? 600 : 400,
              background: step === i ? 'var(--color-primary-light)' : step > i ? 'var(--color-success-light)' : 'var(--bg)',
              color: step === i ? 'var(--primary)' : step > i ? 'var(--success)' : 'var(--text-muted)',
              border: `1px solid ${step === i ? 'var(--primary)' : 'var(--border)'}`,
            }}
          >
            {step > i ? <CheckCircle size={12} /> : null}
            {label}
          </div>
        ))}
      </div>

      {/* Step 0: Upload / Link */}
      {step === 0 && (
        <div>
          {/* File upload */}
          <div
            style={{
              border: '2px dashed var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-xl)',
              textAlign: 'center',
              cursor: 'pointer',
            }}
            onClick={() => document.getElementById('import-file-input')?.click()}
          >
            <Upload size={40} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <p>Click to upload or drag and drop</p>
            <p className="text-muted text-sm">.csv or .xlsx files</p>
            <input
              id="import-file-input"
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3" style={{ margin: '20px 0' }}>
            <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
            <span className="text-muted text-sm">or</span>
            <div style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
          </div>

          {/* Google Sheets URL */}
          <div>
            <label className="form-label flex items-center gap-1">
              <Link2 size={14} /> Google Sheets URL
            </label>
            <div className="flex gap-2">
              <input
                className="form-control"
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSheetUrl(); }}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleSheetUrl}
                disabled={!sheetUrl.trim() || loadingSheet}
              >
                {loadingSheet ? 'Loading...' : 'Fetch'}
              </button>
            </div>
            <p className="text-muted text-sm" style={{ marginTop: 4 }}>
              Sheet must be shared as "Anyone with the link can view"
            </p>
          </div>

          {/* Template downloads */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>Download a template to get started:</p>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary btn-sm" onClick={downloadCsvTemplate}>
                <Download size={14} /> CSV Template
              </button>
              <button className="btn btn-secondary btn-sm" onClick={downloadXlsxTemplate}>
                <FileSpreadsheet size={14} /> Excel Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Column Mapping */}
      {step === 1 && (
        <div>
          <p className="text-muted mb-3" style={{ fontSize: 13 }}>
            Map each column from your file to a field. {rawRows.length} row{rawRows.length !== 1 ? 's' : ''} found.
          </p>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>File Column</th>
                  <th>Sample Data</th>
                  <th>Map To Field</th>
                </tr>
              </thead>
              <tbody>
                {rawHeaders.map((header, idx) => (
                  <tr key={idx}>
                    <td className="font-medium">{header || `Column ${idx + 1}`}</td>
                    <td className="text-muted text-sm">{rawRows[0]?.[idx] || '--'}</td>
                    <td>
                      <select
                        className="form-control form-control-sm"
                        value={columnMapping[idx] || ''}
                        onChange={(e) => setMapping(idx, e.target.value)}
                      >
                        <option value="">Skip column</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label} {f.required ? '*' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fields.filter((f) => f.required && !Object.values(columnMapping).includes(f.key)).length > 0 && (
            <div className="alert alert-warning mt-3">
              <AlertTriangle size={14} />
              <span style={{ fontSize: 13 }}>
                Unmapped required fields:{' '}
                {fields
                  .filter((f) => f.required && !Object.values(columnMapping).includes(f.key))
                  .map((f) => f.label)
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Preview & Validate */}
      {step === 2 && (
        <div>
          <p className="text-muted mb-3" style={{ fontSize: 13 }}>
            Review the data before importing. {Object.keys(validationErrors).length > 0
              ? `${Object.keys(validationErrors).length} validation issue${Object.keys(validationErrors).length !== 1 ? 's' : ''} found.`
              : 'All rows look good.'}
          </p>
          <div className="bulk-add-table-wrapper">
            <table className="bulk-add-table">
              <thead>
                <tr>
                  <th>#</th>
                  {fields.filter((f) => Object.values(columnMapping).includes(f.key)).map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 50).map((row, idx) => (
                  <tr key={idx}>
                    <td className="text-muted text-sm">{idx + 1}</td>
                    {fields.filter((f) => Object.values(columnMapping).includes(f.key)).map((f) => {
                      const hasError = !!validationErrors[`${idx}-${f.key}`];
                      const val = row[f.key];
                      let display = val;
                      if (f.refKey && referenceData[f.refKey] && val) {
                        const item = referenceData[f.refKey].find((r) => r.id === parseInt(val, 10));
                        if (item) {
                          display = f.displayFn ? f.displayFn(item) : item[f.displayKey || 'name'];
                        }
                      }
                      return (
                        <td
                          key={f.key}
                          style={hasError ? { background: 'var(--color-danger-light)', color: 'var(--danger)' } : {}}
                          title={hasError ? validationErrors[`${idx}-${f.key}`] : undefined}
                        >
                          {f.type === 'checkbox' ? (val ? 'Yes' : 'No') : (display || '--')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsedRows.length > 50 && (
            <p className="text-muted text-sm mt-2">Showing first 50 of {parsedRows.length} rows.</p>
          )}
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && results && (
        <div>
          <div className="alert alert-success mb-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={16} />
            <span>Imported {results.succeeded} of {results.total} items successfully.</span>
          </div>
          {results.failed > 0 && (
            <div className="mb-3">
              <p className="font-medium mb-2">Failed rows:</p>
              {results.results
                .filter((r) => !r.success)
                .map((r) => (
                  <div key={r.index} className="alert alert-danger" style={{ padding: '6px 12px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <XCircle size={14} />
                    <span>Row {r.index + 1}: {r.error}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
