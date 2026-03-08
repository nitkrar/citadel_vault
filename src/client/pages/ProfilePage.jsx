import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useEncryption } from '../contexts/EncryptionContext';
import { isWebAuthnSupported, registerPasskey } from '../components/WebAuthnLogin';
import {
  User, Mail, Lock, Key, Shield, Trash2, AlertTriangle,
  Check, Eye, EyeOff, Clock, Fingerprint, Plus, Pencil, Copy,
  ChevronDown, ChevronRight, UserPlus, Link as LinkIcon,
} from 'lucide-react';

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const { sessionPreference, updatePreference, vaultUnlocked, viewRecoveryKey, regenerateRecoveryKey, changeVaultKey, changeVaultKeyWithRecovery } = useEncryption();

  // Profile info
  const [profileForm, setProfileForm] = useState({ username: '', email: '' });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // Vault key change
  const [vaultKeyMethod, setVaultKeyMethod] = useState('vault_key');
  const [vaultKeyForm, setVaultKeyForm] = useState({ old_vault_key: '', recovery_key: '', new_vault_key: '', confirm_vault_key: '' });
  const [vaultKeyError, setVaultKeyError] = useState('');
  const [vaultKeySuccess, setVaultKeySuccess] = useState('');
  const [vaultKeySaving, setVaultKeySaving] = useState(false);
  const [newRecoveryKeyFromChange, setNewRecoveryKeyFromChange] = useState('');
  const [newRecoveryKeyCopied, setNewRecoveryKeyCopied] = useState(false);
  const [newRecoverySaved, setNewRecoverySaved] = useState(false);

  // RSA key info
  const [rsaInfo, setRsaInfo] = useState(null);
  const [rsaLoading, setRsaLoading] = useState(true);

  // Vault session pref
  const [vaultPref, setVaultPref] = useState(sessionPreference || 'session');
  const [prefSaving, setPrefSaving] = useState(false);

  // Passkeys
  const [passkeySupported] = useState(() => isWebAuthnSupported());
  const [passkeys, setPasskeys] = useState([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeyAdding, setPasskeyAdding] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');
  const [passkeySuccess, setPasskeySuccess] = useState('');

  // Recovery key viewer
  const [recoveryKeyValue, setRecoveryKeyValue] = useState('');
  const [recoveryKeyLoading, setRecoveryKeyLoading] = useState(false);
  const [recoveryKeyError, setRecoveryKeyError] = useState('');
  const [recoveryKeyCopied, setRecoveryKeyCopied] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenKey, setRegenKey] = useState('');
  const [regenCopied, setRegenCopied] = useState(false);
  const [regenSaved, setRegenSaved] = useState(false);
  const [recoveryAudit, setRecoveryAudit] = useState([]);
  const [showRecoveryAudit, setShowRecoveryAudit] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  // Invite user
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteResult, setInviteResult] = useState(null); // { url, email, expires_at }
  const [inviteError, setInviteError] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteHistory, setInviteHistory] = useState([]);
  const [inviteHistoryLoaded, setInviteHistoryLoaded] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState(null);

  // Self-delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Collapsible sections (all collapsed by default)
  const [collapsed, setCollapsed] = useState({
    profile: true, password: true, vaultKey: true, recovery: true,
    passkeys: true, rsa: true, vaultPref: true, invite: true, deleteAccount: true,
  });
  const toggleSection = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  // Load profile info
  useEffect(() => {
    if (user) {
      setProfileForm({ username: user.username || '', email: user.email || '' });
    }
  }, [user]);

  // Load RSA key status
  useEffect(() => {
    let cancelled = false;
    const loadRsa = async () => {
      setRsaLoading(true);
      try {
        const res = await api.get('/auth.php?action=me');
        const userData = res.data.data || res.data;
        if (!cancelled) setRsaInfo({
          has_public_key: !!userData.has_public_key,
          has_private_key: !!userData.has_encrypted_private_key,
        });
      } catch {
        if (!cancelled) setRsaInfo(null);
      }
      if (!cancelled) setRsaLoading(false);
    };
    loadRsa();
    return () => { cancelled = true; };
  }, []);

  // Sync vault pref
  useEffect(() => {
    setVaultPref(sessionPreference || 'session');
  }, [sessionPreference]);

  // Load passkeys
  useEffect(() => {
    if (!passkeySupported) { setPasskeysLoading(false); return; }
    let cancelled = false;
    api.get('/webauthn.php?action=list')
      .then((res) => { if (!cancelled) setPasskeys(res.data?.data || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPasskeysLoading(false); });
    return () => { cancelled = true; };
  }, [passkeySupported]);

  // === Passkey Actions ===
  const handleAddPasskey = async () => {
    const name = prompt('Give this passkey a name (e.g., "My MacBook"):', 'My Passkey');
    if (name === null) return;
    setPasskeyError('');
    setPasskeySuccess('');
    setPasskeyAdding(true);
    try {
      const result = await registerPasskey(api, name || 'My Passkey');
      setPasskeys((prev) => [{ id: result.id, credential_id: result.credentialId, name: result.name, created_at: new Date().toISOString(), last_used_at: null, transports: [] }, ...prev]);
      setPasskeySuccess('Passkey registered successfully.');
      localStorage.removeItem('pv_passkey_banner_dismissed');
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setPasskeyError(err.response?.data?.error || err.message || 'Failed to register passkey.');
      }
    }
    setPasskeyAdding(false);
  };

  const handleRenamePasskey = async (pk) => {
    const newName = prompt('Rename this passkey:', pk.name || 'Passkey');
    if (newName === null || newName.trim() === '') return;
    try {
      await api.post('/webauthn.php?action=rename', { id: pk.id, name: newName.trim() });
      setPasskeys((prev) => prev.map((p) => p.id === pk.id ? { ...p, name: newName.trim() } : p));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to rename passkey.');
    }
  };

  const handleDeletePasskey = async (pk) => {
    if (!confirm(`Delete passkey "${pk.name || 'Passkey'}"? This cannot be undone.`)) return;
    try {
      await api.post('/webauthn.php?action=delete', { id: pk.id });
      setPasskeys((prev) => prev.filter((p) => p.id !== pk.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete passkey.');
    }
  };

  // === Profile Update ===
  const handleProfileSave = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    if (!profileForm.username.trim()) { setProfileError('Username is required.'); return; }

    setProfileSaving(true);
    try {
      await api.put('/auth.php?action=profile', {
        username: profileForm.username.trim(),
        email: profileForm.email.trim() || null,
      });
      setProfileSuccess('Profile updated successfully.');
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Failed to update profile.');
    }
    setProfileSaving(false);
  };

  // === Password Change ===
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!passwordForm.current_password) { setPasswordError('Current password is required.'); return; }
    if (passwordForm.new_password.length < 8) { setPasswordError('New password must be at least 8 characters.'); return; }
    if (passwordForm.new_password !== passwordForm.confirm_password) { setPasswordError('Passwords do not match.'); return; }

    setPasswordSaving(true);
    try {
      await api.put('/auth.php?action=password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      setPasswordSuccess('Password changed successfully.');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setPasswordError(err.response?.data?.error || 'Failed to change password.');
    }
    setPasswordSaving(false);
  };

  // === Vault Session Preference ===
  const handlePrefChange = async (newPref) => {
    setPrefSaving(true);
    try {
      await updatePreference(newPref);
      setVaultPref(newPref);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update preference.');
    }
    setPrefSaving(false);
  };

  // === Vault Key Change ===
  const handleVaultKeyChange = async (e) => {
    e.preventDefault();
    setVaultKeyError('');
    setVaultKeySuccess('');

    if (vaultKeyForm.new_vault_key.length < 8) {
      setVaultKeyError('New vault key must be at least 8 characters.');
      return;
    }
    if (vaultKeyForm.new_vault_key !== vaultKeyForm.confirm_vault_key) {
      setVaultKeyError('New vault keys do not match.');
      return;
    }
    if (vaultKeyMethod === 'vault_key' && vaultKeyForm.old_vault_key.length < 6) {
      setVaultKeyError('Current vault key must be at least 6 characters.');
      return;
    }
    if (vaultKeyMethod === 'recovery' && !vaultKeyForm.recovery_key.trim()) {
      setVaultKeyError('Recovery key is required.');
      return;
    }

    setVaultKeySaving(true);
    try {
      let result;
      if (vaultKeyMethod === 'vault_key') {
        result = await changeVaultKey(vaultKeyForm.old_vault_key, vaultKeyForm.new_vault_key, vaultKeyForm.confirm_vault_key);
      } else {
        result = await changeVaultKeyWithRecovery(vaultKeyForm.recovery_key.trim(), vaultKeyForm.new_vault_key, vaultKeyForm.confirm_vault_key);
      }
      setVaultKeySuccess('Vault key changed successfully.');
      setVaultKeyForm({ old_vault_key: '', recovery_key: '', new_vault_key: '', confirm_vault_key: '' });
      if (result.recovery_key) {
        setNewRecoveryKeyFromChange(result.recovery_key);
      }
    } catch (err) {
      setVaultKeyError(err.response?.data?.error || 'Failed to change vault key.');
    }
    setVaultKeySaving(false);
  };

  const handleCopyNewRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(newRecoveryKeyFromChange);
      setNewRecoveryKeyCopied(true);
      setTimeout(() => setNewRecoveryKeyCopied(false), 2000);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = newRecoveryKeyFromChange;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setNewRecoveryKeyCopied(true);
      setTimeout(() => setNewRecoveryKeyCopied(false), 2000);
    }
  };

  const handleDismissNewRecoveryKey = () => {
    setNewRecoveryKeyFromChange('');
    setNewRecoverySaved(false);
    setNewRecoveryKeyCopied(false);
  };

  // === Recovery Key Viewer ===
  const handleViewRecoveryKey = async () => {
    setRecoveryKeyError('');
    setRecoveryKeyLoading(true);
    try {
      const key = await viewRecoveryKey();
      setRecoveryKeyValue(key);
    } catch (err) {
      setRecoveryKeyError(err.response?.data?.error || 'Failed to retrieve recovery key.');
    }
    setRecoveryKeyLoading(false);
  };

  const handleHideRecoveryKey = () => {
    setRecoveryKeyValue('');
    setRecoveryKeyCopied(false);
  };

  const handleCopyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKeyValue);
      setRecoveryKeyCopied(true);
      setTimeout(() => setRecoveryKeyCopied(false), 2000);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = recoveryKeyValue;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setRecoveryKeyCopied(true);
      setTimeout(() => setRecoveryKeyCopied(false), 2000);
    }
  };

  // === Regenerate Recovery Key ===
  const handleRegenerateRecoveryKey = async () => {
    if (!confirm('This will invalidate your current recovery key. Are you sure?')) return;
    setRecoveryKeyError('');
    setRegenLoading(true);
    try {
      const key = await regenerateRecoveryKey();
      setRegenKey(key);
      setRecoveryKeyValue(''); // hide the old one
    } catch (err) {
      setRecoveryKeyError(err.response?.data?.error || 'Failed to regenerate recovery key.');
    }
    setRegenLoading(false);
  };

  const handleCopyRegenKey = async () => {
    try {
      await navigator.clipboard.writeText(regenKey);
      setRegenCopied(true);
      setTimeout(() => setRegenCopied(false), 2000);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = regenKey;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setRegenCopied(true);
      setTimeout(() => setRegenCopied(false), 2000);
    }
  };

  const handleDismissRegenKey = () => {
    setRegenKey('');
    setRegenSaved(false);
    setRegenCopied(false);
  };

  // === Recovery Key Audit Log ===
  const loadRecoveryAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await api.get('/encryption.php?action=recovery-audit');
      setRecoveryAudit(res.data?.data || res.data || []);
    } catch {
      setRecoveryAudit([]);
    }
    setAuditLoading(false);
  };

  const toggleRecoveryAudit = () => {
    if (!showRecoveryAudit) loadRecoveryAudit();
    setShowRecoveryAudit(!showRecoveryAudit);
  };

  const auditActionLabel = (action) => {
    switch (action) {
      case 'recovery_key_password_reset': return 'Password reset via recovery key';
      case 'recovery_key_vault_change': return 'Vault key changed via recovery key';
      case 'recovery_key_regenerated': return 'Recovery key regenerated';
      default: return action;
    }
  };

  // === Invite User ===
  const loadInviteHistory = async () => {
    try {
      const res = await api.get('/invitations.php?action=list');
      setInviteHistory(res.data?.data || res.data || []);
      setInviteHistoryLoaded(true);
    } catch {
      setInviteHistory([]);
      setInviteHistoryLoaded(true);
    }
  };

  const copyInviteUrl = async (token) => {
    const origin = window.location.origin;
    const url = `${origin}/register?invite=${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = url;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
    }
    setCopiedHistoryId(token);
    setTimeout(() => setCopiedHistoryId(null), 2000);
  };

  const handleInvite = async () => {
    setInviteError('');
    setInviteResult(null);
    if (!inviteEmail.trim() || !/\S+@\S+\.\S+/.test(inviteEmail)) {
      setInviteError('Please enter a valid email address.');
      return;
    }
    setInviteSending(true);
    try {
      const res = await api.post('/invitations.php?action=create', { email: inviteEmail.trim() });
      const data = res.data?.data || res.data;
      setInviteResult(data);
      setInviteEmail('');
      loadInviteHistory(); // refresh history
    } catch (err) {
      setInviteError(err.response?.data?.error || 'Failed to generate invite.');
    }
    setInviteSending(false);
  };

  const handleCopyInviteLink = async () => {
    if (!inviteResult?.invite_url) return;
    try {
      await navigator.clipboard.writeText(inviteResult.invite_url);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = inviteResult.invite_url;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    }
  };

  const revokeInvite = async (id) => {
    try {
      await api.delete(`/invitations.php?action=revoke&id=${id}`);
      loadInviteHistory();
    } catch (err) {
      setInviteError(err.response?.data?.error || 'Failed to revoke invite.');
    }
  };

  // === Self-Delete ===
  const handleSelfDelete = async () => {
    setDeleteError('');
    if (!deletePassword) { setDeleteError('Password is required to confirm deletion.'); return; }

    setDeleting(true);
    try {
      await api.delete('/auth.php?action=self-delete', { data: { password: deletePassword } });
      logout();
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete account.');
    }
    setDeleting(false);
  };

  const sectionStyle = { marginBottom: 'var(--space-xl)' };

  // Collapsible card header helper
  const CollapsibleHeader = ({ sectionKey, icon, children, style }) => (
    <div
      className="card-header"
      style={{ cursor: 'pointer', userSelect: 'none', ...style }}
      onClick={() => toggleSection(sectionKey)}
    >
      <span className="card-title inline-flex items-center gap-2">
        {icon} {children}
      </span>
      {collapsed[sectionKey] ? <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
    </div>
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Manage your account settings and security</p>
        </div>
      </div>

      {/* === Profile Info === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="profile" icon={<User size={16} />}>Profile Information</CollapsibleHeader>
        {!collapsed.profile && <div className="card-body">
          <form onSubmit={handleProfileSave}>
            {profileError && <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{profileError}</span></div>}
            {profileSuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{profileSuccess}</span></div>}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Username</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="form-control"
                    style={{ paddingLeft: 34 }}
                    type="text"
                    value={profileForm.username}
                    onChange={(e) => setProfileForm(p => ({ ...p, username: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="form-control"
                    style={{ paddingLeft: 34 }}
                    type="email"
                    value={profileForm.email}
                    onChange={(e) => setProfileForm(p => ({ ...p, email: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={profileSaving}>
              {profileSaving ? 'Saving...' : 'Update Profile'}
            </button>
          </form>
        </div>}
      </div>

      {/* === Change Password === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="password" icon={<Lock size={16} />}>Change Password</CollapsibleHeader>
        {!collapsed.password && <div className="card-body">
          <form onSubmit={handlePasswordChange}>
            {passwordError && <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{passwordError}</span></div>}
            {passwordSuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{passwordSuccess}</span></div>}
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="form-control"
                  style={{ paddingLeft: 34, paddingRight: 40 }}
                  type={showCurrentPw ? 'text' : 'password'}
                  value={passwordForm.current_password}
                  onChange={(e) => setPasswordForm(p => ({ ...p, current_password: e.target.value }))}
                  placeholder="Enter current password"
                />
                <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}>
                  {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">New Password</label>
                <div style={{ position: 'relative' }}>
                  <Key size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="form-control"
                    style={{ paddingLeft: 34, paddingRight: 40 }}
                    type={showNewPw ? 'text' : 'password'}
                    value={passwordForm.new_password}
                    onChange={(e) => setPasswordForm(p => ({ ...p, new_password: e.target.value }))}
                    placeholder="Min 8 characters"
                  />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}>
                    {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  className="form-control"
                  type="password"
                  value={passwordForm.confirm_password}
                  onChange={(e) => setPasswordForm(p => ({ ...p, confirm_password: e.target.value }))}
                  placeholder="Re-enter new password"
                />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={passwordSaving}>
              {passwordSaving ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>}
      </div>

      {/* === Change Vault Key === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="vaultKey" icon={<Key size={16} />}>Change Vault Key</CollapsibleHeader>
        {!collapsed.vaultKey && <div className="card-body">
          {!vaultUnlocked ? (
            <p className="text-sm text-muted" style={{ fontStyle: 'italic' }}>
              Unlock your vault to change your vault key.
            </p>
          ) : newRecoveryKeyFromChange ? (
            <div>
              <div className="alert alert-success mb-3"><Check size={16} /><span>Vault key changed successfully.</span></div>
              <p className="text-sm text-muted mb-3">
                A new recovery key has been generated. Save it somewhere safe — it replaces your previous recovery key.
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 12,
                  fontFamily: 'monospace',
                  fontSize: 15,
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ flex: 1 }}>{newRecoveryKeyFromChange}</span>
                <button
                  type="button"
                  onClick={handleCopyNewRecoveryKey}
                  title="Copy recovery key"
                  className="icon-btn"
                  style={{ color: newRecoveryKeyCopied ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }}
                >
                  {newRecoveryKeyCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={newRecoverySaved} onChange={(e) => setNewRecoverySaved(e.target.checked)} />
                I have saved my new recovery key
              </label>
              <button className="btn btn-primary btn-sm" onClick={handleDismissNewRecoveryKey} disabled={!newRecoverySaved}>
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleVaultKeyChange}>
              {vaultKeyError && <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{vaultKeyError}</span></div>}
              {vaultKeySuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{vaultKeySuccess}</span></div>}

              <div className="form-group">
                <label className="form-label">Verify identity using</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`btn btn-sm ${vaultKeyMethod === 'vault_key' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setVaultKeyMethod('vault_key')}
                  >
                    Current Key
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${vaultKeyMethod === 'recovery' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setVaultKeyMethod('recovery')}
                  >
                    Recovery Key
                  </button>
                </div>
              </div>

              {vaultKeyMethod === 'vault_key' ? (
                <div className="form-group">
                  <label className="form-label">Current Vault Key</label>
                  <div style={{ position: 'relative' }}>
                    <Key size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      className="form-control"
                      style={{ paddingLeft: 34 }}
                      type="text"
                      placeholder="Current vault key"
                      value={vaultKeyForm.old_vault_key}
                      onChange={(e) => setVaultKeyForm(p => ({ ...p, old_vault_key: e.target.value }))}
                      autoComplete="off"
                    />
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Recovery Key</label>
                  <div style={{ position: 'relative' }}>
                    <Shield size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      className="form-control"
                      style={{ paddingLeft: 34, fontFamily: 'monospace' }}
                      type="text"
                      placeholder="Enter your recovery key"
                      value={vaultKeyForm.recovery_key}
                      onChange={(e) => setVaultKeyForm(p => ({ ...p, recovery_key: e.target.value }))}
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">New Vault Key</label>
                  <div style={{ position: 'relative' }}>
                    <Key size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      className="form-control"
                      style={{ paddingLeft: 34 }}
                      type="text"
                      placeholder="New key"
                      value={vaultKeyForm.new_vault_key}
                      onChange={(e) => setVaultKeyForm(p => ({ ...p, new_vault_key: e.target.value }))}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm New Key</label>
                  <input
                    className="form-control"
                    type="text"
                    placeholder="Re-enter new key"
                    value={vaultKeyForm.confirm_vault_key}
                    onChange={(e) => setVaultKeyForm(p => ({ ...p, confirm_vault_key: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={vaultKeySaving}>
                {vaultKeySaving ? 'Changing...' : 'Change Vault Key'}
              </button>
            </form>
          )}
        </div>}
      </div>

      {/* === Recovery Key === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="recovery" icon={<Shield size={16} />}>Recovery Key</CollapsibleHeader>
        {!collapsed.recovery && <div className="card-body">
          <p className="text-sm text-muted mb-3">
            Your recovery key can reset your password or vault key if you forget them.
          </p>
          {recoveryKeyError && (
            <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{recoveryKeyError}</span></div>
          )}
          {!vaultUnlocked ? (
            <p className="text-sm text-muted" style={{ fontStyle: 'italic' }}>
              Unlock your vault to view your recovery key.
            </p>
          ) : regenKey ? (
            <div>
              <div className="alert alert-success mb-3"><Check size={16} /><span>Recovery key regenerated. Save your new key — the old one no longer works.</span></div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 12,
                  fontFamily: 'monospace',
                  fontSize: 15,
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ flex: 1 }}>{regenKey}</span>
                <button
                  type="button"
                  onClick={handleCopyRegenKey}
                  title="Copy recovery key"
                  className="icon-btn"
                  style={{ color: regenCopied ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }}
                >
                  {regenCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={regenSaved} onChange={(e) => setRegenSaved(e.target.checked)} />
                I have saved my new recovery key
              </label>
              <button className="btn btn-primary btn-sm" onClick={handleDismissRegenKey} disabled={!regenSaved}>
                Done
              </button>
            </div>
          ) : recoveryKeyValue ? (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginBottom: 12,
                  fontFamily: 'monospace',
                  fontSize: 15,
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ flex: 1 }}>{recoveryKeyValue}</span>
                <button
                  type="button"
                  onClick={handleCopyRecoveryKey}
                  title="Copy recovery key"
                  className="icon-btn"
                  style={{ color: recoveryKeyCopied ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }}
                >
                  {recoveryKeyCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={handleHideRecoveryKey}>
                  <EyeOff size={14} /> Hide
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleRegenerateRecoveryKey} disabled={regenLoading}>
                  <Shield size={14} /> {regenLoading ? 'Regenerating...' : 'Regenerate'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                className="btn btn-primary btn-sm"
                onClick={handleViewRecoveryKey}
                disabled={recoveryKeyLoading}
              >
                <Eye size={14} /> {recoveryKeyLoading ? 'Loading...' : 'View Recovery Key'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRegenerateRecoveryKey}
                disabled={regenLoading}
              >
                <Shield size={14} /> {regenLoading ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          )}

          {/* Recovery Key Audit Log */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
              onClick={toggleRecoveryAudit}
            >
              {showRecoveryAudit ? 'Hide Activity Log' : 'View Activity Log'}
            </button>
            {showRecoveryAudit && (
              <div style={{ marginTop: 8 }}>
                {auditLoading ? (
                  <div className="text-sm text-muted" style={{ padding: 8 }}>Loading...</div>
                ) : recoveryAudit.length === 0 ? (
                  <div className="text-sm text-muted" style={{ padding: 8 }}>No recovery key activity recorded.</div>
                ) : (
                  <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-hover)' }}>
                    {recoveryAudit.map((entry, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: i < recoveryAudit.length - 1 ? '1px solid var(--border-color)' : 'none', gap: 8 }}>
                        <div style={{ fontSize: '0.8rem' }}>{auditActionLabel(entry.action)}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {entry.ip_address && <span style={{ marginRight: 8 }}>{entry.ip_address}</span>}
                          {entry.created_at ? new Date(entry.created_at).toLocaleString() : '--'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>}
      </div>

      {/* === Passkeys === */}
      {passkeySupported && (
        <div className="card" style={sectionStyle}>
          <CollapsibleHeader sectionKey="passkeys" icon={<Fingerprint size={16} />}>Passkeys</CollapsibleHeader>
          {!collapsed.passkeys && <div className="card-body">
            <p className="text-sm text-muted mb-3">
              Passkeys let you sign in using your fingerprint, face, or device PIN instead of a password. Your password still works as a backup.
            </p>
            {passkeyError && <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{passkeyError}</span></div>}
            {passkeySuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{passkeySuccess}</span></div>}

            {passkeysLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : passkeys.length === 0 ? (
              <p className="text-sm text-muted" style={{ textAlign: 'center', padding: '16px 0' }}>
                You haven't set up any passkeys yet. Add one below for faster sign-in.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {passkeys.map((pk) => (
                  <div key={pk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>
                    <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Fingerprint size={16} style={{ color: 'var(--primary)' }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="text-sm" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pk.name || 'Passkey'}</div>
                        <div className="text-sm text-muted" style={{ fontSize: 12 }}>
                          Created {new Date(pk.created_at).toLocaleDateString()}
                          {' · '}
                          Last used: {pk.last_used_at ? new Date(pk.last_used_at).toLocaleDateString() : 'Never'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1" style={{ flexShrink: 0, marginLeft: 8 }}>
                      <button className="icon-btn" onClick={() => handleRenamePasskey(pk)} title="Rename">
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn" onClick={() => handleDeletePasskey(pk)} title="Delete" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button className="btn btn-primary" onClick={handleAddPasskey} disabled={passkeyAdding}>
              <Plus size={14} /> {passkeyAdding ? 'Registering...' : 'Add a new passkey'}
            </button>
          </div>}
        </div>
      )}

      {/* === RSA Key Pair Info === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="rsa" icon={<Shield size={16} />}>RSA Key Pair</CollapsibleHeader>
        {!collapsed.rsa && <div className="card-body">
          {rsaLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : rsaInfo ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-muted">Public Key:</span>
                {rsaInfo.has_public_key ? (
                  <span className="badge badge-success">Configured</span>
                ) : (
                  <span className="badge badge-danger">Not Set</span>
                )}
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-muted">Private Key (encrypted):</span>
                {rsaInfo.has_private_key ? (
                  <span className="badge badge-success">Configured</span>
                ) : (
                  <span className="badge badge-danger">Not Set</span>
                )}
              </div>
              {rsaInfo.created_at && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted">Created:</span>
                  <span className="text-sm">{new Date(rsaInfo.created_at).toLocaleDateString()}</span>
                </div>
              )}
              {!rsaInfo.has_public_key && !rsaInfo.has_private_key && (
                <p className="text-sm text-muted" style={{ marginTop: 12 }}>
                  RSA keys are automatically generated when you first unlock your vault. They are used for secure data sharing between users.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">
              RSA key information is unavailable. Keys will be set up automatically when you use the sharing feature.
            </p>
          )}
        </div>}
      </div>

      {/* === Vault Session Preference === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="vaultPref" icon={<Clock size={16} />}>Vault Session Preference</CollapsibleHeader>
        {!collapsed.vaultPref && <div className="card-body">
          <p className="text-sm text-muted mb-3">
            Control how long your vault stays unlocked after entering your vault key.
          </p>
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'session', label: 'Browser Session', desc: 'Lock when tab closes' },
              { value: 'timed', label: 'Timed (1 hour)', desc: 'Auto-lock after 1 hour' },
              { value: 'login', label: 'Until Logout', desc: 'Stay unlocked until you sign out' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`btn btn-sm ${vaultPref === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handlePrefChange(opt.value)}
                disabled={prefSaving}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="form-hint" style={{ marginTop: 8 }}>
            Current: <strong>{vaultPref === 'session' ? 'Browser Session' : vaultPref === 'timed' ? 'Timed (1 hour)' : 'Until Logout'}</strong>
          </p>
        </div>}
      </div>

      {/* === Invite a User === */}
      <div className="card" style={sectionStyle}>
        <CollapsibleHeader sectionKey="invite" icon={<UserPlus size={16} />}>Invite a User</CollapsibleHeader>
        {!collapsed.invite && <div className="card-body">
          <p className="text-sm text-muted mb-3">
            Generate an invite link for someone to create an account. The link is tied to their email and expires in 7 days.
          </p>
          {inviteError && <div className="alert alert-danger mb-3" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>{inviteError}</div>}
          {inviteResult ? (
            <div>
              <div className="alert alert-success mb-3" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                {inviteResult.reused ? 'An existing invite was found for this email.' : 'Invite link generated!'}
                {inviteResult.email_sent ? ' Email sent to ' + inviteResult.email + '.' : ''} Expires {new Date(inviteResult.expires_at).toLocaleDateString()}.
              </div>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
                  borderRadius: 8, padding: '10px 12px', marginBottom: 12,
                  fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all',
                }}
              >
                <span style={{ flex: 1 }}>{inviteResult.invite_url}</span>
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="icon-btn"
                  title="Copy invite link"
                  style={{ color: inviteCopied ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }}
                >
                  {inviteCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setInviteResult(null); setInviteCopied(false); }}>
                Invite Another
              </button>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="form-control"
                    style={{ paddingLeft: 34 }}
                    type="email"
                    placeholder="Email address to invite"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInvite(); } }}
                  />
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleInvite} disabled={inviteSending} style={{ whiteSpace: 'nowrap' }}>
                <LinkIcon size={14} /> {inviteSending ? 'Generating...' : 'Generate Link'}
              </button>
            </div>
          )}

          {/* Invite History */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
              onClick={() => { if (!inviteHistoryLoaded) loadInviteHistory(); setInviteHistoryLoaded((v) => !v || true); }}
            >
              {inviteHistoryLoaded ? 'Refresh History' : 'View Invite History'}
            </button>
            {inviteHistoryLoaded && (
              <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-hover)' }}>
                {inviteHistory.length === 0 ? (
                  <div className="text-sm text-muted" style={{ padding: 12, textAlign: 'center' }}>No invites sent yet.</div>
                ) : inviteHistory.slice(0, 5).map((inv) => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border-color)', gap: 8, fontSize: '0.8rem' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{inv.email}</span>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {new Date(inv.created_at).toLocaleDateString()}
                        {' · '}
                        {inv.status === 'used' ? (
                          <span style={{ color: 'var(--success)', fontWeight: 500 }}>Used</span>
                        ) : inv.status === 'expired' ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Expired</span>
                        ) : (
                          <span style={{ color: 'var(--primary)', fontWeight: 500 }}>Pending</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                      {inv.status === 'pending' && (
                        <>
                          <a
                            href={`${window.location.origin}/register?invite=${inv.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: '0.7rem', color: 'var(--primary)', textDecoration: 'none', marginRight: 4 }}
                          >
                            Link
                          </a>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Copy invite link"
                            onClick={() => copyInviteUrl(inv.token)}
                            style={{ color: copiedHistoryId === inv.token ? 'var(--success)' : 'var(--text-muted)' }}
                          >
                            {copiedHistoryId === inv.token ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Revoke invite"
                            onClick={() => revokeInvite(inv.id)}
                            style={{ color: 'var(--danger)' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>}
      </div>

      {/* === Self-Delete Account === */}
      <div className="card" style={{ borderColor: 'var(--danger)', ...sectionStyle }}>
        <CollapsibleHeader sectionKey="deleteAccount" icon={<Trash2 size={16} style={{ color: 'var(--danger)' }} />} style={{ borderBottomColor: 'rgba(239,68,68,0.2)' }}><span style={{ color: 'var(--danger)' }}>Delete Account</span></CollapsibleHeader>
        {!collapsed.deleteAccount && <div className="card-body">
          <p className="text-sm mb-3">
            Permanently delete your account and all associated data. This action is irreversible.
          </p>
          {!showDeleteConfirm ? (
            <button
              className="btn btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 size={14} /> Delete My Account
            </button>
          ) : (
            <div>
              {deleteError && (
                <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{deleteError}</span></div>
              )}
              <div className="alert alert-danger mb-3">
                <AlertTriangle size={16} />
                <span>This will permanently delete all your accounts, assets, vault entries, licenses, insurance policies, and shares. This cannot be undone.</span>
              </div>
              <div className="form-group">
                <label className="form-label">Enter your password to confirm</label>
                <input
                  className="form-control"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Your account password"
                />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-danger" onClick={handleSelfDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteError(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
