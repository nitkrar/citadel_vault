import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import { invalidateReferenceCache } from '../hooks/useReferenceData';
import Modal from '../components/Modal';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';
import {
  Users, Tag, Briefcase, Globe, DollarSign, Plus, Edit2,
  Trash2, AlertTriangle, RefreshCw, Shield, Check, X, KeyRound, Lock, MessageSquare, Info, Search,
} from 'lucide-react';

const TABS = [
  { key: 'users',        label: 'Users',         icon: Users },
  { key: 'countries',    label: 'Countries',      icon: Globe },
  { key: 'currencies',   label: 'Currencies',     icon: DollarSign },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('pv_admin_last_tab') || 'users');
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    sessionStorage.setItem('pv_admin_last_tab', tab);
  };

  // ===== USERS STATE =====
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', role: 'user', is_active: true });
  const [userFormError, setUserFormError] = useState('');
  const [userSaving, setUserSaving] = useState(false);

  // Admin action modals
  const [showVaultResetModal, setShowVaultResetModal] = useState(false);
  const [vaultResetUser, setVaultResetUser] = useState(null);
  const [vaultResetMessage, setVaultResetMessage] = useState('');
  const [vaultResetSaving, setVaultResetSaving] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalUser, setPasswordModalUser] = useState(null);
  const [passwordModalMode, setPasswordModalMode] = useState(null); // 'temp' | 'force' | null (choosing)
  const [passwordModalTempPass, setPasswordModalTempPass] = useState('');
  const [passwordModalMessage, setPasswordModalMessage] = useState('');
  const [passwordModalError, setPasswordModalError] = useState('');
  const [passwordModalSaving, setPasswordModalSaving] = useState(false);

  // User search for Section 3
  const [userSearch, setUserSearch] = useState('');

  // ===== ACCOUNT TYPES STATE =====
  const [accountTypes, setAccountTypes] = useState([]);
  const [atLoading, setAtLoading] = useState(false);
  const [showAtModal, setShowAtModal] = useState(false);
  const [editAt, setEditAt] = useState(null);
  const [atForm, setAtForm] = useState({ name: '', description: '', icon: '' });
  const [atFormError, setAtFormError] = useState('');
  const [atSaving, setAtSaving] = useState(false);

  // ===== ASSET TYPES STATE =====
  const [assetTypes, setAssetTypes] = useState([]);
  const [astLoading, setAstLoading] = useState(false);
  const [showAstModal, setShowAstModal] = useState(false);
  const [editAst, setEditAst] = useState(null);
  const [astForm, setAstForm] = useState({ name: '', category: '', json_schema: '', icon: '' });
  const [astFormError, setAstFormError] = useState('');
  const [astSaving, setAstSaving] = useState(false);

  // ===== COUNTRIES STATE =====
  const [countries, setCountries] = useState([]);
  const [countriesLoading, setCountriesLoading] = useState(false);

  // ===== CURRENCIES STATE =====
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(false);
  const [refreshingRates, setRefreshingRates] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [togglingCurrency, setTogglingCurrency] = useState(null);

  // ===== DERIVED USER LISTS =====
  const adminUsers = useMemo(() => users.filter(u => u.role === 'admin' || u.role === 'ghost'), [users]);
  const regularUsers = useMemo(() => users.filter(u => u.role === 'user'), [users]);

  // Search + slice for regular users
  const filteredRegularUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    let list = regularUsers;
    if (q) {
      list = list.filter(u =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    } else {
      // No search: show 10 most recently created
      list = [...list].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      }).slice(0, 10);
    }
    return list;
  }, [regularUsers, userSearch]);

  // ===== SORTING =====
  const { sorted: sortedAdminUsers, sortKey: adminSortKey, sortDir: adminSortDir, onSort: onAdminSort } = useSort(adminUsers, 'username', 'asc');
  const { sorted: sortedRegularUsers, sortKey: regSortKey, sortDir: regSortDir, onSort: onRegSort } = useSort(filteredRegularUsers, 'created_at', 'desc');
  const { sorted: sortedAccountTypes, sortKey: atSortKey, sortDir: atSortDir, onSort: onAtSort } = useSort(accountTypes, 'name', 'asc');
  const { sorted: sortedAssetTypes, sortKey: astSortKey, sortDir: astSortDir, onSort: onAstSort } = useSort(assetTypes, 'name', 'asc');
  const { sorted: sortedCountries, sortKey: countrySortKey, sortDir: countrySortDir, onSort: onCountrySort } = useSort(countries, 'display_order', 'asc');
  const { sorted: sortedCurrencies, sortKey: currSortKey, sortDir: currSortDir, onSort: onCurrSort } = useSort(currencies, 'display_order', 'asc');

  // ===== LOAD FUNCTIONS =====
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await api.get('/users.php');
      setUsers(res.data.data || res.data.users || []);
    } catch { /* ignore */ }
    setUsersLoading(false);
  }, []);

  // Account types and asset types are now managed via Templates page
  const loadAccountTypes = useCallback(() => {}, []);
  const loadAssetTypes = useCallback(() => {}, []);

  const loadCountries = useCallback(async () => {
    setCountriesLoading(true);
    try {
      const res = await api.get('/reference.php?resource=countries');
      setCountries(res.data.data || []);
    } catch { /* ignore */ }
    setCountriesLoading(false);
  }, []);

  const loadCurrencies = useCallback(async () => {
    setCurrenciesLoading(true);
    try {
      const res = await api.get('/reference.php?resource=currencies&all=1');
      setCurrencies(res.data.data || []);
    } catch { /* ignore */ }
    setCurrenciesLoading(false);
  }, []);

  // Load data for active tab
  useEffect(() => {
    switch (activeTab) {
      case 'users': loadUsers(); break;
      case 'accountTypes': loadAccountTypes(); break;
      case 'assetTypes': loadAssetTypes(); break;
      case 'countries': loadCountries(); break;
      case 'currencies': loadCurrencies(); break;
    }
  }, [activeTab, loadUsers, loadAccountTypes, loadAssetTypes, loadCountries, loadCurrencies]);

  // ===== USER CRUD =====
  const openUserAdd = () => {
    setEditUser(null);
    setUserForm({ username: '', email: '', password: '', role: 'user', is_active: true });
    setUserFormError('');
    setShowUserModal(true);
  };

  const openUserEdit = (u) => {
    setEditUser(u);
    setUserForm({
      username: u.username || '',
      email: u.email || '',
      password: '',
      role: u.role || 'user',
      is_active: u.is_active == null ? true : !!u.is_active,
    });
    setUserFormError('');
    setShowUserModal(true);
  };

  const saveUser = async () => {
    setUserFormError('');
    if (!userForm.username.trim()) { setUserFormError('Username is required.'); return; }
    if (!editUser && !userForm.password) { setUserFormError('Password is required for new users.'); return; }

    const payload = {
      username: userForm.username.trim(),
      email: userForm.email.trim() || null,
      role: userForm.role,
      is_active: userForm.is_active ? 1 : 0,
    };
    if (userForm.password) payload.password = userForm.password;

    setUserSaving(true);
    try {
      if (editUser) {
        await api.put(`/users.php?id=${editUser.id}`, payload);
      } else {
        await api.post('/users.php', payload);
      }
      setShowUserModal(false);
      await loadUsers();
    } catch (err) {
      setUserFormError(err.response?.data?.error || 'Failed to save user.');
    }
    setUserSaving(false);
  };

  const toggleUserActive = async (u) => {
    const newActive = u.is_active ? 0 : 1;
    try {
      await api.put(`/users.php?id=${u.id}`, { is_active: newActive });
      await loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update user.');
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Permanently delete user "${u.username}"? This will delete ALL their data and cannot be undone.`)) return;
    try {
      await api.delete(`/users.php?id=${u.id}`);
      await loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete user.');
    }
  };

  // --- Password reset: open modal ---
  const openPasswordModal = (u) => {
    setPasswordModalUser(u);
    setPasswordModalMode(null);
    setPasswordModalTempPass('');
    setPasswordModalMessage('');
    setPasswordModalError('');
    setShowPasswordModal(true);
  };

  const submitPasswordModal = async () => {
    setPasswordModalError('');
    setPasswordModalSaving(true);
    try {
      if (passwordModalMode === 'temp') {
        if (passwordModalTempPass.length < 8) {
          setPasswordModalError('Password must be at least 8 characters.');
          setPasswordModalSaving(false);
          return;
        }
        await api.put(`/users.php?action=force-reset-password&id=${passwordModalUser.id}`, {
          password: passwordModalTempPass,
          message: passwordModalMessage || null,
        });
      } else {
        await api.put(`/users.php?action=force-change-password&id=${passwordModalUser.id}`, {
          message: passwordModalMessage || null,
        });
      }
      setShowPasswordModal(false);
      await loadUsers();
    } catch (err) {
      setPasswordModalError(err.response?.data?.error || 'Failed to update password settings.');
    }
    setPasswordModalSaving(false);
  };

  // --- Vault reset: open modal ---
  const openVaultResetModal = (u) => {
    setVaultResetUser(u);
    setVaultResetMessage('');
    setShowVaultResetModal(true);
  };

  const submitVaultReset = async () => {
    setVaultResetSaving(true);
    try {
      await api.put(`/users.php?action=force-reset-vault&id=${vaultResetUser.id}`, {
        message: vaultResetMessage || null,
      });
      setShowVaultResetModal(false);
      await loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to force vault key change.');
    }
    setVaultResetSaving(false);
  };

  // ===== ACCOUNT TYPE CRUD =====
  const openAtAdd = () => {
    setEditAt(null);
    setAtForm({ name: '', description: '', icon: '' });
    setAtFormError('');
    setShowAtModal(true);
  };

  const openAtEdit = (t) => {
    setEditAt(t);
    setAtForm({ name: t.name || '', description: t.description || '', icon: t.icon || '' });
    setAtFormError('');
    setShowAtModal(true);
  };

  const saveAt = async () => {
    setAtFormError('');
    if (!atForm.name.trim()) { setAtFormError('Name is required.'); return; }

    const payload = {
      name: atForm.name.trim(),
      description: atForm.description.trim() || null,
      icon: atForm.icon.trim() || null,
    };

    setAtSaving(true);
    try {
      if (editAt) {
        await api.put(`/reference.php?resource=account-types&id=${editAt.id}`, payload);
      } else {
        await api.post('/reference.php?resource=account-types', payload);
      }
      setShowAtModal(false);
      await loadAccountTypes();
    } catch (err) {
      setAtFormError(err.response?.data?.error || 'Failed to save account type.');
    }
    setAtSaving(false);
  };

  const deleteAt = async (t) => {
    if (!window.confirm(`Delete account type "${t.name}"?`)) return;
    try {
      await api.delete(`/reference.php?resource=account-types&id=${t.id}`);
      await loadAccountTypes();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete account type.');
    }
  };

  // ===== ASSET TYPE CRUD =====
  const openAstAdd = () => {
    setEditAst(null);
    setAstForm({ name: '', category: '', json_schema: '', icon: '' });
    setAstFormError('');
    setShowAstModal(true);
  };

  const openAstEdit = (t) => {
    setEditAst(t);
    let schemaStr = '';
    if (t.json_schema) {
      schemaStr = typeof t.json_schema === 'string' ? t.json_schema : JSON.stringify(t.json_schema, null, 2);
    }
    setAstForm({
      name: t.name || '',
      category: t.category || '',
      json_schema: schemaStr,
      icon: t.icon || '',
    });
    setAstFormError('');
    setShowAstModal(true);
  };

  const saveAst = async () => {
    setAstFormError('');
    if (!astForm.name.trim()) { setAstFormError('Name is required.'); return; }

    let jsonSchema = null;
    if (astForm.json_schema.trim()) {
      try {
        jsonSchema = JSON.parse(astForm.json_schema);
      } catch {
        setAstFormError('JSON Schema must be valid JSON.');
        return;
      }
    }

    const payload = {
      name: astForm.name.trim(),
      category: astForm.category.trim() || null,
      json_schema: jsonSchema,
      icon: astForm.icon.trim() || null,
    };

    setAstSaving(true);
    try {
      if (editAst) {
        await api.put(`/reference.php?resource=asset-types&id=${editAst.id}`, payload);
      } else {
        await api.post('/reference.php?resource=asset-types', payload);
      }
      setShowAstModal(false);
      await loadAssetTypes();
    } catch (err) {
      setAstFormError(err.response?.data?.error || 'Failed to save asset type.');
    }
    setAstSaving(false);
  };

  const deleteAst = async (t) => {
    if (!window.confirm(`Delete asset type "${t.name}"?`)) return;
    try {
      await api.delete(`/reference.php?resource=asset-types&id=${t.id}`);
      await loadAssetTypes();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete asset type.');
    }
  };

  // ===== CURRENCIES: REFRESH RATES =====
  const refreshRates = async () => {
    setRefreshingRates(true);
    try {
      await api.post('/reference.php?resource=refresh-rates');
      invalidateReferenceCache('currencies');
      await loadCurrencies();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to refresh rates.');
    }
    setRefreshingRates(false);
  };

  // ===== CURRENCY TOGGLE =====
  const toggleCurrencyActive = async (c) => {
    const newActive = c.is_active ? 0 : 1;
    setTogglingCurrency(c.id);
    try {
      await api.put(`/reference.php?resource=currencies&id=${c.id}`, { is_active: newActive });
      invalidateReferenceCache('currencies');
      setCurrencies(prev => prev.map(cur => cur.id === c.id ? { ...cur, is_active: newActive } : cur));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to toggle currency.');
    }
    setTogglingCurrency(null);
  };

  // ===== RENDER HELPERS =====
  const isTabLoading = () => {
    switch (activeTab) {
      case 'users': return usersLoading;
      case 'accountTypes': return atLoading;
      case 'assetTypes': return astLoading;
      case 'countries': return countriesLoading;
      case 'currencies': return currenciesLoading;
      default: return false;
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Administration</h1>
          <p className="page-subtitle">Manage users, reference data, and system settings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => handleTabChange(t.key)}
            >
              <span className="flex items-center gap-1"><Icon size={14} /> {t.label}</span>
            </button>
          );
        })}
      </div>

      {isTabLoading() && (
        <div className="loading-center"><div className="spinner" /></div>
      )}

      {/* ===== USERS TAB ===== */}
      {activeTab === 'users' && !usersLoading && (
        <>
          {/* Section 1: Admins & System Users */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Admins &amp; System Users ({adminUsers.length})</span>
              <button className="btn btn-primary btn-sm" onClick={openUserAdd}>
                <Plus size={14} /> Add User
              </button>
            </div>
            <div className="table-wrapper" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <SortableTh sortKey="username" current={adminSortKey} dir={adminSortDir} onSort={onAdminSort}>Username</SortableTh>
                    <SortableTh sortKey="email" current={adminSortKey} dir={adminSortDir} onSort={onAdminSort}>Email</SortableTh>
                    <SortableTh sortKey="role" current={adminSortKey} dir={adminSortDir} onSort={onAdminSort}>Role</SortableTh>
                    <SortableTh sortKey="is_active" current={adminSortKey} dir={adminSortDir} onSort={onAdminSort}>Status</SortableTh>
                    <SortableTh sortKey="has_vault_key" current={adminSortKey} dir={adminSortDir} onSort={onAdminSort}>Vault</SortableTh>
                    <SortableTh sortKey="created_at" current={adminSortKey} dir={adminSortDir} onSort={onAdminSort}>Created</SortableTh>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAdminUsers.map(u => (
                    <tr key={u.id}>
                      <td className="font-medium">
                        <span className="flex items-center gap-2">
                          {u.username}
                          {u.role === 'admin' && <Shield size={14} style={{ color: 'var(--primary)' }} />}
                        </span>
                      </td>
                      <td className="td-muted">{u.email || '--'}</td>
                      <td>
                        <span className={`badge ${u.role === 'admin' ? 'badge-primary' : 'badge-muted'}`}>
                          {u.role === 'admin' ? 'Admin' : u.role === 'ghost' ? 'Ghost' : 'User'}
                        </span>
                      </td>
                      <td>
                        {u.is_active ? (
                          <span className="badge badge-success">Active</span>
                        ) : (
                          <span className="badge badge-danger">Inactive</span>
                        )}
                      </td>
                      <td>
                        {u.has_vault_key ? (
                          <span className="badge badge-success">Set</span>
                        ) : (
                          <span className="badge badge-muted">Not set</span>
                        )}
                      </td>
                      <td className="td-muted">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '--'}
                      </td>
                      <td>
                        <div className="td-actions" style={{ flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openUserEdit(u)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Reset password" onClick={() => openPasswordModal(u)}>
                            <KeyRound size={14} />
                          </button>
                          {u.has_vault_key ? (
                            <button className="btn btn-ghost btn-sm btn-icon" title="Force vault key change" onClick={() => openVaultResetModal(u)}>
                              <Lock size={14} />
                            </button>
                          ) : null}
                          <button
                            className={`btn btn-ghost btn-sm btn-icon ${u.is_active ? 'text-danger' : 'text-success'}`}
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() => toggleUserActive(u)}
                          >
                            {u.is_active ? <X size={14} /> : <Check size={14} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-icon text-danger"
                            title="Delete permanently"
                            onClick={() => deleteUser(u)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {adminUsers.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-muted">No admin or system users</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Search/Filter bar */}
          <div style={{ position: 'relative', margin: '16px 0' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-control"
              placeholder="Search users by username or email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ paddingLeft: 36, height: 40, fontSize: 14, width: '100%' }}
            />
          </div>

          {/* Section 3: Regular Users */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                Users (showing {sortedRegularUsers.length} of {regularUsers.length})
              </span>
            </div>
            <div className="table-wrapper" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <SortableTh sortKey="username" current={regSortKey} dir={regSortDir} onSort={onRegSort}>Username</SortableTh>
                    <SortableTh sortKey="email" current={regSortKey} dir={regSortDir} onSort={onRegSort}>Email</SortableTh>
                    <SortableTh sortKey="role" current={regSortKey} dir={regSortDir} onSort={onRegSort}>Role</SortableTh>
                    <SortableTh sortKey="is_active" current={regSortKey} dir={regSortDir} onSort={onRegSort}>Status</SortableTh>
                    <SortableTh sortKey="has_vault_key" current={regSortKey} dir={regSortDir} onSort={onRegSort}>Vault</SortableTh>
                    <SortableTh sortKey="created_at" current={regSortKey} dir={regSortDir} onSort={onRegSort}>Created</SortableTh>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRegularUsers.map(u => (
                    <tr key={u.id}>
                      <td className="font-medium">
                        <span className="flex items-center gap-2">
                          {u.username}
                        </span>
                      </td>
                      <td className="td-muted">{u.email || '--'}</td>
                      <td>
                        <span className="badge badge-muted">User</span>
                      </td>
                      <td>
                        {u.is_active ? (
                          <span className="badge badge-success">Active</span>
                        ) : (
                          <span className="badge badge-danger">Inactive</span>
                        )}
                      </td>
                      <td>
                        {u.has_vault_key ? (
                          <span className="badge badge-success">Set</span>
                        ) : (
                          <span className="badge badge-muted">Not set</span>
                        )}
                      </td>
                      <td className="td-muted">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '--'}
                      </td>
                      <td>
                        <div className="td-actions" style={{ flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openUserEdit(u)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" title="Reset password" onClick={() => openPasswordModal(u)}>
                            <KeyRound size={14} />
                          </button>
                          {u.has_vault_key ? (
                            <button className="btn btn-ghost btn-sm btn-icon" title="Force vault key change" onClick={() => openVaultResetModal(u)}>
                              <Lock size={14} />
                            </button>
                          ) : null}
                          <button
                            className={`btn btn-ghost btn-sm btn-icon ${u.is_active ? 'text-danger' : 'text-success'}`}
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() => toggleUserActive(u)}
                          >
                            {u.is_active ? <X size={14} /> : <Check size={14} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-icon text-danger"
                            title="Delete permanently"
                            onClick={() => deleteUser(u)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedRegularUsers.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-muted">
                      {userSearch.trim() ? 'No users match your search' : 'No regular users'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===== ACCOUNT TYPES TAB ===== */}
      {activeTab === 'accountTypes' && !atLoading && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Account Types ({accountTypes.length})</span>
            <button className="btn btn-primary btn-sm" onClick={openAtAdd}>
              <Plus size={14} /> Add Type
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="id" current={atSortKey} dir={atSortDir} onSort={onAtSort}>ID</SortableTh>
                  <SortableTh sortKey="name" current={atSortKey} dir={atSortDir} onSort={onAtSort}>Name</SortableTh>
                  <SortableTh sortKey="description" current={atSortKey} dir={atSortDir} onSort={onAtSort}>Description</SortableTh>
                  <SortableTh sortKey="icon" current={atSortKey} dir={atSortDir} onSort={onAtSort}>Icon</SortableTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAccountTypes.map(t => (
                  <tr key={t.id}>
                    <td className="td-muted">{t.id}</td>
                    <td className="font-medium">{t.name}</td>
                    <td className="td-muted">{t.description || '--'}</td>
                    <td className="td-muted">{t.icon || '--'}</td>
                    <td>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openAtEdit(t)}>
                          <Edit2 size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon text-danger" title="Delete" onClick={() => deleteAt(t)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {accountTypes.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted">No account types</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== ASSET TYPES TAB ===== */}
      {activeTab === 'assetTypes' && !astLoading && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Asset Types ({assetTypes.length})</span>
            <button className="btn btn-primary btn-sm" onClick={openAstAdd}>
              <Plus size={14} /> Add Type
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="id" current={astSortKey} dir={astSortDir} onSort={onAstSort}>ID</SortableTh>
                  <SortableTh sortKey="name" current={astSortKey} dir={astSortDir} onSort={onAstSort}>Name</SortableTh>
                  <SortableTh sortKey="category" current={astSortKey} dir={astSortDir} onSort={onAstSort}>Category</SortableTh>
                  <SortableTh sortKey="json_schema" current={astSortKey} dir={astSortDir} onSort={onAstSort}>JSON Schema</SortableTh>
                  <SortableTh sortKey="icon" current={astSortKey} dir={astSortDir} onSort={onAstSort}>Icon</SortableTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAssetTypes.map(t => {
                  const hasSchema = !!(t.json_schema && (typeof t.json_schema === 'string' ? t.json_schema.trim() : Object.keys(t.json_schema).length > 0));
                  return (
                    <tr key={t.id}>
                      <td className="td-muted">{t.id}</td>
                      <td className="font-medium">{t.name}</td>
                      <td className="td-muted">{t.category || '--'}</td>
                      <td>
                        {hasSchema ? (
                          <span className="badge badge-success">Defined</span>
                        ) : (
                          <span className="badge badge-muted">None</span>
                        )}
                      </td>
                      <td className="td-muted">{t.icon || '--'}</td>
                      <td>
                        <div className="td-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => openAstEdit(t)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon text-danger" title="Delete" onClick={() => deleteAst(t)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {assetTypes.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted">No asset types</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== COUNTRIES TAB ===== */}
      {activeTab === 'countries' && !countriesLoading && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Countries ({countries.length})</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="id" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>ID</SortableTh>
                  <SortableTh sortKey="flag_emoji" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Flag</SortableTh>
                  <SortableTh sortKey="name" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Country</SortableTh>
                  <SortableTh sortKey="code" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Country Code</SortableTh>
                  <SortableTh sortKey="default_currency_code" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Default Currency</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedCountries.map(c => (
                    <tr key={c.id}>
                      <td className="td-muted">{c.id}</td>
                      <td style={{ fontSize: 18 }}>{c.flag_emoji || '--'}</td>
                      <td className="font-medium">{c.name}</td>
                      <td className="td-muted font-mono">{c.code || '--'}</td>
                      <td className="td-muted">{c.default_currency_code ? `${c.default_currency_code} (${c.default_currency_symbol})` : '--'}</td>
                    </tr>
                ))}
                {countries.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted">No countries</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== CURRENCIES TAB ===== */}
      {activeTab === 'currencies' && !currenciesLoading && (() => {
        const activeCount = currencies.filter(c => Number(c.is_active)).length;
        const q = currencySearch.toLowerCase().trim();
        const filtered = q
          ? sortedCurrencies.filter(c => c.code.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))
          : sortedCurrencies;
        return (
          <div className="card">
            <div className="card-header">
              <span className="card-title">{activeCount} of {currencies.length} active</span>
              <div className="flex items-center gap-2">
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search currencies..."
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    style={{ paddingLeft: 28, height: 32, fontSize: 13, width: 200 }}
                  />
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={refreshRates}
                  disabled={refreshingRates}
                >
                  <RefreshCw size={14} className={refreshingRates ? 'spin' : ''} />
                  {refreshingRates ? 'Refreshing...' : 'Refresh Rates'}
                </button>
              </div>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <SortableTh sortKey="is_active" current={currSortKey} dir={currSortDir} onSort={onCurrSort} style={{ width: 60 }}>Active</SortableTh>
                    <SortableTh sortKey="code" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Code</SortableTh>
                    <SortableTh sortKey="name" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Name</SortableTh>
                    <SortableTh sortKey="symbol" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Symbol</SortableTh>
                    <SortableTh sortKey="exchange_rate_to_base" current={currSortKey} dir={currSortDir} onSort={onCurrSort} style={{ textAlign: 'right' }}>Rate to Base</SortableTh>
                    <SortableTh sortKey="last_updated" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Updated</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} style={{ opacity: Number(c.is_active) ? 1 : 0.55 }}>
                      <td>
                        <button
                          className={`btn btn-ghost btn-sm btn-icon ${Number(c.is_active) ? 'text-success' : 'text-muted'}`}
                          title={Number(c.is_active) ? 'Click to deactivate' : 'Click to activate'}
                          onClick={() => toggleCurrencyActive(c)}
                          disabled={togglingCurrency === c.id}
                        >
                          {Number(c.is_active) ? <Check size={16} /> : <X size={16} />}
                        </button>
                      </td>
                      <td className="font-medium font-mono">{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.symbol}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">
                        {c.exchange_rate_to_base != null && Number(c.exchange_rate_to_base) !== 0
                          ? Number(c.exchange_rate_to_base).toFixed(6)
                          : '--'}
                      </td>
                      <td className="td-muted">
                        {c.last_updated ? new Date(c.last_updated + 'Z').toLocaleDateString() : '--'}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-muted">
                      {q ? 'No currencies match your search' : 'No currencies'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ===== USER MODAL ===== */}
      <Modal
        isOpen={showUserModal}
        onClose={() => setShowUserModal(false)}
        title={editUser ? 'Edit User' : 'Add User'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowUserModal(false)} disabled={userSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={saveUser} disabled={userSaving}>
              {userSaving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}
            </button>
          </>
        }
      >
        {userFormError && (
          <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{userFormError}</span></div>
        )}
        <div className="form-group">
          <label className="form-label">Username <span className="required">*</span></label>
          <input className="form-control" type="text" value={userForm.username}
            onChange={(e) => setUserForm(p => ({ ...p, username: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-control" type="email" value={userForm.email}
            onChange={(e) => setUserForm(p => ({ ...p, email: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">
            Password {!editUser && <span className="required">*</span>}
          </label>
          <input className="form-control" type="password" value={userForm.password}
            onChange={(e) => setUserForm(p => ({ ...p, password: e.target.value }))}
            placeholder={editUser ? 'Leave blank to keep current' : 'Set password'} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-control" value={userForm.role}
              onChange={(e) => setUserForm(p => ({ ...p, role: e.target.value }))}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
            <label className="form-check">
              <input type="checkbox" checked={userForm.is_active}
                onChange={(e) => setUserForm(p => ({ ...p, is_active: e.target.checked }))} />
              <span>Active</span>
            </label>
          </div>
        </div>
      </Modal>

      {/* ===== ACCOUNT TYPE MODAL ===== */}
      <Modal
        isOpen={showAtModal}
        onClose={() => setShowAtModal(false)}
        title={editAt ? 'Edit Account Type' : 'Add Account Type'}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowAtModal(false)} disabled={atSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={saveAt} disabled={atSaving}>
              {atSaving ? 'Saving...' : editAt ? 'Update' : 'Create'}
            </button>
          </>
        }
      >
        {atFormError && (
          <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{atFormError}</span></div>
        )}
        <div className="form-group">
          <label className="form-label">Name <span className="required">*</span></label>
          <input className="form-control" type="text" value={atForm.name}
            onChange={(e) => setAtForm(p => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Savings Account" />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-control" rows={2} value={atForm.description}
            onChange={(e) => setAtForm(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Icon</label>
          <input className="form-control" type="text" value={atForm.icon}
            onChange={(e) => setAtForm(p => ({ ...p, icon: e.target.value }))}
            placeholder="lucide icon name or emoji" />
        </div>
      </Modal>

      {/* ===== ASSET TYPE MODAL ===== */}
      <Modal
        isOpen={showAstModal}
        onClose={() => setShowAstModal(false)}
        title={editAst ? 'Edit Asset Type' : 'Add Asset Type'}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowAstModal(false)} disabled={astSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={saveAst} disabled={astSaving}>
              {astSaving ? 'Saving...' : editAst ? 'Update' : 'Create'}
            </button>
          </>
        }
      >
        {astFormError && (
          <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{astFormError}</span></div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Name <span className="required">*</span></label>
            <input className="form-control" type="text" value={astForm.name}
              onChange={(e) => setAstForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Equity, Mutual Fund" />
          </div>
          <div className="form-group">
            <label className="form-label">Category</label>
            <input className="form-control" type="text" value={astForm.category}
              onChange={(e) => setAstForm(p => ({ ...p, category: e.target.value }))}
              placeholder="e.g. Investment, Debt, Property" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Icon</label>
          <input className="form-control" type="text" value={astForm.icon}
            onChange={(e) => setAstForm(p => ({ ...p, icon: e.target.value }))}
            placeholder="lucide icon name or emoji" />
        </div>
        <div className="form-group">
          <label className="form-label">JSON Schema</label>
          <textarea className="form-control font-mono" rows={8} value={astForm.json_schema}
            onChange={(e) => setAstForm(p => ({ ...p, json_schema: e.target.value }))}
            placeholder={'{\n  "properties": {\n    "maturity_date": { "type": "string", "title": "Maturity Date" },\n    "interest_rate": { "type": "number", "title": "Interest Rate %" }\n  },\n  "required": ["maturity_date"]\n}'}
          />
          <span className="form-hint">
            Define dynamic fields for assets of this type. Use JSON Schema format with properties.
          </span>
        </div>
      </Modal>

      {/* ===== FORCE VAULT KEY CHANGE MODAL ===== */}
      <Modal
        isOpen={showVaultResetModal}
        onClose={() => setShowVaultResetModal(false)}
        title="Force Vault Key Change"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowVaultResetModal(false)} disabled={vaultResetSaving}>Cancel</button>
            <button className="btn btn-primary" onClick={submitVaultReset} disabled={vaultResetSaving}>
              {vaultResetSaving ? 'Saving...' : 'Force Key Change'}
            </button>
          </>
        }
      >
        <p style={{ marginBottom: 12, fontSize: 14 }}>
          Force <strong>{vaultResetUser?.username}</strong> to change their vault key.
          Data will be preserved.
        </p>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Admin Message (optional)</label>
          <textarea
            className="form-control"
            rows={2}
            value={vaultResetMessage}
            onChange={(e) => setVaultResetMessage(e.target.value)}
            placeholder="Reason shown to user when prompted"
            maxLength={500}
            style={{ minHeight: 56 }}
          />
        </div>
      </Modal>

      {/* ===== PASSWORD RESET MODAL ===== */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title={`Reset Password — ${passwordModalUser?.username || ''}`}
        footer={
          passwordModalMode ? (
            <>
              <button className="btn btn-secondary" onClick={() => setPasswordModalMode(null)} disabled={passwordModalSaving}>Back</button>
              <button className="btn btn-primary" onClick={submitPasswordModal} disabled={passwordModalSaving}>
                {passwordModalSaving ? 'Saving...' : passwordModalMode === 'temp' ? 'Set Temp Password' : 'Force Change'}
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>Cancel</button>
          )
        }
      >
        {!passwordModalMode && (
          <div>
            <p style={{ marginBottom: 16, fontSize: 14 }}>
              Choose an action for <strong>{passwordModalUser?.username}</strong>:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={() => setPasswordModalMode('temp')}
                >
                  Set Temp Password
                </button>
                <span
                  className="info-tip"
                  data-tip="Set a new temporary password. The user must change it on next login."
                  tabIndex={0}
                >
                  <Info size={16} />
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={() => setPasswordModalMode('force')}
                >
                  Force Change Only
                </button>
                <span
                  className="info-tip"
                  data-tip="User keeps their current password but must change it on next login."
                  tabIndex={0}
                >
                  <Info size={16} />
                </span>
              </div>
            </div>
          </div>
        )}

        {passwordModalMode === 'temp' && (
          <div>
            {passwordModalError && (
              <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{passwordModalError}</span></div>
            )}
            <div className="form-group">
              <label className="form-label">Temporary Password <span className="required">*</span></label>
              <input
                className="form-control"
                type="password"
                value={passwordModalTempPass}
                onChange={(e) => setPasswordModalTempPass(e.target.value)}
                placeholder="Min 8 characters"
                autoFocus
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Admin Message (optional)</label>
              <textarea
                className="form-control"
                rows={2}
                value={passwordModalMessage}
                onChange={(e) => setPasswordModalMessage(e.target.value)}
                placeholder="Reason shown to user when prompted"
                maxLength={500}
                style={{ minHeight: 56 }}
              />
            </div>
          </div>
        )}

        {passwordModalMode === 'force' && (
          <div>
            {passwordModalError && (
              <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{passwordModalError}</span></div>
            )}
            <p style={{ marginBottom: 12, fontSize: 14 }}>
              <strong>{passwordModalUser?.username}</strong> keeps their current password but must change it on next login.
            </p>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Admin Message (optional)</label>
              <textarea
                className="form-control"
                rows={2}
                value={passwordModalMessage}
                onChange={(e) => setPasswordModalMessage(e.target.value)}
                placeholder="Reason shown to user when prompted"
                maxLength={500}
                style={{ minHeight: 56 }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
