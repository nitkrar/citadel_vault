import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import InsuranceDetailModal from '../components/InsuranceDetailModal';
import InsuranceCategoryBadge from '../components/InsuranceCategoryBadge';
import BulkEditModal from '../components/BulkEditModal';
import BulkAddModal from '../components/BulkAddModal';
import ImportModal from '../components/ImportModal';
import { useHideAmounts } from '../components/Layout';
import useVaultData from '../hooks/useVaultData';
import useCrudModal from '../hooks/useCrudModal';
import useSelection from '../hooks/useSelection';
import useSort from '../hooks/useSort';
import useReferenceData from '../hooks/useReferenceData';
import { useEncryption } from '../contexts/EncryptionContext';
import { isTruthy, fmtCurrency, fmtDate } from '../lib/checks';
import SortableTh from '../components/SortableTh';
import {
  Plus, Edit2, Trash2, Search, ShieldCheck, AlertTriangle, Lock, Upload, Table2, X,
} from 'lucide-react';

const CATEGORIES = ['Life', 'Health', 'Vehicle', 'Property', 'Other'];
const FREQUENCIES = ['Monthly', 'Quarterly', 'Annually'];

const EMPTY_FORM = {
  policy_name: '',
  provider: '',
  policy_number: '',
  category: 'Life',
  premium_amount: '',
  premium_currency_id: '',
  coverage_amount: '',
  coverage_currency_id: '',
  payment_frequency: 'Annually',
  start_date: '',
  maturity_date: '',
  beneficiary: '',
  comments: '',
};

export default function InsurancePage() {
  const { hideAmounts } = useHideAmounts();
  const { vaultUnlocked } = useEncryption();
  const vaultLocked = !isTruthy(vaultUnlocked);

  // Primary data via useVaultData
  const fetchPolicies = useCallback(
    () => api.get('/insurance.php').then((r) => r.data.data || []),
    []
  );
  const { data: policies, loading, errorMessage, refetch } = useVaultData(fetchPolicies, []);

  // Reference data
  const { currencies } = useReferenceData([
    { key: 'currencies', url: '/reference.php?resource=currencies' },
  ]);

  // Filter
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Bulk operations
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Modal via useCrudModal
  const crud = useCrudModal('insurance_form', EMPTY_FORM);

  // Filtering
  const filtered = useMemo(() => {
    let list = policies;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          (p.policy_name || '').toLowerCase().includes(q) ||
          (p.provider || '').toLowerCase().includes(q) ||
          (p.policy_number || '').toLowerCase().includes(q) ||
          (p.beneficiary || '').toLowerCase().includes(q)
      );
    }
    if (filterCategory) {
      list = list.filter((p) => p.category === filterCategory);
    }
    return list;
  }, [policies, search, filterCategory]);

  // Sorting
  const { sorted, sortKey, sortDir, onSort } = useSort(filtered, 'policy_name', 'asc');

  const selection = useSelection(filtered);

  const handleBulkDelete = async () => {
    const items = selection.getSelectedItems();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} selected polic${items.length !== 1 ? 'ies' : 'y'}? This cannot be undone.`)) return;
    try {
      await api.post('/bulk.php?action=delete', { entity: 'insurance', ids: items.map((i) => i.id) });
      selection.clearSelection();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk delete failed.');
    }
  };

  const openEditModal = (policy) => {
    crud.openEdit(policy, (p) => ({
      policy_name: p.policy_name || '',
      provider: p.provider || '',
      policy_number: p.policy_number || '',
      category: p.category || 'Life',
      premium_amount: p.premium_amount != null ? String(p.premium_amount) : '',
      premium_currency_id: p.premium_currency_id ? String(p.premium_currency_id) : '',
      coverage_amount: p.coverage_amount != null ? String(p.coverage_amount) : '',
      coverage_currency_id: p.coverage_currency_id ? String(p.coverage_currency_id) : '',
      payment_frequency: p.payment_frequency || 'Annually',
      start_date: p.start_date || '',
      maturity_date: p.maturity_date || '',
      beneficiary: p.beneficiary || '',
      comments: p.comments || '',
    }));
  };

  // Save
  const handleSave = async () => {
    await crud.saveEntity({
      endpoint: '/insurance.php',
      validate: (f) => {
        if (!f.policy_name.trim()) return 'Policy name is required.';
        if (!f.category) return 'Category is required.';
        return null;
      },
      buildPayload: (f) => ({
        policy_name: f.policy_name.trim(),
        provider: f.provider.trim() || null,
        policy_number: f.policy_number.trim() || null,
        category: f.category,
        premium_amount: f.premium_amount !== '' ? parseFloat(f.premium_amount) : null,
        premium_currency_id: f.premium_currency_id ? parseInt(f.premium_currency_id, 10) : null,
        coverage_amount: f.coverage_amount !== '' ? parseFloat(f.coverage_amount) : null,
        coverage_currency_id: f.coverage_currency_id ? parseInt(f.coverage_currency_id, 10) : null,
        payment_frequency: f.payment_frequency || null,
        start_date: f.start_date || null,
        maturity_date: f.maturity_date || null,
        beneficiary: f.beneficiary.trim() || null,
        comments: f.comments.trim() || null,
      }),
      refetch,
    });
  };

  // Delete
  const handleDelete = async (policy) => {
    await crud.deleteEntity({
      endpoint: '/insurance.php',
      item: policy,
      nameField: 'policy_name',
      refetch,
    });
  };

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      {errorMessage && (
        <div className="alert alert-danger mb-3">
          <AlertTriangle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Insurance</h1>
          <p className="page-subtitle">
            {policies.length} polic{policies.length !== 1 ? 'ies' : 'y'} tracked
          </p>
        </div>
        {!vaultLocked && (
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAdd(true)}><Table2 size={14} /> Bulk Add</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>
            <button className="btn btn-primary" onClick={crud.openAdd}>
              <Plus size={16} /> Add Policy
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      {!vaultLocked && policies.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 34 }}
              type="text"
              placeholder="Search policies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {/* Bulk toolbar */}
      {selection.selectionMode && (
        <div className="bulk-toolbar">
          <span className="bulk-count">{selection.selectedCount} selected</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkEdit(true)}><Edit2 size={14} /> Edit Selected</button>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}><Trash2 size={14} /> Delete Selected</button>
          <button className="btn btn-ghost btn-sm" onClick={selection.clearSelection}><X size={14} /> Clear</button>
        </div>
      )}

      {/* Empty state */}
      {!vaultLocked && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon"><ShieldCheck size={40} /></div>
          <h3>{policies.length === 0 ? 'No insurance policies yet' : 'No matching policies'}</h3>
          <p>
            {policies.length === 0
              ? 'Add your first insurance policy to keep track of your coverage.'
              : 'Try adjusting your search or filters.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!vaultLocked && filtered.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Insurance Policies</span>
            <span className="badge badge-muted">{filtered.length}</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="th-checkbox">
                    <input type="checkbox" checked={selection.isAllSelected(filtered)}
                      ref={(el) => { if (el) el.indeterminate = selection.isSomeSelected(filtered); }}
                      onChange={() => selection.toggleAll(filtered)} />
                  </th>
                  <SortableTh sortKey="policy_name" current={sortKey} dir={sortDir} onSort={onSort}>Policy Name</SortableTh>
                  <SortableTh sortKey="provider" current={sortKey} dir={sortDir} onSort={onSort}>Provider</SortableTh>
                  <SortableTh sortKey="category" current={sortKey} dir={sortDir} onSort={onSort}>Category</SortableTh>
                  <SortableTh sortKey="premium_amount" current={sortKey} dir={sortDir} onSort={onSort} style={{ textAlign: 'right' }}>Premium</SortableTh>
                  <SortableTh sortKey="coverage_amount" current={sortKey} dir={sortDir} onSort={onSort} style={{ textAlign: 'right' }}>Coverage</SortableTh>
                  <SortableTh sortKey="payment_frequency" current={sortKey} dir={sortDir} onSort={onSort}>Frequency</SortableTh>
                  <SortableTh sortKey="start_date" current={sortKey} dir={sortDir} onSort={onSort}>Start Date</SortableTh>
                  <SortableTh sortKey="maturity_date" current={sortKey} dir={sortDir} onSort={onSort}>Maturity Date</SortableTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} className={selection.isSelected(p.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => crud.setDetailItem(p)}>
                    <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(p.id)} onChange={() => selection.toggle(p.id)} />
                    </td>
                    <td>
                      <div>
                        <span className="font-medium">{p.policy_name}</span>
                        {p.policy_number && (
                          <div className="text-sm text-muted">#{p.policy_number}</div>
                        )}
                      </div>
                    </td>
                    <td className="td-muted">{p.provider || '--'}</td>
                    <td>{<InsuranceCategoryBadge category={p.category} />}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCurrency(p.premium_amount, p.premium_currency_symbol, hideAmounts)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCurrency(p.coverage_amount, p.coverage_currency_symbol, hideAmounts)}
                    </td>
                    <td>
                      <span className="badge badge-muted">{p.payment_frequency || '--'}</span>
                    </td>
                    <td className="td-muted">{fmtDate(p.start_date)}</td>
                    <td className="td-muted">{fmtDate(p.maturity_date)}</td>
                    <td>
                      <div className="td-actions">
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Edit"
                          onClick={(e) => { e.stopPropagation(); openEditModal(p); }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-icon text-danger"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={crud.showModal}
        onClose={crud.closeModal}
        title={crud.editItem ? 'Edit Policy' : 'Add Policy'}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={crud.handleCancel} disabled={crud.saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={crud.saving}>
              {crud.saving ? 'Saving...' : crud.editItem ? 'Update Policy' : 'Create Policy'}
            </button>
          </>
        }
      >
        {crud.formError && (
          <div className="alert alert-danger mb-3">
            <AlertTriangle size={16} />
            <span>{crud.formError}</span>
          </div>
        )}

        {/* Policy Name & Provider */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Policy Name <span className="required">*</span>
            </label>
            <input
              className="form-control"
              type="text"
              value={crud.form.policy_name}
              onChange={(e) => crud.setField('policy_name', e.target.value)}
              placeholder="e.g. Term Life Insurance"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Provider</label>
            <input
              className="form-control"
              type="text"
              value={crud.form.provider}
              onChange={(e) => crud.setField('provider', e.target.value)}
              placeholder="e.g. State Farm"
            />
          </div>
        </div>

        {/* Policy Number & Category */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Policy Number</label>
            <input
              className="form-control"
              type="text"
              value={crud.form.policy_number}
              onChange={(e) => crud.setField('policy_number', e.target.value)}
              placeholder="Optional policy number"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Category <span className="required">*</span>
            </label>
            <select
              className="form-control"
              value={crud.form.category}
              onChange={(e) => crud.setField('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Premium Amount & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Premium Amount</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={crud.form.premium_amount}
              onChange={(e) => crud.setField('premium_amount', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Premium Currency</label>
            <select
              className="form-control"
              value={crud.form.premium_currency_id}
              onChange={(e) => crud.setField('premium_currency_id', e.target.value)}
            >
              <option value="">Select currency...</option>
              {currencies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.symbol} {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Coverage Amount & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Coverage Amount</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={crud.form.coverage_amount}
              onChange={(e) => crud.setField('coverage_amount', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Coverage Currency</label>
            <select
              className="form-control"
              value={crud.form.coverage_currency_id}
              onChange={(e) => crud.setField('coverage_currency_id', e.target.value)}
            >
              <option value="">Select currency...</option>
              {currencies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.symbol} {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Payment Frequency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Payment Frequency</label>
            <select
              className="form-control"
              value={crud.form.payment_frequency}
              onChange={(e) => crud.setField('payment_frequency', e.target.value)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Beneficiary</label>
            <input
              className="form-control"
              type="text"
              value={crud.form.beneficiary}
              onChange={(e) => crud.setField('beneficiary', e.target.value)}
              placeholder="Beneficiary name"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input
              className="form-control"
              type="date"
              value={crud.form.start_date}
              onChange={(e) => crud.setField('start_date', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Maturity Date</label>
            <input
              className="form-control"
              type="date"
              value={crud.form.maturity_date}
              onChange={(e) => crud.setField('maturity_date', e.target.value)}
            />
          </div>
        </div>

        {/* Comments */}
        <div className="form-group">
          <label className="form-label">Comments</label>
          <textarea
            className="form-control"
            rows={3}
            value={crud.form.comments}
            onChange={(e) => crud.setField('comments', e.target.value)}
            placeholder="Additional notes about this policy..."
          />
        </div>
      </Modal>

      {/* Detail Modal */}
      <InsuranceDetailModal
        isOpen={!!crud.detailItem}
        onClose={() => crud.setDetailItem(null)}
        item={crud.detailItem}
        onEdit={(policy) => openEditModal(policy)}
      />

      <BulkEditModal isOpen={showBulkEdit} onClose={() => setShowBulkEdit(false)} entityType="insurance"
        selectedItems={selection.getSelectedItems()} onSaveComplete={() => { selection.clearSelection(); refetch(); }} />
      <BulkAddModal isOpen={showBulkAdd} onClose={() => setShowBulkAdd(false)} entityType="insurance"
        onSaveComplete={() => refetch()} />
      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} entityType="insurance"
        onImportComplete={() => refetch()} />
    </div>
  );
}
