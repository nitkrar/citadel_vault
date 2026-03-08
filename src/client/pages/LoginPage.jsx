import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Database, Eye, EyeOff, Fingerprint, Lock, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isWebAuthnSupported } from '../components/WebAuthnLogin';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Personal Vault';
const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE || 'Secure Personal Hub';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const { login, loginWithPasskey } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setPasskeySupported(isWebAuthnSupported());
  }, []);

  const handlePasskeyLogin = async () => {
    setError('');
    setPasskeyLoading(true);
    try {
      await loginWithPasskey();
      navigate('/');
    } catch (err) {
      if (err.name === 'NotAllowedError') return;
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Passkey authentication failed.'
      );
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Login failed. Please check your credentials.'
      );
    } finally {
      setSubmitting(false);
    }
  };

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
          <p>Sign in to your {APP_TAGLINE.toLowerCase()}</p>
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
            <label className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 36, paddingRight: 40 }}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  padding: 0, display: 'flex'
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div style={{ textAlign: 'right', marginTop: 4 }}>
            <Link to="/forgot-password" style={{ fontSize: '0.8125rem', color: 'var(--primary)' }}>
              Forgot password?
            </Link>
          </div>

          <button type="submit" className="btn btn-primary w-full btn-lg" disabled={submitting} style={{ marginTop: 8 }}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {passkeySupported && (
          <>
            <div style={{ position: 'relative', margin: '20px 0' }}>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '100%', borderTop: '1px solid var(--border-color)' }} />
              </div>
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                <span style={{ padding: '0 12px', backgroundColor: 'var(--card-bg)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>or</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading}
              className="btn w-full btn-lg"
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                color: 'var(--text-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Fingerprint size={18} />
              {passkeyLoading ? 'Authenticating...' : 'Sign in with Passkey'}
            </button>
          </>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 500 }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
