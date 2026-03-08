import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from './Modal';
import { ENTITY_FIELDS, getEntityDisplayName } from '../lib/entityFieldConfigs';
import { Plus, Trash2, AlertTriangle, CheckCircle, XCircle, Clipboard } from 'lucide-react';

const MAX_ROWS = 50;

function emptyRow(fields) {
  const row = {};
  fields.forEach((f) => {
    if (f.type === 'checkbox') row[f.key] = false;
    else row[f.key] = '';
  });
  return row;
}

/**
 * BulkAddModal — spreadsheet-like table for creating multiple items at once.
 *
 * Props:
 *   isOpen, onClose, entityType, onSaveComplete, referenceData,
 *   defaults (default values to pre-fill), standalone (true=modal, false=wizard embed)
 */
export default function BulkAddModal({
  isOpen,
  onClose,
  entityType,
  onSaveComplete,
  referenceData = {},
  defaults = {},
  standalone = true,
}) {
  const fields = useMemo(() => ENTITY_FIELDS[entityType] || [], [entityType]);
  const [rows, setRows] = useState(() => [{ ...emptyRow(fields), ...defaults }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  const addRow = () => {
    if (rows.length >= MAX_ROWS) return;
    setRows((prev) => [...prev, { ...emptyRow(fields), ...defaults }]);
  };

  const removeRow = (idx) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const updateCell = (rowIdx, key, value) => {
    setRows((prev) => prev.map((row, i) => (i === rowIdx ? { ...row, [key]: value } : row)));
    // Clear validation error for this cell
    setValidationErrors((prev) => {
      const key2 = `${rowIdx}-${key}`;
      if (prev[key2]) {
        const next = { ...prev };
        delete next[key2];
        return next;
      }
      return prev;
    });
  };

  const validate = () => {
    const errors = {};
    let hasError = false;
    rows.forEach((row, i) => {
      fields.forEach((f) => {
        if (f.required && (row[f.key] === '' || row[f.key] === null || row[f.key] === undefined)) {
          errors[`${i}-${f.key}`] = true;
          hasError = true;
        }
      });
    });
    setValidationErrors(errors);
    return !hasError;
  };

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;

      const lines = text.trim().split('\n').map((line) => line.split('\t'));
      if (lines.length === 0) return;

      const newRows = lines.map((cells) => {
        const row = { ...emptyRow(fields), ...defaults };
        cells.forEach((cell, idx) => {
          if (idx < fields.length) {
            const f = fields[idx];
            if (f.type === 'checkbox') {
              row[f.key] = ['true', '1', 'yes'].includes(cell.trim().toLowerCase());
            } else {
              row[f.key] = cell.trim();
            }
          }
        });
        return row;
      });

      setRows((prev) => {
        // Replace empty first row, or append
        if (prev.length === 1 && fields.every((f) => !prev[0][f.key] || prev[0][f.key] === defaults[f.key])) {
          return newRows.slice(0, MAX_ROWS);
        }
        return [...prev, ...newRows].slice(0, MAX_ROWS);
      });
    } catch {
      // Clipboard API may not be available
    }
  }, [fields, defaults]);

  const handleSave = async () => {
    setError('');
    if (!validate()) {
      setError('Please fill in all required fields (highlighted in red).');
      return;
    }

    // Skip fully empty rows
    const nonEmptyRows = rows.filter((row) =>
      fields.some((f) => {
        const v = row[f.key];
        return f.type === 'checkbox' ? v === true : v !== '' && v !== undefined && v !== null && v !== (defaults[f.key] || '');
      })
    );

    if (nonEmptyRows.length === 0) {
      setError('All rows are empty.');
      return;
    }

    const items = nonEmptyRows.map((row) => {
      const item = {};
      fields.forEach((f) => {
        const val = row[f.key];
        if (f.type === 'checkbox') {
          item[f.key] = val ? 1 : 0;
        } else if (f.type === 'number') {
          item[f.key] = val !== '' && val !== undefined ? parseFloat(val) : null;
        } else if (f.type === 'select' && f.refKey) {
          item[f.key] = val ? parseInt(val, 10) : null;
        } else if (f.type === 'date') {
          item[f.key] = val || null;
        } else {
          item[f.key] = val || null;
        }
      });
      return item;
    });

    setSaving(true);
    try {
      const res = await api.post('/bulk.php?action=create', {
        entity: entityType,
        items,
      });
      setResults(res.data.data);
      if (onSaveComplete) onSaveComplete(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Bulk create failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setRows([{ ...emptyRow(fields), ...defaults }]);
    setError('');
    setResults(null);
    setValidationErrors({});
    onClose();
  };

  const resetForMore = () => {
    setRows([{ ...emptyRow(fields), ...defaults }]);
    setResults(null);
    setValidationErrors({});
    setError('');
  };

  const renderCellInput = (field, rowIdx) => {
    const val = rows[rowIdx][field.key];
    const hasError = !!validationErrors[`${rowIdx}-${field.key}`];
    const style = hasError ? { borderColor: 'var(--danger)' } : {};

    if (field.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!val}
          onChange={(e) => updateCell(rowIdx, field.key, e.target.checked)}
        />
      );
    }

    if (field.type === 'select') {
      if (field.options) {
        return (
          <select
            className="form-control form-control-sm"
            value={val || ''}
            onChange={(e) => updateCell(rowIdx, field.key, e.target.value)}
            style={style}
          >
            <option value="">None</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{field.optionLabel ? field.optionLabel(opt) : opt}</option>
            ))}
          </select>
        );
      }
      if (field.refKey && referenceData[field.refKey]) {
        return (
          <select
            className="form-control form-control-sm"
            value={val || ''}
            onChange={(e) => updateCell(rowIdx, field.key, e.target.value)}
            style={style}
          >
            <option value="">--</option>
            {referenceData[field.refKey].map((item) => (
              <option key={item.id} value={String(item.id)}>
                {field.displayFn ? field.displayFn(item) : item[field.displayKey || 'name']}
              </option>
            ))}
          </select>
        );
      }
    }

    if (field.type === 'textarea') {
      return (
        <input
          className="form-control form-control-sm"
          type="text"
          value={val || ''}
          onChange={(e) => updateCell(rowIdx, field.key, e.target.value)}
          style={style}
        />
      );
    }

    return (
      <input
        className="form-control form-control-sm"
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        step={field.type === 'number' ? '0.01' : undefined}
        value={val || ''}
        onChange={(e) => updateCell(rowIdx, field.key, e.target.value)}
        style={style}
      />
    );
  };

  const content = (
    <div>
      {error && (
        <div className="alert alert-danger mb-3">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {results ? (
        <div>
          <div className="alert alert-success mb-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={16} />
            <span>Created {results.succeeded} of {results.total} items.</span>
          </div>
          {results.failed > 0 && (
            <div className="mb-3">
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
          <button className="btn btn-secondary" onClick={resetForMore}>Add More</button>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button className="btn btn-secondary btn-sm" onClick={addRow} disabled={rows.length >= MAX_ROWS}>
              <Plus size={14} /> Add Row
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handlePaste} title="Paste tab-separated data from clipboard">
              <Clipboard size={14} /> Paste
            </button>
            <span className="text-muted text-sm">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="bulk-add-table-wrapper">
            <table className="bulk-add-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  {fields.map((f) => (
                    <th key={f.key} style={{ minWidth: f.type === 'checkbox' ? 60 : 140 }}>
                      {f.label}
                      {f.required && <span className="required"> *</span>}
                    </th>
                  ))}
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="text-muted text-sm">{idx + 1}</td>
                    {fields.map((f) => (
                      <td key={f.key}>{renderCellInput(f, idx)}</td>
                    ))}
                    <td>
                      {rows.length > 1 && (
                        <button
                          className="btn btn-ghost btn-sm btn-icon text-danger"
                          onClick={() => removeRow(idx)}
                          title="Remove row"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  if (!standalone) {
    // Embedded in wizard — no modal wrapper, expose save via render
    return (
      <div>
        {content}
        {!results && (
          <div className="flex justify-end gap-2 mt-3">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : `Create ${rows.length} ${getEntityDisplayName(entityType)}`}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Bulk Add ${getEntityDisplayName(entityType)}`}
      size="xl"
      footer={
        results ? (
          <button className="btn btn-primary" onClick={handleClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Creating...' : `Create ${rows.length} ${getEntityDisplayName(entityType)}`}
            </button>
          </>
        )
      }
    >
      {content}
    </Modal>
  );
}
