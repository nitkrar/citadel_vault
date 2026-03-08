import { useState } from 'react';
import { User, Mail, Lock, Check, AlertTriangle, Eye, EyeOff, Edit2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();

  // ── Profile edit ─────────────────────────────────────────────────
  const [editingProfile, setEditingProfile] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const openProfileEdit = () => {
    setEditEmail(user?.email || '');
    setProfileError('');
    setProfileSuccess('');
    setEditingProfile(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setProfileError(''); setProfileSuccess('');
    if (!editEmail.trim()) { setProfileError('Email is required.'); return; }
    setSavingProfile(true);
    try {
      await api.put('/auth.php?action=profile', { email: editEmail.trim() });
      setProfileSuccess('Profile updated.');
      setEditingProfile(false);
      if (refreshUser) refreshUser();
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Password change ──────────────────────────────────────────────
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError(''); setPwSuccess('');
    if (!currentPassword || !newPassword) { setPwError('All fields are required.'); return; }
    if (newPassword !== confirmPassword) { setPwError('New passwords do not match.'); return; }
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters.'); return; }

    setChangingPw(true);
    try {
      await api.put('/auth.php?action=password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setPwSuccess('Password changed successfully.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setShowPasswordChange(false);
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to change password.');
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Profile</h1><p className="page-subtitle">Account information</p></div>
      </div>

      {/* Account Info */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2"><User size={18} /> Account</h3>
          {!editingProfile && (
            <button className="btn btn-ghost btn-sm" onClick={openProfileEdit}><Edit2 size={14} /> Edit</button>
          )}
        </div>

        {profileSuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{profileSuccess}</span></div>}

        {editingProfile ? (
          <form onSubmit={handleSaveProfile} style={{ maxWidth: 400 }}>
            {profileError && <div className="alert alert-danger mb-3">{profileError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: 14, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Username</span>
              <span className="font-medium">{user?.username || '--'} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(not changeable)</span></span>
              <span style={{ color: 'var(--text-muted)' }}>Email</span>
              <input className="form-control" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} required />
              <span style={{ color: 'var(--text-muted)' }}>Role</span>
              <span className="font-medium" style={{ textTransform: 'capitalize' }}>{user?.role || 'user'}</span>
            </div>
            <div className="flex gap-2 mt-3">
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingProfile(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', fontSize: 14 }}>
            <span style={{ color: 'var(--text-muted)' }}>Username</span>
            <span className="font-medium">{user?.username || '--'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Email</span>
            <span className="font-medium">{user?.email || '--'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Role</span>
            <span className="font-medium" style={{ textTransform: 'capitalize' }}>{user?.role || 'user'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Member since</span>
            <span className="font-medium">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : '--'}</span>
          </div>
        )}
      </div>

      {/* Password */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><Lock size={18} /> Login Password</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          This is your login password, separate from your vault key.
        </p>

        {pwSuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{pwSuccess}</span></div>}

        <button className="btn btn-secondary" onClick={() => setShowPasswordChange(!showPasswordChange)}>
          Change Password
        </button>

        {showPasswordChange && (
          <form onSubmit={handleChangePassword} style={{ marginTop: 16, maxWidth: 400 }}>
            {pwError && <div className="alert alert-danger mb-3">{pwError}</div>}
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <div className="flex gap-1">
                <input className="form-control" type={showCurrent ? 'text' : 'password'} value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowCurrent(!showCurrent)}>
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <div className="flex gap-1">
                <input className="form-control" type={showNew ? 'text' : 'password'} value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setShowNew(!showNew)}>
                  {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input className="form-control" type="password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={changingPw}>
              {changingPw ? 'Changing...' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
