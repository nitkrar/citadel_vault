import { useState, useMemo, useEffect } from 'react';
import api from '../api/client';
import Modal from './Modal';
import { ENTITY_FIELDS, getBulkEditFields, getEntityDisplayName } from '../lib/entityFieldConfigs';
import { AlertTriangle, CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react';

let _newRowId = 0;
function nextNewId() { return `new_${++_newRowId}`; }

function emptyRow(fields) {
  const row = {};
  fields.forEach((f) => {
    if (f.type === 'checkbox') row[f.key] = false;
    else row[f.key] = '';
  });
  return row;
}

/**
 * BulkEditModal — spreadsheet-like editor for multiple items.
 * Each selected item is shown as a row; every field is individually editable.
 * New rows can be added to create items alongside editing existing ones.
 *
 * Props:
 *   isOpen, onClose, entityType, selectedItems, onSaveComplete, referenceData
 */
export default function BulkEditModal({
  isOpen,
  onClose,
  entityType,
  selectedItems,
  onSaveComplete,
  referenceData = {},
}) {
  const editFields = useMemo(() => getBulkEditFields(entityType), [entityType]);
  const allFields = useMemo(() => ENTITY_FIELDS[entityType] || [], [entityType]);

  // Rows for existing items, keyed by item id
  const [rows, setRows] = useState({});
  // New rows to create, each with a temporary id
  const [newRows, setNewRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  // Initialise rows from selectedItems when the modal opens
  useEffect(() => {
    if (!isOpen || !selectedItems || selectedItems.length === 0) return;
    const init = {};
    selectedItems.forEach((item) => {
      const row = {};
      editFields.forEach((f) => {
        const val = item[f.key];
        if (f.type === 'checkbox') {
          row[f.key] = !!val;
        } else if (f.type === 'select' && f.refKey) {
          row[f.key] = val != null ? String(val) : '';
        } else {
          row[f.key] = val != null ? String(val) : '';
        }
      });
      init[item.id] = row;
    });
    setRows(init);
    setNewRows([]);
  }, [isOpen, selectedItems, editFields]);

  const updateCell = (id, key, value) => {
    setRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));
  };

  const updateNewCell = (tempId, key, value) => {
    setNewRows((prev) => prev.map((r) => r._id === tempId ? { ...r, [key]: value } : r));
    setValidationErrors((prev) => {
      const k = `${tempId}-${key}`;
      if (prev[k]) { const next = { ...prev }; delete next[k]; return next; }
      return prev;
    });
  };

  const addNewRow = () => {
    setNewRows((prev) => [...prev, { _id: nextNewId(), ...emptyRow(allFields) }]);
  };

  const removeNewRow = (tempId) => {
    setNewRows((prev) => prev.filter((r) => r._id !== tempId));
  };

  // Compute which fields actually changed per existing item
  const getChangedFields = (item) => {
    const row = rows[item.id];
    if (!row) return {};
    const changed = {};
    editFields.forEach((f) => {
      const original = item[f.key];
      const current = row[f.key];

      if (f.type === 'checkbox') {
        const origBool = !!original;
        if (current !== origBool) {
          changed[f.key] = current ? 1 : 0;
        }
      } else if (f.type === 'number') {
        const origStr = original != null ? String(original) : '';
        if (current !== origStr) {
          changed[f.key] = current !== '' ? parseFloat(current) : null;
        }
      } else if (f.type === 'select' && f.refKey) {
        const origStr = original != null ? String(original) : '';
        if (current !== origStr) {
          changed[f.key] = current ? parseInt(current, 10) : null;
        }
      } else if (f.type === 'date') {
        const origStr = original || '';
        if (current !== origStr) {
          changed[f.key] = current || null;
        }
      } else {
        const origStr = original != null ? String(original) : '';
        if (current !== origStr) {
          changed[f.key] = current || null;
        }
      }
    });
    return changed;
  };

  const changedCount = useMemo(() => {
    if (!selectedItems) return 0;
    return selectedItems.filter((item) => Object.keys(getChangedFields(item)).length > 0).length;
  }, [rows, selectedItems, editFields]);

  const buildNewItemPayload = (row) => {
    const item = {};
    allFields.forEach((f) => {
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
  };

  const handleSave = async () => {
    setError('');
    setValidationErrors({});

    // Validate required fields on non-empty new rows
    const nonEmptyNewRows = newRows.filter((r) =>
      allFields.some((f) => {
        const v = r[f.key];
        return f.type === 'checkbox' ? v === true : v !== '' && v !== undefined && v !== null;
      })
    );
    const vErrors = {};
    let hasVErrors = false;
    nonEmptyNewRows.forEach((row) => {
      allFields.forEach((f) => {
        if (f.required && (row[f.key] === '' || row[f.key] === null || row[f.key] === undefined)) {
          vErrors[`${row._id}-${f.key}`] = true;
          hasVErrors = true;
        }
      });
    });
    if (hasVErrors) {
      setValidationErrors(vErrors);
      setError('Please fill in all required fields (highlighted in red) on new rows.');
      return;
    }

    // Build update payloads for existing items
    const updateItems = [];
    selectedItems.forEach((item) => {
      const changed = getChangedFields(item);
      if (Object.keys(changed).length > 0) {
        updateItems.push({ id: item.id, fields: changed });
      }
    });

    // Build create payloads for new rows
    // Skip empty new rows (all fields blank)
    const createItems = newRows
      .filter((r) => allFields.some((f) => {
        const v = r[f.key];
        return f.type === 'checkbox' ? v === true : v !== '' && v !== undefined && v !== null;
      }))
      .map((r) => buildNewItemPayload(r));

    if (updateItems.length === 0 && createItems.length === 0) {
      setError('No changes or new items to save.');
      return;
    }

    setSaving(true);
    try {
      const allResults = { total: 0, succeeded: 0, failed: 0, results: [] };

      // Send updates
      if (updateItems.length > 0) {
        const res = await api.post('/bulk.php?action=update', {
          entity: entityType,
          items: updateItems,
        });
        const d = res.data.data;
        allResults.total += d.total;
        allResults.succeeded += d.succeeded;
        allResults.failed += d.failed;
        allResults.results.push(...d.results.map((r) => ({ ...r, action: 'updated' })));
      }

      // Send creates
      if (createItems.length > 0) {
        const res = await api.post('/bulk.php?action=create', {
          entity: entityType,
          items: createItems,
        });
        const d = res.data.data;
        allResults.total += d.total;
        allResults.succeeded += d.succeeded;
        allResults.failed += d.failed;
        allResults.results.push(...d.results.map((r) => ({ ...r, action: 'created' })));
      }

      setResults(allResults);
      if (onSaveComplete) onSaveComplete();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setRows({});
    setNewRows([]);
    setError('');
    setResults(null);
    setValidationErrors({});
    onClose();
  };

  const renderCellInput = (field, itemId) => {
    const val = rows[itemId]?.[field.key] ?? '';

    if (field.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!rows[itemId]?.[field.key]}
          onChange={(e) => updateCell(itemId, field.key, e.target.checked)}
        />
      );
    }

    if (field.type === 'select') {
      if (field.options) {
        return (
          <select
            className="form-control form-control-sm"
            value={val}
            onChange={(e) => updateCell(itemId, field.key, e.target.value)}
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
            value={val}
            onChange={(e) => updateCell(itemId, field.key, e.target.value)}
          >
            <option value="">{field.nullable ? 'None' : '--'}</option>
            {referenceData[field.refKey].map((item) => (
              <option key={item.id} value={String(item.id)}>
                {field.displayFn ? field.displayFn(item) : item[field.displayKey || 'name']}
              </option>
            ))}
          </select>
        );
      }
    }

    return (
      <input
        className="form-control form-control-sm"
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        step={field.type === 'number' ? '0.01' : undefined}
        value={val}
        onChange={(e) => updateCell(itemId, field.key, e.target.value)}
      />
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Bulk Edit ${getEntityDisplayName(entityType)}`}
      size="xl"
      footer={
        results ? (
          <button className="btn btn-primary" onClick={handleClose}>Done</button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || (changedCount === 0 && newRows.length === 0)}>
              {saving ? 'Saving...' : `Save${changedCount > 0 ? ` ${changedCount} Updated` : ''}${changedCount > 0 && newRows.length > 0 ? ' +' : ''}${newRows.length > 0 ? ` ${newRows.length} New` : ''}`}
            </button>
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

      {results ? (
        <div>
          <div className="alert alert-success mb-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={16} />
            <span>Saved {results.succeeded} of {results.total} items.</span>
          </div>
          {results.failed > 0 && (
            <div className="mb-3">
              {results.results
                .filter((r) => !r.success)
                .map((r, i) => (
                  <div key={r.id ?? r.index ?? i} className="alert alert-danger" style={{ padding: '6px 12px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <XCircle size={14} />
                    <span>{r.action === 'created' ? `New row ${(r.index ?? 0) + 1}` : `ID ${r.id}`}: {r.error}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <p className="text-muted" style={{ fontSize: 13, margin: 0, flex: 1 }}>
              {selectedItems?.length || 0} existing item{(selectedItems?.length || 0) !== 1 ? 's' : ''}{newRows.length > 0 ? `, ${newRows.length} new` : ''}.
              {changedCount > 0 && ` ${changedCount} modified.`}
            </p>
            <button className="btn btn-secondary btn-sm" onClick={addNewRow}>
              <Plus size={14} /> Add Row
            </button>
          </div>

          <div className="bulk-add-table-wrapper">
            <table className="bulk-add-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  {allFields.map((f) => (
                    <th key={f.key} style={{ minWidth: f.type === 'checkbox' ? 60 : 140 }}>
                      {f.label}
                    </th>
                  ))}
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {/* Existing items */}
                {(selectedItems || []).map((item, idx) => {
                  const hasChanges = Object.keys(getChangedFields(item)).length > 0;
                  return (
                    <tr key={item.id} style={hasChanges ? { background: 'var(--color-primary-light)' } : undefined}>
                      <td className="text-muted text-sm">{idx + 1}</td>
                      {allFields.map((f) => {
                        // For fields not in editFields (e.g. password for vault), show read-only
                        const inEdit = editFields.some((ef) => ef.key === f.key);
                        if (!inEdit) {
                          return <td key={f.key} className="text-muted text-sm" style={{ opacity: 0.5 }}>--</td>;
                        }
                        return <td key={f.key}>{renderCellInput(f, item.id)}</td>;
                      })}
                      <td></td>
                    </tr>
                  );
                })}
                {/* New rows */}
                {newRows.map((row, idx) => (
                  <tr key={row._id} style={{ background: 'var(--color-success-light)' }}>
                    <td className="text-sm" style={{ color: 'var(--success)', fontWeight: 600 }}>+</td>
                    {allFields.map((f) => {
                      const val = row[f.key] ?? '';
                      const hasErr = !!validationErrors[`${row._id}-${f.key}`];
                      const errStyle = hasErr ? { borderColor: 'var(--danger)' } : {};
                      if (f.type === 'checkbox') {
                        return (
                          <td key={f.key}>
                            <input type="checkbox" checked={!!row[f.key]} onChange={(e) => updateNewCell(row._id, f.key, e.target.checked)} />
                          </td>
                        );
                      }
                      if (f.type === 'select') {
                        if (f.options) {
                          return (
                            <td key={f.key}>
                              <select className="form-control form-control-sm" style={errStyle} value={val} onChange={(e) => updateNewCell(row._id, f.key, e.target.value)}>
                                <option value="">None</option>
                                {f.options.map((opt) => <option key={opt} value={opt}>{f.optionLabel ? f.optionLabel(opt) : opt}</option>)}
                              </select>
                            </td>
                          );
                        }
                        if (f.refKey && referenceData[f.refKey]) {
                          return (
                            <td key={f.key}>
                              <select className="form-control form-control-sm" style={errStyle} value={val} onChange={(e) => updateNewCell(row._id, f.key, e.target.value)}>
                                <option value="">{f.nullable ? 'None' : '--'}</option>
                                {referenceData[f.refKey].map((item) => (
                                  <option key={item.id} value={String(item.id)}>{f.displayFn ? f.displayFn(item) : item[f.displayKey || 'name']}</option>
                                ))}
                              </select>
                            </td>
                          );
                        }
                      }
                      return (
                        <td key={f.key}>
                          <input className="form-control form-control-sm" style={errStyle}
                            type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                            step={f.type === 'number' ? '0.01' : undefined}
                            value={val} onChange={(e) => updateNewCell(row._id, f.key, e.target.value)} />
                        </td>
                      );
                    })}
                    <td>
                      <button className="btn btn-ghost btn-sm btn-icon text-danger" onClick={() => removeNewRow(row._id)} title="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
