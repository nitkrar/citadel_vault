import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Database, User, Shield, Lock, Eye, EyeOff, Copy, Check } from 'lucide-react';
import api from '../api/client';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Personal Vault';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  // Phase 1: form
  const [username, setUsername] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Phase 2: recovery key display
  const [newRecoveryKey, setNewRecoveryKey] = useState('');
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('Username or email is required.');
      return;
    }
    if (!recoveryKey.trim()) {
      setError('Recovery key is required.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post('/auth.php?action=forgot-password', {
        username: username.trim(),
        recovery_key: recoveryKey.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      const data = res.data?.data || res.data;

      // Store auth tokens
      if (data.token) {
        localStorage.setItem('pv_token', data.token);
      }
      if (data.data_token) {
        sessionStorage.setItem('pv_data_token', data.data_token);
        if (data.expires_at) {
          sessionStorage.setItem('pv_data_token_expiry', String(data.expires_at));
        }
      }

      // Show new recovery key
      setNewRecoveryKey(data.recovery_key);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Password reset failed. Please check your recovery key.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(newRecoveryKey);
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = newRecoveryKey;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    }
  };

  const handleContinue = () => {
    window.location.href = '/';
  };

  // Phase 2: New recovery key display
  if (newRecoveryKey) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Shield size={48} style={{ color: '#f59e0b', marginBottom: 16 }} />
            <h2 style={{ marginBottom: 8, fontSize: '1.25rem' }}>Password Reset Successful</h2>

            <p style={{ marginBottom: 16, color: '#6b7280', fontSize: 14 }}>
              Your password has been changed. A new recovery key has been generated.
              Save it somewhere safe — it is the <strong>only way</strong> to reset your
              password or vault key if you forget them.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 16,
                fontFamily: 'monospace',
                fontSize: 16,
                wordBreak: 'break-all',
              }}
            >
              <span>{newRecoveryKey}</span>
              <button
                type="button"
                onClick={handleCopyRecovery}
                title="Copy recovery key"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: copiedRecovery ? '#10b981' : '#6b7280',
                  flexShrink: 0,
                }}
              >
                {copiedRecovery ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginBottom: 20,
                fontSize: 14,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
              />
              I have saved my recovery key
            </label>

            <button
              type="button"
              disabled={!savedConfirmed}
              onClick={handleContinue}
              className="btn btn-primary w-full btn-lg"
              style={{
                opacity: savedConfirmed ? 1 : 0.5,
                cursor: savedConfirmed ? 'pointer' : 'not-allowed',
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Phase 1: Form
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div style={{
            width: 56, height: 56,
            background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
            borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto'
          }}>
            <Database size={28} color="#fff" />
          </div>
          <h1>{APP_NAME}</h1>
          <p>Reset your password using your recovery key</p>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username or Email</label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: 36 }}
                placeholder="Enter your username or email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Recovery Key</label>
            <div style={{ position: 'relative' }}>
              <Shield size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: 36, fontFamily: 'monospace' }}
                placeholder="Enter your recovery key"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">New Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showNewPw ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 36, paddingRight: 40 }}
                placeholder="Min 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  padding: 0, display: 'flex'
                }}
              >
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showConfirmPw ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 36, paddingRight: 40 }}
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPw(!showConfirmPw)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  padding: 0, display: 'flex'
                }}
              >
                {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full btn-lg" disabled={submitting} style={{ marginTop: 8 }}>
            {submitting ? 'Resetting Password...' : 'Reset Password'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Remember your password?{' '}
          <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
