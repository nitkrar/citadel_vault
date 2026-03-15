import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';
import {
  Users, Plus, Edit2, Trash2, AlertTriangle, Shield,
  Check, X, KeyRound, Lock, Info, Search,
} from 'lucide-react';

export default function UsersPage() {
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

  // User search
  const [userSearch, setUserSearch] = useState('');

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

  // ===== LOAD FUNCTIONS =====
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await api.get('/users.php');
      setUsers(res.data.data || res.data.users || []);
    } catch { /* ignore */ }
    setUsersLoading(false);
  }, []);

  // Load users on mount
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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

  // ===== USER ROW ACTIONS =====
  const renderUserActions = (u) => (
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
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title"><Users size={22} style={{ verticalAlign: -4, marginRight: 8 }} />User Management</h1>
          <p className="page-subtitle">Manage user accounts, roles, and security</p>
        </div>
      </div>

      {usersLoading && (
        <div className="loading-center"><div className="spinner" /></div>
      )}

      {!usersLoading && (
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
                      <td>{renderUserActions(u)}</td>
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
                      <td>{renderUserActions(u)}</td>
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
