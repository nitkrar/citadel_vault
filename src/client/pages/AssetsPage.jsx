import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import AssetDetailModal from '../components/AssetDetailModal';
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
import { isTruthy, fmtCurrency } from '../lib/checks';
import SortableTh from '../components/SortableTh';
import {
  Plus, Edit2, Trash2, Search, ChevronDown, ChevronUp,
  Briefcase, AlertTriangle, Lock, Filter, Upload, Table2, X,
} from 'lucide-react';

const EMPTY_FORM = {
  account_id: '',
  asset_type_id: '',
  name: '',
  currency_id: '',
  country_id: '',
  amount: '',
  is_liability: false,
  is_liquid: true,
  comments: '',
  asset_data: {},
};

export default function AssetsPage() {
  const { hideAmounts } = useHideAmounts();
  const { vaultUnlocked } = useEncryption();
  const vaultLocked = !isTruthy(vaultUnlocked);

  // Primary data via useVaultData
  const fetchAssets = useCallback(
    () => api.get('/assets.php').then((r) => r.data.data || []),
    []
  );
  const { data: assets, loading, errorMessage, refetch } = useVaultData(fetchAssets, []);

  // Reference data (assetTypes, currencies not vault-dependent; accounts need vault)
  const { assetTypes, accounts, currencies, countries } = useReferenceData(
    [
      { key: 'assetTypes', url: '/reference.php?resource=asset-types' },
      { key: 'accounts', url: '/accounts.php' },
      { key: 'currencies', url: '/reference.php?resource=currencies' },
      { key: 'countries', url: '/reference.php?resource=countries' },
    ],
    { deps: [vaultLocked] }
  );

  // Filters
  const [search, setSearch] = useState('');
  const [filterAssetType, setFilterAssetType] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterLiability, setFilterLiability] = useState('');

  // Collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState({});

  // Bulk operations
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Modal via useCrudModal
  const crud = useCrudModal('asset_form', EMPTY_FORM);

  // Filtering
  const filtered = useMemo(() => {
    let list = assets;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          (a.name || '').toLowerCase().includes(q) ||
          (a.ticker_symbol || '').toLowerCase().includes(q) ||
          (a.account_name || '').toLowerCase().includes(q)
      );
    }
    if (filterAssetType) {
      list = list.filter((a) => String(a.asset_type_id) === filterAssetType);
    }
    if (filterAccount) {
      list = list.filter((a) => String(a.account_id) === filterAccount);
    }
    if (filterLiability === 'asset') {
      list = list.filter((a) => !a.is_liability);
    } else if (filterLiability === 'liability') {
      list = list.filter((a) => a.is_liability);
    }
    return list;
  }, [assets, search, filterAssetType, filterAccount, filterLiability]);

  // Sorting
  const { sorted, sortKey, sortDir, onSort } = useSort(filtered, 'name', 'asc');

  // Selection
  const selection = useSelection(filtered);

  // Bulk delete handler
  const handleBulkDelete = async () => {
    const items = selection.getSelectedItems();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} selected asset${items.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api.post('/bulk.php?action=delete', {
        entity: 'assets',
        ids: items.map((i) => i.id),
      });
      selection.clearSelection();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk delete failed.');
    }
  };

  const bulkReferenceData = useMemo(() => ({
    assetTypes, accounts, currencies, countries,
  }), [assetTypes, accounts, currencies, countries]);

  // Group by asset type category
  const grouped = useMemo(() => {
    const map = {};
    sorted.forEach((a) => {
      const cat = a.asset_type_category || a.asset_type_name || 'Other';
      if (!map[cat]) {
        map[cat] = { category: cat, assets: [], totalBase: 0 };
      }
      map[cat].assets.push(a);
      const amt = parseFloat(a.base_amount) || 0;
      map[cat].totalBase += a.is_liability ? -Math.abs(amt) : amt;
    });
    return Object.values(map).sort((a, b) => a.category.localeCompare(b.category));
  }, [sorted]);

  // Account options for filter
  const accountOptions = useMemo(() => {
    const seen = new Map();
    assets.forEach((a) => {
      if (a.account_id && !seen.has(String(a.account_id))) {
        seen.set(String(a.account_id), {
          id: a.account_id,
          name: a.account_name || `Account #${a.account_id}`,
        });
      }
    });
    return Array.from(seen.values()).sort((x, y) => x.name.localeCompare(y.name));
  }, [assets]);

  const toggleGroup = (name) => {
    setCollapsedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  // Get selected asset type (for dynamic json_schema fields)
  const selectedAssetType = useMemo(() => {
    if (!crud.form.asset_type_id) return null;
    return assetTypes.find((t) => String(t.id) === crud.form.asset_type_id) || null;
  }, [assetTypes, crud.form.asset_type_id]);

  const jsonSchemaFields = useMemo(() => {
    if (!selectedAssetType || !selectedAssetType.json_schema) return [];
    let schema = selectedAssetType.json_schema;
    if (typeof schema === 'string') {
      try { schema = JSON.parse(schema); } catch { return []; }
    }
    if (schema && schema.properties) {
      return Object.entries(schema.properties).map(([key, def]) => ({
        key,
        label: def.title || def.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        type: def.type === 'number' || def.type === 'integer' ? 'number' : def.type === 'boolean' ? 'checkbox' : 'text',
        required: Array.isArray(schema.required) && schema.required.includes(key),
        placeholder: def.description || '',
      }));
    }
    if (Array.isArray(schema)) {
      return schema.map((field) => ({
        key: field.key || field.name,
        label: field.label || field.key || field.name,
        type: field.type || 'text',
        required: !!field.required,
        placeholder: field.placeholder || '',
      }));
    }
    return [];
  }, [selectedAssetType]);

  // Warn if country and currency don't match
  const currencyCountryMismatch = useMemo(() => {
    if (!crud.form.country_id || !crud.form.currency_id) return null;
    const country = countries.find((c) => String(c.id) === crud.form.country_id);
    if (!country || !country.default_currency_id) return null;
    if (String(country.default_currency_id) === crud.form.currency_id) return null;
    const expectedCur = currencies.find((c) => c.id === country.default_currency_id);
    const selectedCur = currencies.find((c) => String(c.id) === crud.form.currency_id);
    return `${country.name} typically uses ${expectedCur?.code || '?'}, but ${selectedCur?.code || '?'} is selected.`;
  }, [crud.form.country_id, crud.form.currency_id, countries, currencies]);

  // Form field setter — override for asset_type→clear asset_data side effect
  const setField = (key, value) => {
    crud.setForm((prev) => {
      const next = { ...prev, [key]: value };
      // When asset type changes, clear asset_data
      if (key === 'asset_type_id') {
        next.asset_data = {};
      }
      // Auto-infer country from account when account changes, only if country is not already set
      if (key === 'account_id' && value && !prev.country_id) {
        const acc = accounts.find((a) => String(a.id) === value);
        if (acc && acc.country_id) {
          next.country_id = String(acc.country_id);
        }
      }
      // Auto-infer country from currency when currency changes and country is empty
      if (key === 'currency_id' && value && !next.country_id) {
        const match = countries.find((c) => String(c.default_currency_id) === value);
        if (match) {
          next.country_id = String(match.id);
        }
      }
      return next;
    });
  };

  const setAssetDataField = (key, value) => {
    crud.setForm((prev) => ({
      ...prev,
      asset_data: { ...prev.asset_data, [key]: value },
    }));
  };

  // Modal open/close
  const openEditModal = (asset) => {
    let assetData = {};
    if (asset.asset_data) {
      if (typeof asset.asset_data === 'string') {
        try { assetData = JSON.parse(asset.asset_data); } catch { assetData = {}; }
      } else {
        assetData = { ...asset.asset_data };
      }
    }
    crud.openEdit(asset, (a) => ({
      account_id: a.account_id ? String(a.account_id) : '',
      asset_type_id: a.asset_type_id ? String(a.asset_type_id) : '',
      name: a.name || '',
      currency_id: a.currency_id ? String(a.currency_id) : '',
      country_id: a.country_id ? String(a.country_id) : '',
      amount: a.amount != null ? String(a.amount) : '',
      is_liability: !!a.is_liability,
      is_liquid: a.is_liquid == null ? true : !!a.is_liquid,
      comments: a.comments || '',
      asset_data: assetData,
    }));
  };

  // Save
  const handleSave = async () => {
    await crud.saveEntity({
      endpoint: '/assets.php',
      validate: (f) => {
        if (!f.name.trim()) return 'Asset name is required.';
        if (!f.asset_type_id) return 'Asset type is required.';
        if (!f.currency_id) return 'Currency is required.';
        return null;
      },
      buildPayload: (f) => ({
        account_id: f.account_id ? parseInt(f.account_id, 10) : null,
        asset_type_id: parseInt(f.asset_type_id, 10),
        name: f.name.trim(),
        currency_id: parseInt(f.currency_id, 10),
        country_id: f.country_id ? parseInt(f.country_id, 10) : null,
        amount: f.amount !== '' ? parseFloat(f.amount) : null,
        is_liability: f.is_liability ? 1 : 0,
        is_liquid: f.is_liquid ? 1 : 0,
        comments: f.comments.trim() || null,
        asset_data: Object.keys(f.asset_data).length > 0 ? f.asset_data : null,
      }),
      refetch,
    });
  };

  // Delete
  const handleDelete = async (asset) => {
    await crud.deleteEntity({
      endpoint: '/assets.php',
      item: asset,
      refetch,
    });
  };

  // Loading
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
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Assets</h1>
          <p className="page-subtitle">
            {assets.length} asset{assets.length !== 1 ? 's' : ''} tracked
            {(() => {
              const dates = currencies.map(c => c.last_updated).filter(Boolean);
              const max = dates.length ? dates.reduce((a, b) => a > b ? a : b) : null;
              return max ? (
                <span className="badge badge-info" style={{ marginLeft: 8 }}>
                  Rates as of {new Date(max + 'Z').toLocaleDateString()}
                </span>
              ) : null;
            })()}
          </p>
        </div>
        {!vaultLocked && (
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAdd(true)} title="Bulk Add">
              <Table2 size={14} /> Bulk Add
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)} title="Import">
              <Upload size={14} /> Import
            </button>
            <button className="btn btn-primary" onClick={crud.openAdd}>
              <Plus size={16} /> Add Asset
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      {!vaultLocked && assets.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 34 }}
              type="text"
              placeholder="Search assets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={filterAssetType}
            onChange={(e) => setFilterAssetType(e.target.value)}
          >
            <option value="">All Asset Types</option>
            {assetTypes.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
          </select>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
          >
            <option value="">All Accounts</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </select>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 140 }}
            value={filterLiability}
            onChange={(e) => setFilterLiability(e.target.value)}
          >
            <option value="">Assets & Liabilities</option>
            <option value="asset">Assets Only</option>
            <option value="liability">Liabilities Only</option>
          </select>
        </div>
      )}

      {/* Bulk toolbar */}
      {selection.selectionMode && (
        <div className="bulk-toolbar">
          <span className="bulk-count">{selection.selectedCount} selected</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkEdit(true)}>
            <Edit2 size={14} /> Edit Selected
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
            <Trash2 size={14} /> Delete Selected
          </button>
          <button className="btn btn-ghost btn-sm" onClick={selection.clearSelection}>
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* Empty state */}
      {!vaultLocked && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon"><Briefcase size={40} /></div>
          <h3>{assets.length === 0 ? 'No assets yet' : 'No matching assets'}</h3>
          <p>
            {assets.length === 0
              ? 'Add your first asset to start tracking your portfolio.'
              : 'Try adjusting your search or filters.'}
          </p>
        </div>
      )}

      {/* Grouped assets */}
      {!vaultLocked && grouped.map((group) => {
        const isCollapsed = collapsedGroups[group.category];
        return (
          <div className="card mb-4" key={group.category}>
            <div
              className="card-header"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => toggleGroup(group.category)}
            >
              <div className="flex items-center gap-2">
                <Briefcase size={16} />
                <span className="card-title">{group.category}</span>
                <span className="badge badge-muted">{group.assets.length}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted text-sm">
                  Total: {fmtCurrency(group.totalBase, '$', hideAmounts)}
                </span>
                {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </div>
            </div>
            {!isCollapsed && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th className="th-checkbox">
                        <input
                          type="checkbox"
                          checked={selection.isAllSelected(group.assets)}
                          ref={(el) => { if (el) el.indeterminate = selection.isSomeSelected(group.assets); }}
                          onChange={() => selection.toggleAll(group.assets)}
                        />
                      </th>
                      <SortableTh sortKey="name" current={sortKey} dir={sortDir} onSort={onSort}>Name</SortableTh>
                      <SortableTh sortKey="account_name" current={sortKey} dir={sortDir} onSort={onSort}>Account</SortableTh>
                      <SortableTh sortKey="asset_type_name" current={sortKey} dir={sortDir} onSort={onSort}>Type</SortableTh>
                      <SortableTh sortKey="amount" current={sortKey} dir={sortDir} onSort={onSort} style={{ textAlign: 'right' }}>Amount</SortableTh>
                      <SortableTh sortKey="base_amount" current={sortKey} dir={sortDir} onSort={onSort} style={{ textAlign: 'right' }}>Base Amount</SortableTh>
                      <SortableTh sortKey="is_liquid" current={sortKey} dir={sortDir} onSort={onSort}>Liquid</SortableTh>
                      <SortableTh sortKey="is_liability" current={sortKey} dir={sortDir} onSort={onSort}>Category</SortableTh>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.assets.map((a) => (
                      <tr key={a.id} className={selection.isSelected(a.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => crud.setDetailItem(a)}>
                        <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selection.isSelected(a.id)}
                            onChange={() => selection.toggle(a.id)}
                          />
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{a.name}</span>
                            {a.ticker_symbol && (
                              <span className="badge badge-muted text-sm">{a.ticker_symbol}</span>
                            )}
                          </div>
                        </td>
                        <td className="td-muted">{a.account_name || '--'}</td>
                        <td>
                          <span className="badge badge-primary">{a.asset_type_name || '--'}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {a.is_liability ? (
                            <span className="text-danger">{fmtCurrency(a.amount, a.currency_symbol, hideAmounts)}</span>
                          ) : (
                            fmtCurrency(a.amount, a.currency_symbol, hideAmounts)
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {a.is_liability ? (
                            <span className="text-danger">{fmtCurrency(a.base_amount, '$', hideAmounts)}</span>
                          ) : (
                            fmtCurrency(a.base_amount, '$', hideAmounts)
                          )}
                        </td>
                        <td>
                          {a.is_liquid ? (
                            <span className="text-success">Yes</span>
                          ) : (
                            <span className="text-muted">No</span>
                          )}
                        </td>
                        <td>
                          {a.is_liability ? (
                            <span className="badge badge-danger">Liability</span>
                          ) : (
                            <span className="badge badge-success">Asset</span>
                          )}
                        </td>
                        <td>
                          <div className="td-actions">
                            <button
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Edit"
                              onClick={(e) => { e.stopPropagation(); openEditModal(a); }}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm btn-icon text-danger"
                              title="Delete"
                              onClick={(e) => { e.stopPropagation(); handleDelete(a); }}
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
            )}
          </div>
        );
      })}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={crud.showModal}
        onClose={crud.closeModal}
        title={crud.editItem ? 'Edit Asset' : 'Add Asset'}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={crud.handleCancel} disabled={crud.saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={crud.saving}>
              {crud.saving ? 'Saving...' : crud.editItem ? 'Update Asset' : 'Create Asset'}
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

        {/* Name & Account */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Name <span className="required">*</span>
            </label>
            <input
              className="form-control"
              type="text"
              value={crud.form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Apple Stock, Home Mortgage"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Account</label>
            <select
              className="form-control"
              value={crud.form.account_id}
              onChange={(e) => setField('account_id', e.target.value)}
            >
              <option value="">No account (standalone)</option>
              {accounts.map((a) => (
                <option key={a.id} value={String(a.id)}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Asset Type & Currency */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Asset Type <span className="required">*</span>
            </label>
            <select
              className="form-control"
              value={crud.form.asset_type_id}
              onChange={(e) => setField('asset_type_id', e.target.value)}
            >
              <option value="">Select type...</option>
              {assetTypes.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}{t.category ? ` (${t.category})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">
              Currency <span className="required">*</span>
            </label>
            <select
              className="form-control"
              value={crud.form.currency_id}
              onChange={(e) => setField('currency_id', e.target.value)}
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

        {/* Country */}
        <div className="form-group">
          <label className="form-label">Country</label>
          <select
            className="form-control"
            value={crud.form.country_id}
            onChange={(e) => setField('country_id', e.target.value)}
          >
            <option value="">Select country...</option>
            {countries.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.flag_emoji} {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>

        {currencyCountryMismatch && (
          <div className="alert alert-warning mb-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            <span>{currencyCountryMismatch} Ensure this is intentional.</span>
          </div>
        )}

        {/* Amount & Flags */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount</label>
            <input
              className="form-control"
              type="number"
              step="0.01"
              value={crud.form.amount}
              onChange={(e) => setField('amount', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 16, paddingBottom: 4 }}>
            <label className="form-check">
              <input
                type="checkbox"
                checked={crud.form.is_liquid}
                onChange={(e) => setField('is_liquid', e.target.checked)}
              />
              <span>Liquid asset</span>
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                checked={crud.form.is_liability}
                onChange={(e) => setField('is_liability', e.target.checked)}
              />
              <span>Liability</span>
            </label>
          </div>
        </div>

        {/* Comments */}
        <div className="form-group">
          <label className="form-label">Comments</label>
          <textarea
            className="form-control"
            rows={2}
            value={crud.form.comments}
            onChange={(e) => setField('comments', e.target.value)}
            placeholder="Notes about this asset..."
          />
        </div>

        {/* Dynamic asset_data fields from json_schema */}
        {jsonSchemaFields.length > 0 && (
          <div className="form-group">
            <label className="form-label">Asset Details</label>
            <div className="card" style={{ padding: 'var(--space-md)' }}>
              {jsonSchemaFields.map((field) => (
                <div className="form-group" key={field.key}>
                  <label className="form-label">
                    {field.label}
                    {field.required && <span className="required"> *</span>}
                  </label>
                  {field.type === 'checkbox' ? (
                    <label className="form-check">
                      <input
                        type="checkbox"
                        checked={!!crud.form.asset_data[field.key]}
                        onChange={(e) => setAssetDataField(field.key, e.target.checked)}
                      />
                      <span>{field.label}</span>
                    </label>
                  ) : (
                    <input
                      className="form-control"
                      type={field.type}
                      step={field.type === 'number' ? '0.01' : undefined}
                      placeholder={field.placeholder}
                      value={crud.form.asset_data[field.key] || ''}
                      onChange={(e) => setAssetDataField(field.key, field.type === 'number' ? e.target.value : e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Detail Modal */}
      <AssetDetailModal
        isOpen={!!crud.detailItem}
        onClose={() => crud.setDetailItem(null)}
        item={crud.detailItem}
        onEdit={(asset) => openEditModal(asset)}
      />

      {/* Bulk Edit Modal */}
      <BulkEditModal
        isOpen={showBulkEdit}
        onClose={() => setShowBulkEdit(false)}
        entityType="assets"
        selectedItems={selection.getSelectedItems()}
        onSaveComplete={() => { selection.clearSelection(); refetch(); }}
        referenceData={bulkReferenceData}
      />

      {/* Bulk Add Modal */}
      <BulkAddModal
        isOpen={showBulkAdd}
        onClose={() => setShowBulkAdd(false)}
        entityType="assets"
        onSaveComplete={() => refetch()}
        referenceData={bulkReferenceData}
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        entityType="assets"
        onImportComplete={() => refetch()}
        referenceData={bulkReferenceData}
      />
    </div>
  );
}
