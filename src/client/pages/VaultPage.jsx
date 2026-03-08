import { useState, useMemo, useCallback, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useEncryption } from '../contexts/EncryptionContext';
import { entryStore } from '../lib/entryStore';
import { VALID_ENTRY_TYPES } from '../lib/defaults';
import { apiData } from '../lib/checks';
import ImportModal from '../components/ImportModal';
import {
  Plus, Edit2, Trash2, Search, Eye, EyeOff, Copy, Check, Lock,
  KeyRound, RefreshCw, AlertTriangle, Undo2, X, ChevronDown, Upload,
  Landmark, Briefcase, FileText, Shield, Layers,
} from 'lucide-react';

const TYPE_META = {
  password:  { icon: KeyRound,  label: 'Passwords',  color: '#3b82f6' },
  account:   { icon: Landmark,  label: 'Accounts',   color: '#22c55e' },
  asset:     { icon: Briefcase, label: 'Assets',      color: '#f59e0b' },
  license:   { icon: FileText,  label: 'Licenses',    color: '#8b5cf6' },
  insurance: { icon: Shield,    label: 'Insurance',   color: '#ec4899' },
  custom:    { icon: Layers,    label: 'Custom',      color: '#06b6d4' },
};

function generatePassword(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => chars[v % chars.length]).join('');
}

export default function VaultPage() {
  const { isUnlocked, encrypt, decrypt } = useEncryption();

  const [entries, setEntries] = useState([]);
  const [decryptedCache, setDecryptedCache] = useState({});
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [activeType, setActiveType] = useState('all');
  const [search, setSearch] = useState('');

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deletedEntries, setDeletedEntries] = useState([]);

  // Form state
  const [form, setForm] = useState({});
  const [formType, setFormType] = useState('password');
  const [formTemplateId, setFormTemplateId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // ── Load data from IndexedDB ─────────────────────────────────────
  const loadEntries = useCallback(async () => {
    if (!isUnlocked) { setEntries([]); setDecryptedCache({}); setLoading(false); return; }
    setLoading(true);
    try {
      const raw = await entryStore.getAll();
      const tpl = await entryStore.getAllTemplates();
      setTemplates(tpl);

      // Decrypt all entries
      const cache = {};
      for (const entry of raw) {
        try {
          cache[entry.id] = await decrypt(entry.data);
        } catch {
          cache[entry.id] = null;
        }
      }
      setEntries(raw);
      setDecryptedCache(cache);
    } catch (err) {
      setError('Failed to load entries.');
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, decrypt]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // ── Refresh from server ──────────────────────────────────────────
  const refetch = useCallback(async () => {
    const { data: resp } = await api.get('/vault.php');
    const raw = apiData({ data: resp }) || [];
    await entryStore.putAll(raw);
    // Re-decrypt
    const cache = {};
    for (const entry of raw) {
      try { cache[entry.id] = await decrypt(entry.data); } catch { cache[entry.id] = null; }
    }
    setEntries(raw);
    setDecryptedCache(cache);
  }, [decrypt]);

  // ── Filtering ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = entries;
    if (activeType !== 'all') list = list.filter(e => e.entry_type === activeType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => {
        const d = decryptedCache[e.id];
        if (!d) return false;
        return Object.values(d).some(v => typeof v === 'string' && v.toLowerCase().includes(q));
      });
    }
    return list;
  }, [entries, activeType, search, decryptedCache]);

  // ── Counts ───────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: entries.length };
    VALID_ENTRY_TYPES.forEach(t => { c[t] = entries.filter(e => e.entry_type === t).length; });
    return c;
  }, [entries]);

  // ── Get template fields for an entry ─────────────────────────────
  const getTemplateFields = (entry) => {
    if (entry.template?.fields) return entry.template.fields;
    const tpl = templates.find(t => t.id === entry.template_id);
    return tpl?.fields || [];
  };

  // ── CRUD Operations ──────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.title?.trim()) { setFormError('Title is required.'); return; }

    setSaving(true);
    try {
      const blob = await encrypt(form);
      const { data: resp } = await api.post('/vault.php', {
        entry_type: formType,
        template_id: formTemplateId,
        encrypted_data: blob,
      });
      const newId = apiData({ data: resp })?.id;
      // Add to local store
      const newEntry = { id: newId, entry_type: formType, template_id: formTemplateId, data: blob, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await entryStore.put(newEntry);
      setDecryptedCache(prev => ({ ...prev, [newId]: form }));
      setEntries(prev => [newEntry, ...prev]);
      setShowAdd(false);
      setForm({});
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to create.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.title?.trim()) { setFormError('Title is required.'); return; }

    setSaving(true);
    try {
      const blob = await encrypt(form);
      await api.put(`/vault.php?id=${editEntry.id}`, { encrypted_data: blob });
      // Update local
      const updated = { ...editEntry, data: blob, updated_at: new Date().toISOString() };
      await entryStore.put(updated);
      setDecryptedCache(prev => ({ ...prev, [editEntry.id]: form }));
      setEntries(prev => prev.map(e => e.id === editEntry.id ? updated : e));
      setEditEntry(null);
      setForm({});
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete "${decryptedCache[entry.id]?.title || 'this entry'}"? It will be recoverable for 24 hours.`)) return;
    try {
      await api.delete(`/vault.php?id=${entry.id}`);
      await entryStore.delete(entry.id);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed.');
    }
  };

  const loadDeleted = async () => {
    try {
      const { data: resp } = await api.get('/vault.php?action=deleted');
      const raw = apiData({ data: resp }) || [];
      // Decrypt deleted entries
      const decrypted = [];
      for (const entry of raw) {
        try {
          const d = await decrypt(entry.data);
          decrypted.push({ ...entry, _decrypted: d });
        } catch {
          decrypted.push({ ...entry, _decrypted: null });
        }
      }
      setDeletedEntries(decrypted);
      setShowDeleted(true);
    } catch {}
  };

  const handleRestore = async (entry) => {
    try {
      await api.post(`/vault.php?action=restore&id=${entry.id}`);
      setDeletedEntries(prev => prev.filter(e => e.id !== entry.id));
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Restore failed.');
    }
  };

  // ── Open edit modal ──────────────────────────────────────────────
  const openEdit = (entry) => {
    const d = decryptedCache[entry.id];
    if (!d) return;
    setForm({ ...d });
    setFormType(entry.entry_type);
    setFormTemplateId(entry.template_id);
    setEditEntry(entry);
    setFormError('');
  };

  const openAdd = (type = 'password') => {
    setFormType(type);
    const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
    setFormTemplateId(tpl?.id || null);
    setForm({ title: '' });
    setShowAdd(true);
    setFormError('');
  };

  // ── Template-driven form rendering ───────────────────────────────
  const renderFormFields = (fields) => {
    if (!fields || fields.length === 0) {
      return (
        <>
          <div className="form-group">
            <label className="form-label">Title <span className="required">*</span></label>
            <input className="form-control" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={3} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </>
      );
    }

    return fields.map(field => (
      <div className="form-group" key={field.key}>
        <label className="form-label">
          {field.label} {field.required && <span className="required">*</span>}
        </label>
        {field.type === 'textarea' ? (
          <textarea className="form-control" rows={3} value={form[field.key] || ''}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
        ) : field.type === 'secret' ? (
          <div className="flex gap-1">
            <input className="form-control" type="text" value={form[field.key] || ''}
              onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} style={{ flex: 1 }} />
            {field.key === 'password' && (
              <button type="button" className="btn btn-secondary btn-icon"
                onClick={() => setForm(f => ({ ...f, [field.key]: generatePassword() }))} title="Generate">
                <RefreshCw size={16} />
              </button>
            )}
          </div>
        ) : field.type === 'date' ? (
          <input className="form-control" type="date" value={form[field.key] || ''}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
        ) : field.type === 'number' ? (
          <input className="form-control" type="number" step="any" value={form[field.key] || ''}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
        ) : field.type === 'url' ? (
          <input className="form-control" type="url" value={form[field.key] || ''} placeholder="https://..."
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
        ) : (
          <input className="form-control" type="text" value={form[field.key] || ''}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
        )}
      </div>
    ));
  };

  // ── Get fields for current form type ─────────────────────────────
  const getFormFields = () => {
    if (formTemplateId) {
      const tpl = templates.find(t => t.id === formTemplateId);
      if (tpl?.fields) return typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields;
    }
    if (editEntry) return getTemplateFields(editEntry);
    return [];
  };

  // ── Vault locked state ───────────────────────────────────────────
  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>Unlock your vault to access your data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vault</h1>
          <p className="page-subtitle">All your encrypted entries in one place</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={loadDeleted}><Undo2 size={14} /> Recently Deleted</button>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Import</button>
          <button className="btn btn-primary" onClick={() => openAdd(activeType !== 'all' ? activeType : 'password')}><Plus size={16} /> New Entry</button>
        </div>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${activeType === 'all' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveType('all')}>
          All <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts.all}</span>
        </button>
        {VALID_ENTRY_TYPES.map(type => {
          const meta = TYPE_META[type];
          const Icon = meta?.icon || Layers;
          return (
            <button key={type} className={`btn btn-sm ${activeType === type ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveType(type)}>
              <Icon size={14} /> {meta?.label || type}
              {counts[type] > 0 && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts[type]}</span>}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-4">
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input className="form-control" style={{ paddingLeft: 32 }} placeholder="Search across all fields..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Content */}
      {error ? (
        <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{error}</span></div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{activeType !== 'all' ? (() => { const Icon = TYPE_META[activeType]?.icon || Layers; return <Icon size={40} />; })() : <KeyRound size={40} />}</div>
          <h3>{search ? 'No results' : `No ${activeType !== 'all' ? TYPE_META[activeType]?.label?.toLowerCase() || 'entries' : 'entries'} yet`}</h3>
          <p>{search ? 'Try a different search.' : 'Add your first entry to get started.'}</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Type</th>
                  <th>Title</th>
                  <th>Details</th>
                  <th style={{ width: 140 }}>Updated</th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => {
                  const d = decryptedCache[entry.id];
                  const meta = TYPE_META[entry.entry_type] || TYPE_META.custom;
                  const Icon = meta.icon;
                  const title = d?.title || '(encrypted)';
                  // Show first non-title, non-notes field as detail
                  const fields = getTemplateFields(entry);
                  const detailField = fields.find(f => f.key !== 'title' && f.key !== 'notes' && f.type !== 'textarea' && f.type !== 'secret' && d?.[f.key]);
                  const detail = detailField ? d[detailField.key] : '';

                  return (
                    <tr key={entry.id} style={{ cursor: 'pointer' }} onClick={() => { setViewEntry(entry); }}>
                      <td><Icon size={16} style={{ color: meta.color }} /></td>
                      <td><span className="font-medium">{title}</span></td>
                      <td><span className="text-muted">{typeof detail === 'string' ? (detail.length > 40 ? detail.slice(0, 40) + '...' : detail) : ''}</span></td>
                      <td><span className="text-muted" style={{ fontSize: 13 }}>{entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '--'}</span></td>
                      <td>
                        <div className="td-actions">
                          <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setViewEntry(entry); }}><Eye size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(entry); }}><Edit2 size={14} /></button>
                          <button className="btn btn-ghost btn-sm text-danger" onClick={e => { e.stopPropagation(); handleDelete(entry); }}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Modal */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title={`Add ${TYPE_META[formType]?.label?.replace(/s$/, '') || 'Entry'}`}>
        <form onSubmit={handleCreate}>
          {formError && <div className="alert alert-danger mb-3">{formError}</div>}
          {/* Type selector */}
          <div className="form-group">
            <label className="form-label">Entry Type</label>
            <select className="form-control" value={formType} onChange={e => {
              const type = e.target.value;
              setFormType(type);
              const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
              setFormTemplateId(tpl?.id || null);
              setForm({ title: form.title || '' });
            }}>
              {VALID_ENTRY_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
            </select>
          </div>
          {/* Template selector (if subtypes available) */}
          {(() => {
            const subtypes = templates.filter(t => t.template_key === formType && !t.owner_id && (t.subtype || t.country_code));
            if (subtypes.length === 0) return null;
            return (
              <div className="form-group">
                <label className="form-label">Template</label>
                <select className="form-control" value={formTemplateId || ''} onChange={e => {
                  const id = e.target.value ? parseInt(e.target.value) : null;
                  setFormTemplateId(id);
                  setForm({ title: form.title || '' });
                }}>
                  <option value="">Generic</option>
                  {subtypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.country_code ? ` (${t.country_code})` : ''}</option>)}
                </select>
              </div>
            );
          })()}
          {renderFormFields(getFormFields())}
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editEntry} onClose={() => setEditEntry(null)} title="Edit Entry">
        <form onSubmit={handleUpdate}>
          {formError && <div className="alert alert-danger mb-3">{formError}</div>}
          {renderFormFields(getFormFields())}
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => setEditEntry(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Update'}</button>
          </div>
        </form>
      </Modal>

      {/* View Modal */}
      <Modal isOpen={!!viewEntry} onClose={() => setViewEntry(null)} title={decryptedCache[viewEntry?.id]?.title || 'Entry Details'}>
        {viewEntry && (() => {
          const d = decryptedCache[viewEntry.id];
          if (!d) return <p className="text-muted">Unable to decrypt this entry.</p>;
          const fields = getTemplateFields(viewEntry);
          if (fields.length === 0) {
            // Fallback: show raw JSON keys
            return Object.entries(d).map(([k, v]) => (
              <div key={k} className="form-group">
                <label className="form-label" style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</label>
                <div className="form-control-static">{typeof v === 'string' ? v : JSON.stringify(v)}</div>
              </div>
            ));
          }
          return fields.map(field => {
            const val = d[field.key];
            if (val === undefined || val === null || val === '') return null;
            return (
              <FieldDisplay key={field.key} field={field} value={val} />
            );
          });
        })()}
        {viewEntry && (
          <div className="flex gap-2 mt-4">
            <button className="btn btn-secondary" onClick={() => { openEdit(viewEntry); setViewEntry(null); }}><Edit2 size={14} /> Edit</button>
            <button className="btn btn-danger" onClick={() => { handleDelete(viewEntry); setViewEntry(null); }}><Trash2 size={14} /> Delete</button>
          </div>
        )}
      </Modal>

      {/* Recently Deleted Modal */}
      <Modal isOpen={showDeleted} onClose={() => setShowDeleted(false)} title="Recently Deleted">
        {deletedEntries.length === 0 ? (
          <p className="text-muted">No recently deleted entries. Items are permanently removed after 24 hours.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Title</th><th>Type</th><th>Deleted</th><th>Action</th></tr></thead>
              <tbody>
                {deletedEntries.map(entry => (
                  <tr key={entry.id}>
                    <td>{entry._decrypted?.title || '(encrypted)'}</td>
                    <td><span className="badge">{entry.entry_type}</span></td>
                    <td style={{ fontSize: 13 }}>{new Date(entry.deleted_at).toLocaleString()}</td>
                    <td><button className="btn btn-sm btn-secondary" onClick={() => handleRestore(entry)}><Undo2 size={14} /> Restore</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Import Modal */}
      <ImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        defaultType={activeType !== 'all' ? activeType : undefined}
        onImportComplete={refetch}
      />
    </div>
  );
}

/** Display a single field value with copy support for secrets */
function FieldDisplay({ field, value }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const t = document.createElement('textarea'); t.value = value; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isSecret = field.type === 'secret';

  return (
    <div className="form-group">
      <label className="form-label">{field.label}</label>
      <div className="flex items-center gap-2">
        {field.type === 'url' ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="form-control-static" style={{ wordBreak: 'break-all' }}>{value}</a>
        ) : (
          <span className="form-control-static" style={{ flex: 1, fontFamily: isSecret ? 'monospace' : 'inherit' }}>
            {isSecret && !visible ? '••••••••' : value}
          </span>
        )}
        {isSecret && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setVisible(!visible)} title={visible ? 'Hide' : 'Show'}>
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" onClick={handleCopy} title="Copy">
          {copied ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
