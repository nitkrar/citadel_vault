import { useState, useMemo, useCallback, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import AccountDetailModal from '../components/AccountDetailModal';
import BulkEditModal from '../components/BulkEditModal';
import BulkAddModal from '../components/BulkAddModal';
import ImportModal from '../components/ImportModal';
import { useHideAmounts } from '../components/Layout';
import useVaultData from '../hooks/useVaultData';
import useCrudModal from '../hooks/useCrudModal';
import useSelection from '../hooks/useSelection';
import useSort from '../hooks/useSort';
import useReferenceData, { invalidateReferenceCache } from '../hooks/useReferenceData';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import { isTruthy } from '../lib/checks';

// Standardize a field key: camelCase boundaries split, all non-alphanumeric → underscore, lowercase, collapse/trim underscores
function standardizeKey(str) {
  return str.trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

// Convert snake_case to display "Title Case"
function toDisplayLabel(snakeStr) {
  return snakeStr
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
import SortableTh from '../components/SortableTh';
import {
  Plus, Edit2, Trash2, Search, ChevronDown, ChevronUp,
  Landmark, AlertTriangle, Lock, Upload, Table2, X,
} from 'lucide-react';

const SUBTYPES = ['', 'isa', 'sipp', '401k', 'nps', 'ppf', 'epf'];

const EMPTY_FORM = {
  name: '',
  institution: '',
  account_type_id: '',
  subtype: '',
  country_id: '',
  currency_id: '',
  customer_id: '',
  comments: '',
  account_details: '',
};

export default function AccountsPage() {
  const { hideAmounts } = useHideAmounts();
  const { vaultUnlocked } = useEncryption();
  const { isAdmin } = useAuth();
  const vaultLocked = !isTruthy(vaultUnlocked);

  // Primary data via useVaultData
  const fetchAccounts = useCallback(
    () => api.get('/accounts.php').then((r) => r.data.data || []),
    []
  );
  const { data: accounts, loading, errorMessage, refetch } = useVaultData(fetchAccounts, []);

  // Reference data
  const [templateRefetchKey, setTemplateRefetchKey] = useState(0);
  const { accountTypes, countries, currencies, accountDetailTemplates } = useReferenceData([
    { key: 'accountTypes', url: '/reference.php?resource=account-types' },
    { key: 'countries', url: '/reference.php?resource=countries' },
    { key: 'currencies', url: '/reference.php?resource=currencies' },
    { key: 'accountDetailTemplates', url: '/account-detail-templates.php' },
  ], { deps: [templateRefetchKey] });

  // Filter state
  const [search, setSearch] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterType, setFilterType] = useState('');

  // Collapsed country groups
  const [collapsedGroups, setCollapsedGroups] = useState({});

  // Bulk operations
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Modal state via useCrudModal
  const crud = useCrudModal('account_form', EMPTY_FORM);
  const [kvPairs, setKvPairs] = useState([]);
  const [templateMsg, setTemplateMsg] = useState(null); // { type: 'success'|'error'|'info', text }
  const [showBrowseTemplates, setShowBrowseTemplates] = useState(false);

  // Filtering
  const filtered = useMemo(() => {
    let list = accounts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          (a.name || '').toLowerCase().includes(q) ||
          (a.institution || '').toLowerCase().includes(q) ||
          (a.customer_id || '').toLowerCase().includes(q)
      );
    }
    if (filterCountry) {
      list = list.filter((a) => String(a.country_id) === filterCountry);
    }
    if (filterType) {
      list = list.filter((a) => String(a.account_type_id) === filterType);
    }
    return list;
  }, [accounts, search, filterCountry, filterType]);

  // Sorting
  const { sorted, sortKey, sortDir, onSort } = useSort(filtered, 'name', 'asc');

  // Selection
  const selection = useSelection(filtered);

  const handleBulkDelete = async () => {
    const items = selection.getSelectedItems();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} selected account${items.length !== 1 ? 's' : ''}? Assets under these accounts may be affected.`)) return;
    try {
      await api.post('/bulk.php?action=delete', { entity: 'accounts', ids: items.map((i) => i.id) });
      selection.clearSelection();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk delete failed.');
    }
  };

  const bulkReferenceData = useMemo(() => ({
    accountTypes: accountTypes || [], countries: countries || [], currencies: currencies || [],
  }), [accountTypes, countries, currencies]);

  // Group by country
  const grouped = useMemo(() => {
    const map = {};
    sorted.forEach((a) => {
      const key = a.country_name || 'Other';
      if (!map[key]) {
        map[key] = {
          country_name: key,
          flag_emoji: a.flag_emoji || '',
          accounts: [],
        };
      }
      map[key].accounts.push(a);
    });
    return Object.values(map).sort((a, b) =>
      a.country_name.localeCompare(b.country_name)
    );
  }, [sorted]);

  // Country options for filter
  const countryOptions = useMemo(() => {
    const seen = new Map();
    accounts.forEach((a) => {
      if (a.country_id && !seen.has(String(a.country_id))) {
        seen.set(String(a.country_id), {
          id: a.country_id,
          name: a.country_name || 'Unknown',
          flag: a.flag_emoji || '',
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts]);

  const toggleGroup = (name) => {
    setCollapsedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  // Country field template
  const selectedCountry = useMemo(() => {
    if (!crud.form.country_id) return null;
    return countries.find((c) => String(c.id) === crud.form.country_id) || null;
  }, [countries, crud.form.country_id]);

  const fieldTemplate = useMemo(() => {
    if (!selectedCountry || !selectedCountry.field_template) return [];
    let tpl = selectedCountry.field_template;
    if (typeof tpl === 'string') {
      try { tpl = JSON.parse(tpl); } catch { return []; }
    }
    if (tpl && !Array.isArray(tpl) && Array.isArray(tpl.fields)) {
      tpl = tpl.fields;
    }
    if (!Array.isArray(tpl)) return [];
    return tpl.map((f) => ({ ...f, key: f.key || f.name }));
  }, [selectedCountry]);

  // Best-match saved template for current (account_type_id, subtype, country_id)
  // Priority: 1) Personal exact, 2) Personal fallback, 3) Global exact, 4) Global fallback
  const matchedTemplate = useMemo(() => {
    if (!crud.form.account_type_id || !crud.form.country_id) return null;
    const typeId = parseInt(crud.form.account_type_id, 10);
    const countryId = parseInt(crud.form.country_id, 10);
    const subtype = crud.form.subtype || '';
    const templates = accountDetailTemplates || [];

    const match = (isGlobal, sub) =>
      templates.find(
        (t) =>
          t.account_type_id === typeId &&
          (t.subtype || '') === sub &&
          t.country_id === countryId &&
          (isGlobal ? !!t.is_global : !t.is_global)
      );

    // 1. Personal exact (type + subtype + country)
    let result = match(false, subtype);
    // 2. Personal fallback (type + country, no subtype)
    if (!result && subtype) result = match(false, '');
    // 3. Global exact
    if (!result) result = match(true, subtype);
    // 4. Global fallback
    if (!result && subtype) result = match(true, '');

    return result || null;
  }, [crud.form.account_type_id, crud.form.subtype, crud.form.country_id, accountDetailTemplates]);

  // Auto-populate kvPairs when template or field_template changes
  // Reset fields when account type/country/subtype changes (matchedTemplate changes)
  useEffect(() => {
    if (!crud.showModal) return;

    // Only protect user-typed values (non-empty value fields), not template-loaded empty fields
    const hasUserValues = kvPairs.some((p) => p.value.trim() !== '');

    if (matchedTemplate) {
      const keys = Array.isArray(matchedTemplate.field_keys) ? matchedTemplate.field_keys : [];
      // Skip if user has entered actual values and keys match
      if (hasUserValues) {
        const currentKeys = kvPairs.map((p) => p.key).sort().join(',');
        const templateKeys = keys.sort().join(',');
        if (currentKeys === templateKeys) return;
      }
      const source = matchedTemplate.is_global ? 'Loaded from shared template.' : 'Loaded from your saved template.';
      setTemplateMsg({ type: 'info', text: source });
      setTimeout(() => setTemplateMsg((m) => m?.text === source ? null : m), 3000);
      setKvPairs(keys.map((k) => ({ key: k, label: toDisplayLabel(k), value: '' })));
    } else if (fieldTemplate.length > 0) {
      // Clear and reload country defaults fresh
      setKvPairs(fieldTemplate.map((f) => ({ key: standardizeKey(f.label || f.key), label: f.label || toDisplayLabel(f.key), value: '' })));
    } else {
      // No template, no field_template — clear fields
      if (!hasUserValues) {
        setKvPairs([]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedTemplate, fieldTemplate, crud.showModal, crud.form.account_type_id, crud.form.subtype]);

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

  // Form field handlers — override setField for country→currency auto-select
  const setField = (key, value) => {
    crud.setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-select default currency when country changes, only if currency is not already set
      if (key === 'country_id' && value && !prev.currency_id) {
        const country = countries.find((c) => String(c.id) === value);
        if (country?.default_currency_id) {
          next.currency_id = String(country.default_currency_id);
        }
      }
      return next;
    });
  };

  // Apply a template to kvPairs
  const applyTemplate = (template) => {
    const keys = Array.isArray(template.field_keys) ? template.field_keys : [];
    setKvPairs(keys.map((k) => ({ key: k, label: toDisplayLabel(k), value: '' })));
    setShowBrowseTemplates(false);
    const source = template.is_global ? 'Loaded from shared template.' : 'Loaded from your saved template.';
    setTemplateMsg({ type: 'info', text: source });
    setTimeout(() => setTemplateMsg((m) => m?.text === source ? null : m), 3000);
  };

  // Modal open/close
  const openAddModal = () => {
    setKvPairs([]);
    setTemplateMsg(null);
    setShowBrowseTemplates(false);
    crud.openAdd();
  };

  const openEditModal = (account) => {
    const details = account.account_details;
    let detailsObj = {};
    if (details && typeof details === 'object') {
      detailsObj = { ...details };
    } else if (typeof details === 'string') {
      try { detailsObj = JSON.parse(details); } catch { /* ignore */ }
    }
    // Populate kvPairs from details object for the key-value editor
    const pairs = Object.entries(detailsObj).map(([k, v]) => ({ key: standardizeKey(k) || k, label: toDisplayLabel(standardizeKey(k) || k), value: String(v ?? '') }));
    setKvPairs(pairs.length > 0 ? pairs : []);

    crud.openEdit(account, (a) => ({
      name: a.name || '',
      institution: a.institution || '',
      account_type_id: a.account_type_id ? String(a.account_type_id) : '',
      subtype: a.subtype || '',
      country_id: a.country_id ? String(a.country_id) : '',
      currency_id: a.currency_id ? String(a.currency_id) : '',
      customer_id: a.customer_id || '',
      comments: a.comments || '',
      account_details: '',
    }));
  };

  // Save template for current (type, subtype, country) with scope
  const handleSaveTemplate = async (scope = 'personal') => {
    const keys = kvPairs.map((p) => standardizeKey(p.key)).filter(Boolean);
    if (keys.length === 0) return;
    try {
      await api.post('/account-detail-templates.php', {
        account_type_id: parseInt(crud.form.account_type_id, 10),
        subtype: crud.form.subtype || '',
        country_id: parseInt(crud.form.country_id, 10),
        field_keys: keys,
        scope,
      });
      invalidateReferenceCache('accountDetailTemplates');
      setTemplateRefetchKey((k) => k + 1);
      setTemplateMsg({ type: 'success', text: scope === 'global' ? 'Global template saved.' : 'Template saved.' });
      setTimeout(() => setTemplateMsg(null), 3000);
    } catch (err) {
      setTemplateMsg({ type: 'error', text: err.response?.data?.error || 'Failed to save template.' });
      setTimeout(() => setTemplateMsg(null), 4000);
    }
  };

  // Delete personal template
  const handleDeleteTemplate = async () => {
    if (!matchedTemplate || matchedTemplate.is_global) return;
    try {
      await api.delete(`/account-detail-templates.php?id=${matchedTemplate.id}`);
      invalidateReferenceCache('accountDetailTemplates');
      setTemplateRefetchKey((k) => k + 1);
      setTemplateMsg({ type: 'success', text: 'Personal template deleted.' });
      setTimeout(() => setTemplateMsg(null), 3000);
    } catch (err) {
      setTemplateMsg({ type: 'error', text: err.response?.data?.error || 'Failed to delete template.' });
      setTimeout(() => setTemplateMsg(null), 4000);
    }
  };

  // Save
  const handleSave = async () => {
    await crud.saveEntity({
      endpoint: '/accounts.php',
      validate: (f) => {
        if (!f.name.trim()) return 'Account name is required.';
        if (!f.account_type_id) return 'Account type is required.';
        if (!f.currency_id) return 'Currency is required.';
        return null;
      },
      buildPayload: (f) => {
        // Build account_details from kvPairs (normalize keys to snake_case)
        let accountDetails = null;
        if (kvPairs.length > 0) {
          const obj = {};
          kvPairs.forEach((p) => {
            const k = standardizeKey(p.key || '');
            if (k) obj[k] = p.value;
          });
          if (Object.keys(obj).length > 0) accountDetails = obj;
        }
        return {
          name: f.name.trim(),
          institution: f.institution.trim() || null,
          account_type_id: parseInt(f.account_type_id, 10),
          subtype: f.subtype || null,
          country_id: f.country_id ? parseInt(f.country_id, 10) : null,
          currency_id: parseInt(f.currency_id, 10),
          customer_id: f.customer_id.trim() || null,
          comments: f.comments.trim() || null,
          account_details: accountDetails,
        };
      },
      refetch,
    });
  };

  // Delete
  const handleDelete = async (account) => {
    if (!window.confirm(`Delete "${account.name}"? This will also delete all assets under this account. This action cannot be undone.`)) return;
    try {
      await api.delete(`/accounts.php?id=${account.id}`);
      await refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete account.');
    }
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
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">
            {accounts.length} account{accounts.length !== 1 ? 's' : ''} across {countryOptions.length} countr{countryOptions.length !== 1 ? 'ies' : 'y'}
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
            <button className="btn btn-primary" onClick={openAddModal}>
              <Plus size={16} /> Add Account
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      {!vaultLocked && accounts.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 34 }}
              type="text"
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
          >
            <option value="">All Countries</option>
            {countryOptions.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All Types</option>
            {accountTypes.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
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
          <div className="empty-icon"><Landmark size={40} /></div>
          <h3>{accounts.length === 0 ? 'No accounts yet' : 'No matching accounts'}</h3>
          <p>
            {accounts.length === 0
              ? 'Add your first account to start organizing your finances.'
              : 'Try adjusting your search or filters.'}
          </p>
        </div>
      )}

      {/* Grouped accounts */}
      {!vaultLocked && grouped.map((group) => {
        const isCollapsed = collapsedGroups[group.country_name];
        return (
          <div className="card mb-4" key={group.country_name}>
            <div
              className="card-header"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => toggleGroup(group.country_name)}
            >
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>{group.flag_emoji}</span>
                <span className="card-title">{group.country_name}</span>
                <span className="badge badge-muted">{group.accounts.length}</span>
              </div>
              <div className="flex items-center gap-3">
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
                          checked={selection.isAllSelected(group.accounts)}
                          ref={(el) => { if (el) el.indeterminate = selection.isSomeSelected(group.accounts); }}
                          onChange={() => selection.toggleAll(group.accounts)}
                        />
                      </th>
                      <SortableTh sortKey="name" current={sortKey} dir={sortDir} onSort={onSort}>Name</SortableTh>
                      <SortableTh sortKey="institution" current={sortKey} dir={sortDir} onSort={onSort}>Institution</SortableTh>
                      <SortableTh sortKey="account_type_name" current={sortKey} dir={sortDir} onSort={onSort}>Type</SortableTh>
                      <SortableTh sortKey="subtype" current={sortKey} dir={sortDir} onSort={onSort}>Subtype</SortableTh>
                      <SortableTh sortKey="currency_code" current={sortKey} dir={sortDir} onSort={onSort}>Currency</SortableTh>
                      <th style={{ textAlign: 'right' }}>Assets</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.accounts.map((a) => (
                      <tr key={a.id} className={selection.isSelected(a.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => crud.setDetailItem(a)}>
                        <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selection.isSelected(a.id)} onChange={() => selection.toggle(a.id)} />
                        </td>
                        <td>
                          <span className="font-medium">{a.name}</span>
                        </td>
                        <td className="td-muted">{a.institution || '--'}</td>
                        <td>
                          <span className="badge badge-primary">
                            {a.account_type_name || '--'}
                          </span>
                        </td>
                        <td className="td-muted">
                          {a.subtype ? a.subtype.toUpperCase() : '--'}
                        </td>
                        <td className="td-muted">{a.currency_code || '--'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="badge badge-muted">{a.asset_count ?? 0}</span>
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
        title={crud.editItem ? 'Edit Account' : 'Add Account'}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={crud.handleCancel} disabled={crud.saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={crud.saving}>
              {crud.saving ? 'Saving...' : crud.editItem ? 'Update Account' : 'Create Account'}
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

        {/* Name & Institution */}
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
              placeholder="e.g. Chase Checking"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Institution</label>
            <input
              className="form-control"
              type="text"
              value={crud.form.institution}
              onChange={(e) => setField('institution', e.target.value)}
              placeholder="e.g. JPMorgan Chase"
            />
          </div>
        </div>

        {/* Type & Subtype */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              Account Type <span className="required">*</span>
            </label>
            <select
              className="form-control"
              value={crud.form.account_type_id}
              onChange={(e) => setField('account_type_id', e.target.value)}
            >
              <option value="">Select type...</option>
              {accountTypes.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Subtype</label>
            <select
              className="form-control"
              value={crud.form.subtype}
              onChange={(e) => setField('subtype', e.target.value)}
            >
              <option value="">None</option>
              {SUBTYPES.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Country & Currency */}
        <div className="form-row">
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
                  {c.flag_emoji} {c.name}
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

        {currencyCountryMismatch && (
          <div className="alert alert-warning mb-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            <span>{currencyCountryMismatch} Ensure this is intentional.</span>
          </div>
        )}

        {/* Customer ID */}
        <div className="form-group">
          <label className="form-label">Customer ID</label>
          <input
            className="form-control"
            type="text"
            value={crud.form.customer_id}
            onChange={(e) => setField('customer_id', e.target.value)}
            placeholder="Your customer/member number"
          />
        </div>

        {/* Comments */}
        <div className="form-group">
          <label className="form-label">Comments</label>
          <textarea
            className="form-control"
            rows={2}
            value={crud.form.comments}
            onChange={(e) => setField('comments', e.target.value)}
            placeholder="General notes about this account..."
          />
        </div>

        {/* Account Details — unified KV editor */}
        <div className="form-group">
          <label className="form-label">Account Details</label>
          <div className="card" style={{ padding: 'var(--space-md)' }}>
            {kvPairs.map((pair, idx) => {
              // Find placeholder from country field_template if key matches
              const normalizedKey = pair.key || (pair.label ? standardizeKey(pair.label) : '');
              const tplField = fieldTemplate.find((f) => standardizeKey(f.label || f.key) === normalizedKey || (f.label || f.key) === pair.label);
              return (
                <div key={idx} className="flex items-center gap-2 mb-2">
                  <input
                    className="form-control"
                    type="text"
                    placeholder="Field name"
                    value={pair.label || ''}
                    onChange={(e) => {
                      const updated = [...kvPairs];
                      const label = e.target.value;
                      updated[idx] = { ...updated[idx], label, key: standardizeKey(label) };
                      setKvPairs(updated);
                    }}
                    style={{ flex: 1 }}
                  />
                  <input
                    className="form-control"
                    type={tplField?.type || 'text'}
                    placeholder={pair.label ? pair.label : (tplField?.placeholder || 'Value')}
                    value={pair.value}
                    onChange={(e) => {
                      const updated = [...kvPairs];
                      updated[idx] = { ...updated[idx], value: e.target.value };
                      setKvPairs(updated);
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon text-danger"
                    title="Remove field"
                    onClick={() => setKvPairs(kvPairs.filter((_, i) => i !== idx))}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setKvPairs([...kvPairs, { key: '', label: '', value: '' }])}
            >
              <Plus size={14} /> Add Field
            </button>

            {/* Template info line */}
            {matchedTemplate && !matchedTemplate.is_global && (
              <div className="form-hint mt-2" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                <span>Using your saved template.</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-danger"
                  style={{ padding: '0 var(--space-xs)', fontSize: '0.75rem' }}
                  onClick={handleDeleteTemplate}
                >
                  Delete Template
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0 var(--space-xs)', fontSize: '0.75rem' }}
                    onClick={() => handleSaveTemplate('global')}
                  >
                    Make Global
                  </button>
                )}
              </div>
            )}
            {matchedTemplate && matchedTemplate.is_global && (
              <div className="form-hint mt-2">
                Using shared template.
              </div>
            )}
            {!matchedTemplate && fieldTemplate.length > 0 && kvPairs.length > 0 && (
              <div className="form-hint mt-2">
                Suggested fields for {selectedCountry?.name || 'selected country'}.
              </div>
            )}

            {/* Browse Templates — show when no template auto-matched */}
            {!matchedTemplate && (accountDetailTemplates || []).length > 0 && (
              <div style={{ marginTop: 'var(--space-sm)' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  onClick={() => setShowBrowseTemplates(!showBrowseTemplates)}
                >
                  {showBrowseTemplates ? 'Hide Templates' : 'Browse Templates'}
                </button>
                {showBrowseTemplates && (
                  <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, padding: 8, background: 'var(--bg-hover)' }}>
                    {(accountDetailTemplates || []).map((t) => {
                      const typeName = accountTypes.find((at) => at.id === t.account_type_id)?.name || `Type #${t.account_type_id}`;
                      const countryName = countries.find((c) => c.id === t.country_id)?.name || `Country #${t.country_id}`;
                      const fields = (t.field_keys || []).map(toDisplayLabel).join(', ');
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid var(--border-color)', gap: 8 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                              {typeName}{t.subtype ? ` / ${t.subtype}` : ''} — {countryName}
                              {t.is_global ? <span className="badge badge-muted" style={{ marginLeft: 6, fontSize: 10 }}>Shared</span> : <span className="badge badge-primary" style={{ marginLeft: 6, fontSize: 10 }}>Personal</span>}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {fields || 'No fields'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: '0.7rem', padding: '2px 10px', flexShrink: 0 }}
                            onClick={() => applyTemplate(t)}
                          >
                            Use
                          </button>
                        </div>
                      );
                    })}
                    {(accountDetailTemplates || []).length === 0 && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
                        No templates available.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {templateMsg && (
              <div className={`alert ${templateMsg.type === 'success' ? 'alert-success' : templateMsg.type === 'info' ? 'alert-info' : 'alert-danger'} mt-2`} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                {templateMsg.text}
              </div>
            )}

            {/* Save as Template button */}
            {crud.form.account_type_id && crud.form.country_id && (
              <div style={{ marginTop: 'var(--space-sm)', textAlign: 'right' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSaveTemplate('personal')}
                  disabled={kvPairs.filter((p) => p.key.trim()).length === 0}
                >
                  Save as Template
                </button>
              </div>
            )}
          </div>
          <span className="form-hint">
            Optional structured data stored as encrypted JSON.
          </span>
        </div>
      </Modal>

      {/* Detail Modal */}
      <AccountDetailModal
        isOpen={!!crud.detailItem}
        onClose={() => crud.setDetailItem(null)}
        item={crud.detailItem}
        onEdit={(account) => openEditModal(account)}
      />

      <BulkEditModal isOpen={showBulkEdit} onClose={() => setShowBulkEdit(false)} entityType="accounts"
        selectedItems={selection.getSelectedItems()} onSaveComplete={() => { selection.clearSelection(); refetch(); }} referenceData={bulkReferenceData} />
      <BulkAddModal isOpen={showBulkAdd} onClose={() => setShowBulkAdd(false)} entityType="accounts"
        onSaveComplete={() => refetch()} referenceData={bulkReferenceData} />
      <ImportModal isOpen={showImport} onClose={() => setShowImport(false)} entityType="accounts"
        onImportComplete={() => refetch()} referenceData={bulkReferenceData} />
    </div>
  );
}
