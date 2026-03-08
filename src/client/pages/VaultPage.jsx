import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import VaultEntryDetailModal from '../components/VaultEntryDetailModal';
import BulkEditModal from '../components/BulkEditModal';
import BulkAddModal from '../components/BulkAddModal';
import ImportModal from '../components/ImportModal';
import useVaultData from '../hooks/useVaultData';
import useCrudModal from '../hooks/useCrudModal';
import useSelection from '../hooks/useSelection';
import useSort from '../hooks/useSort';
import { useEncryption } from '../contexts/EncryptionContext';
import { isTruthy } from '../lib/checks';
import SortableTh from '../components/SortableTh';
import {
  Plus, Edit2, Trash2, Search, Star, Eye, EyeOff,
  Copy, Check, Lock, KeyRound, RefreshCw, AlertTriangle, Upload, Table2, X,
} from 'lucide-react';

const EMPTY_FORM = { title: '', website_url: '', username: '', password: '', notes: '', category: 'General', is_favourite: false };

function generatePassword(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => chars[v % chars.length]).join('');
}

export default function VaultPage() {
  const { vaultUnlocked } = useEncryption();
  const vaultLocked = !isTruthy(vaultUnlocked);

  // Primary data via useVaultData
  const fetchEntries = useCallback(
    () => api.get('/vault.php').then((r) => r.data.data || []),
    []
  );
  const { data: entries, loading, errorMessage, refetch, setData: setEntries } = useVaultData(fetchEntries, []);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Bulk operations
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Modal state via useCrudModal
  const crud = useCrudModal('vault_form', EMPTY_FORM);

  const categories = useMemo(() => [...new Set(entries.map((e) => e.category).filter(Boolean))].sort(), [entries]);
  const filtered = useMemo(() => {
    let list = entries;
    if (filterCategory) list = list.filter((e) => e.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((e) => (e.title || '').toLowerCase().includes(q) || (e.website_url || '').toLowerCase().includes(q) || (e.category || '').toLowerCase().includes(q));
    }
    return list;
  }, [entries, search, filterCategory]);
  // Sorting
  const { sorted, sortKey, sortDir, onSort } = useSort(filtered, 'title', 'asc');

  const favourites = useMemo(() => sorted.filter((e) => Number(e.is_favourite) === 1), [sorted]);

  const selection = useSelection(filtered);

  const handleBulkDelete = async () => {
    const items = selection.getSelectedItems();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} selected entr${items.length !== 1 ? 'ies' : 'y'}? This cannot be undone.`)) return;
    try {
      await api.post('/bulk.php?action=delete', { entity: 'vault', ids: items.map((i) => i.id) });
      selection.clearSelection();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk delete failed.');
    }
  };

  const toggleFavourite = async (entry) => {
    const val = Number(entry.is_favourite) === 1 ? 0 : 1;
    try { await api.put(`/vault.php?id=${entry.id}`, { is_favourite: val }); setEntries((p) => p.map((e) => e.id === entry.id ? { ...e, is_favourite: val } : e)); } catch {}
  };

  const deleteEntry = async (entry) => {
    if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
    try { await api.delete(`/vault.php?id=${entry.id}`); setEntries((p) => p.filter((e) => e.id !== entry.id)); } catch {}
  };

  // Async openEdit — fetches decrypted data from API
  const openEdit = async (entry) => {
    crud.setFormError('');
    try {
      const { data } = await api.get(`/vault.php?id=${entry.id}`);
      const d = data.data;
      crud.openEdit(entry, () => ({
        title: d.title || '', website_url: d.website_url || '', username: d.username || '', password: d.password || '', notes: d.notes || '', category: d.category || 'General', is_favourite: Number(d.is_favourite) === 1,
      }));
    } catch {
      crud.openEdit(entry, (e) => ({
        title: e.title || '', website_url: e.website_url || '', username: '', password: '', notes: '', category: e.category || 'General', is_favourite: Number(e.is_favourite) === 1,
      }));
    }
  };

  const openView = (entry) => {
    crud.setDetailItem(entry);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    crud.setFormError('');
    if (!crud.form.title.trim()) { crud.setFormError('Title is required.'); return; }
    if (!crud.form.password.trim()) { crud.setFormError('Password is required.'); return; }
    crud.setSaving(true);
    try {
      const payload = { title: crud.form.title, website_url: crud.form.website_url, username: crud.form.username, password: crud.form.password, notes: crud.form.notes, category: crud.form.category || 'General', is_favourite: crud.form.is_favourite ? 1 : 0 };
      if (crud.editItem) await api.put(`/vault.php?id=${crud.editItem.id}`, payload);
      else await api.post('/vault.php', payload);
      crud.clearDraft(); crud.closeModal(); refetch();
    } catch (err) { crud.setFormError(err.response?.data?.error || 'Failed to save entry.'); }
    finally { crud.setSaving(false); }
  };

  const updateField = (field, value) => crud.setField(field, value);

  const renderEntryRow = (entry) => (
    <tr key={entry.id} className={selection.isSelected(entry.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => openView(entry)}>
      <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selection.isSelected(entry.id)} onChange={() => selection.toggle(entry.id)} />
      </td>
      <td><div className="flex items-center gap-2"><KeyRound size={16} className="text-muted" /><span className="font-medium">{entry.title}</span></div></td>
      <td>{entry.website_url ? <a href={entry.website_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{entry.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : <span className="text-muted">--</span>}</td>
      <td>{entry.category && <span className="badge badge-primary">{entry.category}</span>}</td>
      <td><button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); toggleFavourite(entry); }} title="Toggle favourite"><Star size={16} fill={Number(entry.is_favourite) === 1 ? '#f59e0b' : 'none'} color={Number(entry.is_favourite) === 1 ? '#f59e0b' : 'currentColor'} /></button></td>
      <td><div className="td-actions">
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openView(entry); }}><Eye size={14} /> View</button>
        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(entry); }}><Edit2 size={14} /> Edit</button>
        <button className="btn btn-ghost btn-sm text-danger" onClick={(e) => { e.stopPropagation(); deleteEntry(entry); }}><Trash2 size={14} /></button>
      </div></td>
    </tr>
  );

  const renderTable = (rows, label) => {
    if (rows.length === 0) return null;
    return (
      <div className="card mb-4">
        <div className="card-header"><h3 className="card-title">{label}</h3><span className="badge badge-muted">{rows.length}</span></div>
        <div className="table-wrapper">
          <table>
            <thead><tr>
              <th className="th-checkbox">
                <input type="checkbox" checked={selection.isAllSelected(rows)}
                  ref={(el) => { if (el) el.indeterminate = selection.isSomeSelected(rows); }}
                  onChange={() => selection.toggleAll(rows)} />
              </th>
              <SortableTh sortKey="title" current={sortKey} dir={sortDir} onSort={onSort}>Title</SortableTh><SortableTh sortKey="website_url" current={sortKey} dir={sortDir} onSort={onSort}>Website</SortableTh><SortableTh sortKey="category" current={sortKey} dir={sortDir} onSort={onSort}>Category</SortableTh><th style={{ width: 50 }}></th><th style={{ width: 200 }}>Actions</th></tr></thead>
            <tbody>{rows.map(renderEntryRow)}</tbody>
          </table>
        </div>
      </div>
    );
  };

  if (vaultLocked) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>Unlock your vault to access the password vault.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Password Vault</h1><p className="page-subtitle">Securely store and manage your credentials</p></div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAdd(true)}><Table2 size={14} /> Bulk Add</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>
          <button className="btn btn-primary" onClick={crud.openAdd}><Plus size={16} /> Add Entry</button>
        </div>
      </div>

      {selection.selectionMode && (
        <div className="bulk-toolbar">
          <span className="bulk-count">{selection.selectedCount} selected</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkEdit(true)}><Edit2 size={14} /> Edit Selected</button>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}><Trash2 size={14} /> Delete Selected</button>
          <button className="btn btn-ghost btn-sm" onClick={selection.clearSelection}><X size={14} /> Clear</button>
        </div>
      )}

      <div className="flex gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input className="form-control" style={{ paddingLeft: 32 }} placeholder="Search entries..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="form-control" style={{ flex: '0 1 200px' }} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {errorMessage ? (
        <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{errorMessage}</span></div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : entries.length === 0 ? (
        <div className="empty-state"><div className="empty-icon"><KeyRound size={40} /></div><h3>No passwords yet</h3><p>Add your first credential to get started.</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon"><Search size={40} /></div><h3>No results</h3><p>No entries match your search or filter.</p></div>
      ) : (
        <>{renderTable(favourites, 'Favourites')}{renderTable(sorted, 'All Entries')}</>
      )}

      {/* Add/Edit Modal */}
      <Modal isOpen={crud.showModal} onClose={crud.closeModal} title={crud.editItem ? 'Edit Entry' : 'Add Entry'}
        footer={<><button className="btn btn-secondary" onClick={crud.handleCancel}>Cancel</button><button className="btn btn-primary" onClick={handleSave} disabled={crud.saving}>{crud.saving ? 'Saving...' : crud.editItem ? 'Update' : 'Create'}</button></>}>
        <form onSubmit={handleSave}>
          {crud.formError && <div className="alert alert-danger">{crud.formError}</div>}
          <div className="form-group">
            <label className="form-label">Title <span className="required">*</span></label>
            <input className="form-control" value={crud.form.title} onChange={(e) => updateField('title', e.target.value)} placeholder="e.g. Gmail" />
          </div>
          <div className="form-group">
            <label className="form-label">Website URL</label>
            <input className="form-control" value={crud.form.website_url} onChange={(e) => updateField('website_url', e.target.value)} placeholder="https://..." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Username</label>
              <input className="form-control" value={crud.form.username} onChange={(e) => updateField('username', e.target.value)} placeholder="user@example.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Password <span className="required">*</span></label>
              <div className="flex gap-1">
                <input className="form-control" type="text" value={crud.form.password} onChange={(e) => updateField('password', e.target.value)} placeholder="Enter or generate" style={{ flex: 1 }} />
                <button type="button" className="btn btn-secondary btn-icon" onClick={() => updateField('password', generatePassword())} title="Generate password"><RefreshCw size={16} /></button>
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-control" list="category-list" value={crud.form.category} onChange={(e) => updateField('category', e.target.value)} placeholder="General" />
              <datalist id="category-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="form-group flex items-center" style={{ paddingTop: 24 }}>
              <label className="form-check">
                <input type="checkbox" checked={crud.form.is_favourite} onChange={(e) => updateField('is_favourite', e.target.checked)} />
                <Star size={14} color="#f59e0b" /> <span>Favourite</span>
              </label>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={3} value={crud.form.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="Optional notes..." />
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <VaultEntryDetailModal
        isOpen={!!crud.detailItem}
        onClose={() => crud.setDetailItem(null)}
        item={crud.detailItem}
        onEdit={(entry) => openEdit(entry)}
      />

      <BulkEditModal isOpen={showBulkEdit} onClose={() => setShowBulkEdit(false)} entityType="vault"
        selectedItems={selection.getSelectedItems()} onSaveComplete={() => { selection.clearSelection(); refetch(); }} />
      <BulkAddModal isOpen={showBulkAdd} onClose={() => setShowBulkAdd(false)} entityType="vault"
        onSaveComplete={() => refetch()} />
      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} entityType="vault"
        onImportComplete={() => refetch()} />
    </div>
  );
}
