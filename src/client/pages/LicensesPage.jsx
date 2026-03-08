import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import LicenseDetailModal from '../components/LicenseDetailModal';
import ExpiryBadge from '../components/ExpiryBadge';
import BulkEditModal from '../components/BulkEditModal';
import BulkAddModal from '../components/BulkAddModal';
import ImportModal from '../components/ImportModal';
import useVaultData from '../hooks/useVaultData';
import useCrudModal from '../hooks/useCrudModal';
import useSelection from '../hooks/useSelection';
import useSort from '../hooks/useSort';
import { useEncryption } from '../contexts/EncryptionContext';
import { isTruthy, daysUntil } from '../lib/checks';
import SortableTh from '../components/SortableTh';
import { Plus, Edit2, Trash2, FileText, AlertTriangle, Eye, Lock, Clock, Upload, Table2, X } from 'lucide-react';

const EMPTY_FORM = {
  product_name: '', vendor: '', license_key: '', purchase_date: '',
  expiry_date: '', seats: 1, notes: '', category: '',
};

export default function LicensesPage() {
  const { vaultUnlocked } = useEncryption();
  const vaultLocked = !isTruthy(vaultUnlocked);

  // Primary data via useVaultData
  const fetchLicenses = useCallback(
    () => api.get('/licenses.php').then((r) => r.data.data || r.data || []),
    []
  );
  const { data: licenses, loading, errorMessage, refetch } = useVaultData(fetchLicenses, []);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Bulk operations
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Modal state via useCrudModal
  const crud = useCrudModal('license_form', EMPTY_FORM);

  const PRESET_CATEGORIES = ['Software', 'SaaS', 'Cloud', 'Development', 'Security', 'Media', 'Productivity', 'OS', 'Design', 'Database', 'Hosting'];
  const categories = useMemo(() => {
    const existing = licenses.map((l) => l.category).filter(Boolean);
    return [...new Set([...PRESET_CATEGORIES, ...existing])].sort();
  }, [licenses]);
  const expiringSoon = useMemo(() => licenses.filter((l) => { const d = daysUntil(l.expiry_date); return d !== null && d >= 0 && d <= 30; }), [licenses]);

  const filtered = useMemo(() => {
    let list = licenses;
    if (filterCategory) list = list.filter((l) => l.category === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((l) =>
        (l.product_name || '').toLowerCase().includes(q) ||
        (l.vendor || '').toLowerCase().includes(q) ||
        (l.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [licenses, search, filterCategory]);

  // Sorting
  const { sorted, sortKey, sortDir, onSort } = useSort(filtered, 'product_name', 'asc');

  const selection = useSelection(filtered);

  const handleBulkDelete = async () => {
    const items = selection.getSelectedItems();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} selected license${items.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api.post('/bulk.php?action=delete', { entity: 'licenses', ids: items.map((i) => i.id) });
      selection.clearSelection();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk delete failed.');
    }
  };

  const openEdit = (lic) => {
    crud.openEdit(lic, (l) => {
      const f = {};
      for (const k of Object.keys(EMPTY_FORM)) f[k] = l[k] ?? EMPTY_FORM[k];
      return f;
    });
  };

  const openView = (lic) => {
    crud.setDetailItem(lic);
  };

  // Licenses uses PUT with body { id, ...form } instead of query param
  const handleSave = async (e) => {
    e.preventDefault();
    if (!crud.form.product_name.trim()) { crud.setFormError('Product name is required.'); return; }
    crud.setSaving(true);
    crud.setFormError('');
    try {
      if (crud.editItem) {
        await api.put('/licenses.php', { id: crud.editItem.id, ...crud.form, seats: Number(crud.form.seats) });
      } else {
        await api.post('/licenses.php', { ...crud.form, seats: Number(crud.form.seats) });
      }
      crud.clearDraft();
      crud.closeModal();
      refetch();
    } catch (err) {
      crud.setFormError(err.response?.data?.error || 'Failed to save license.');
    } finally {
      crud.setSaving(false);
    }
  };

  const handleDelete = async (lic) => {
    if (!window.confirm(`Delete "${lic.product_name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/licenses.php?id=${lic.id}`);
      refetch();
    } catch {
      alert('Failed to delete license.');
    }
  };

  if (vaultLocked) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>Unlock your vault to view licenses.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Licenses</h1>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAdd(true)}><Table2 size={14} /> Bulk Add</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>
          <button className="btn btn-primary" onClick={crud.openAdd}><Plus size={16} /> Add License</button>
        </div>
      </div>

      {expiringSoon.length > 0 && (
        <div className="alert alert-warning">
          <AlertTriangle size={18} />
          <span>{expiringSoon.length} license{expiringSoon.length > 1 ? 's' : ''} expiring soon</span>
        </div>
      )}

      <div className="flex gap-3 mb-3" style={{ flexWrap: 'wrap' }}>
        <input
          className="form-control"
          style={{ maxWidth: 300 }}
          placeholder="Search licenses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-control"
          style={{ maxWidth: 200 }}
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {selection.selectionMode && (
        <div className="bulk-toolbar">
          <span className="bulk-count">{selection.selectedCount} selected</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkEdit(true)}><Edit2 size={14} /> Edit Selected</button>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}><Trash2 size={14} /> Delete Selected</button>
          <button className="btn btn-ghost btn-sm" onClick={selection.clearSelection}><X size={14} /> Clear</button>
        </div>
      )}

      {errorMessage ? (
        <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{errorMessage}</span></div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <FileText size={40} className="empty-icon" />
          <h3>No licenses found</h3>
          <p>Add your first software license to start tracking.</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="th-checkbox">
                    <input type="checkbox" checked={selection.isAllSelected(filtered)}
                      ref={(el) => { if (el) el.indeterminate = selection.isSomeSelected(filtered); }}
                      onChange={() => selection.toggleAll(filtered)} />
                  </th>
                  <SortableTh sortKey="product_name" current={sortKey} dir={sortDir} onSort={onSort}>Product Name</SortableTh>
                  <SortableTh sortKey="vendor" current={sortKey} dir={sortDir} onSort={onSort}>Vendor</SortableTh>
                  <SortableTh sortKey="category" current={sortKey} dir={sortDir} onSort={onSort}>Category</SortableTh>
                  <SortableTh sortKey="purchase_date" current={sortKey} dir={sortDir} onSort={onSort}>Purchase Date</SortableTh>
                  <SortableTh sortKey="expiry_date" current={sortKey} dir={sortDir} onSort={onSort}>Expiry Date</SortableTh>
                  <SortableTh sortKey="seats" current={sortKey} dir={sortDir} onSort={onSort}>Seats</SortableTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((lic) => (
                  <tr key={lic.id} className={selection.isSelected(lic.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => openView(lic)}>
                    <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(lic.id)} onChange={() => selection.toggle(lic.id)} />
                    </td>
                    <td className="font-medium">{lic.product_name}</td>
                    <td className="td-muted">{lic.vendor || '--'}</td>
                    <td>{lic.category ? <span className="badge badge-primary">{lic.category}</span> : '--'}</td>
                    <td className="td-muted">{lic.purchase_date || '--'}</td>
                    <td><ExpiryBadge expiry_date={lic.expiry_date} /></td>
                    <td>{lic.seats ?? '--'}</td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-icon btn-sm" title="View" onClick={(e) => { e.stopPropagation(); openView(lic); }}><Eye size={16} /></button>
                        <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={(e) => { e.stopPropagation(); openEdit(lic); }}><Edit2 size={16} /></button>
                        <button className="btn btn-ghost btn-icon btn-sm text-danger" title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(lic); }}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={crud.showModal}
        onClose={crud.closeModal}
        title={crud.editItem ? 'Edit License' : 'Add License'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={crud.handleCancel}>Cancel</button>
            <button className="btn btn-primary" disabled={crud.saving} onClick={handleSave}>
              {crud.saving ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <form onSubmit={handleSave}>
          {crud.formError && <div className="alert alert-danger">{crud.formError}</div>}
          <div className="form-group">
            <label className="form-label">Product Name <span className="required">*</span></label>
            <input className="form-control" value={crud.form.product_name} onChange={(e) => crud.setField('product_name', e.target.value)} required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Vendor</label>
              <input className="form-control" value={crud.form.vendor} onChange={(e) => crud.setField('vendor', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-control" list="cat-list" value={crud.form.category} onChange={(e) => crud.setField('category', e.target.value)} />
              <datalist id="cat-list">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">License Key</label>
            <input className="form-control font-mono" value={crud.form.license_key} onChange={(e) => crud.setField('license_key', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Purchase Date</label>
              <input type="date" className="form-control" value={crud.form.purchase_date} onChange={(e) => crud.setField('purchase_date', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Expiry Date</label>
              <input type="date" className="form-control" value={crud.form.expiry_date} onChange={(e) => crud.setField('expiry_date', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Seats</label>
            <input type="number" min="1" className="form-control" value={crud.form.seats} onChange={(e) => crud.setField('seats', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={3} value={crud.form.notes} onChange={(e) => crud.setField('notes', e.target.value)} />
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <LicenseDetailModal
        isOpen={!!crud.detailItem}
        onClose={() => crud.setDetailItem(null)}
        item={crud.detailItem}
        onEdit={(lic) => openEdit(lic)}
      />

      <BulkEditModal isOpen={showBulkEdit} onClose={() => setShowBulkEdit(false)} entityType="licenses"
        selectedItems={selection.getSelectedItems()} onSaveComplete={() => { selection.clearSelection(); refetch(); }} />
      <BulkAddModal isOpen={showBulkAdd} onClose={() => setShowBulkAdd(false)} entityType="licenses"
        onSaveComplete={() => refetch()} />
      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} entityType="licenses"
        onImportComplete={() => refetch()} />
    </div>
  );
}
