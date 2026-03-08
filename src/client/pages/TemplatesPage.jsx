import { useState, useCallback } from 'react';
import { Layers, Plus, Edit2, Trash2, Lock, AlertTriangle, ArrowUp, Globe, User } from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useEncryption } from '../contexts/EncryptionContext';
import useVaultData from '../hooks/useVaultData';
import { apiData } from '../lib/checks';

const FIELD_TYPES = ['text', 'secret', 'url', 'textarea', 'number', 'date'];

export default function TemplatesPage() {
  const { isUnlocked } = useEncryption();
  const [tab, setTab] = useState('global');
  const [showAdd, setShowAdd] = useState(false);
  const [editTemplate, setEditTemplate] = useState(null);

  // Form
  const [form, setForm] = useState({ template_key: 'custom', name: '', icon: '', fields: [] });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // ── Fetch templates ──────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    const { data: resp } = await api.get('/templates.php');
    return apiData({ data: resp }) || [];
  }, []);

  const { data: templates, loading, refetch } = useVaultData(fetchTemplates, []);

  const globalTemplates = templates.filter(t => !t.owner_id);
  const myTemplates = templates.filter(t => t.owner_id);

  // ── Field editor ─────────────────────────────────────────────────
  const addField = () => {
    setForm(f => ({ ...f, fields: [...f.fields, { key: '', label: '', type: 'text', required: false }] }));
  };

  const updateField = (index, prop, value) => {
    setForm(f => {
      const fields = [...f.fields];
      fields[index] = { ...fields[index], [prop]: value };
      // Auto-generate key from label
      if (prop === 'label' && !fields[index].key) {
        fields[index].key = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
      }
      return { ...f, fields };
    });
  };

  const removeField = (index) => {
    setForm(f => ({ ...f, fields: f.fields.filter((_, i) => i !== index) }));
  };

  // ── Save template ────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    if (form.fields.length === 0) { setFormError('Add at least one field.'); return; }
    for (const f of form.fields) {
      if (!f.key || !f.label) { setFormError('All fields need a key and label.'); return; }
    }

    setSaving(true);
    try {
      if (editTemplate) {
        await api.put(`/templates.php?action=update&id=${editTemplate.id}`, {
          name: form.name,
          icon: form.icon || null,
          fields: form.fields,
        });
      } else {
        await api.post('/templates.php?action=create', {
          template_key: form.template_key || 'custom',
          name: form.name,
          icon: form.icon || null,
          fields: form.fields,
        });
      }
      setShowAdd(false);
      setEditTemplate(null);
      setForm({ template_key: 'custom', name: '', icon: '', fields: [] });
      refetch();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (template) => {
    const fields = typeof template.fields === 'string' ? JSON.parse(template.fields) : (template.fields || []);
    setForm({ template_key: template.template_key, name: template.name, icon: template.icon || '', fields });
    setEditTemplate(template);
    setFormError('');
  };

  const handleRequestPromotion = async (templateId) => {
    try {
      await api.post(`/templates.php?action=request-promotion&id=${templateId}`);
      refetch();
      alert('Promotion requested.');
    } catch (err) {
      alert(err.response?.data?.error || 'Request failed.');
    }
  };

  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state"><Lock size={40} className="empty-icon" /><h3>Vault is locked</h3></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Templates</h1><p className="page-subtitle">Manage entry field templates</p></div>
        <button className="btn btn-primary" onClick={() => { setShowAdd(true); setEditTemplate(null); setForm({ template_key: 'custom', name: '', icon: '', fields: [{ key: 'title', label: 'Title', type: 'text', required: true }] }); setFormError(''); }}>
          <Plus size={16} /> New Template
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button className={`btn btn-sm ${tab === 'global' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('global')}><Globe size={14} /> Global ({globalTemplates.length})</button>
        <button className={`btn btn-sm ${tab === 'mine' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('mine')}><User size={14} /> My Templates ({myTemplates.length})</button>
      </div>

      {loading ? <div className="loading-center"><div className="spinner" /></div> : (
        <div className="card"><div className="table-wrapper"><table>
          <thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Subtype</th><th>Fields</th><th>Actions</th></tr></thead>
          <tbody>
            {(tab === 'global' ? globalTemplates : myTemplates).map(t => {
              const fields = typeof t.fields === 'string' ? JSON.parse(t.fields) : (t.fields || []);
              return (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td><span className="badge">{t.template_key}</span></td>
                  <td>{t.country_code || '--'}</td>
                  <td>{t.subtype || '--'}</td>
                  <td>{fields.length} fields</td>
                  <td>
                    <div className="td-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}><Edit2 size={14} /></button>
                      {t.owner_id && (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleRequestPromotion(t.id)} title="Request promotion to global"><ArrowUp size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div></div>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={showAdd || !!editTemplate} onClose={() => { setShowAdd(false); setEditTemplate(null); }} title={editTemplate ? 'Edit Template' : 'New Template'}>
        <form onSubmit={handleSave}>
          {formError && <div className="alert alert-danger mb-3">{formError}</div>}
          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Icon (lucide icon name)</label>
            <input className="form-control" value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="e.g. key, bank, shield" />
          </div>

          <h4 style={{ marginTop: 16, marginBottom: 8 }}>Fields</h4>
          {form.fields.map((field, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
              <input className="form-control" placeholder="Label" value={field.label} onChange={e => updateField(i, 'label', e.target.value)} style={{ flex: 2 }} />
              <input className="form-control" placeholder="key" value={field.key} onChange={e => updateField(i, 'key', e.target.value)} style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }} />
              <select className="form-control" value={field.type} onChange={e => updateField(i, 'type', e.target.value)} style={{ flex: 1 }}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={field.required || false} onChange={e => updateField(i, 'required', e.target.checked)} /> Req
              </label>
              <button type="button" className="btn btn-ghost btn-icon text-danger" onClick={() => removeField(i)}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addField}><Plus size={14} /> Add Field</button>

          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => { setShowAdd(false); setEditTemplate(null); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : editTemplate ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
