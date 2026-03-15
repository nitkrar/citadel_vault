import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Database, Eye, EyeOff, Lock, User, Mail, ShieldAlert, Check, Send, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Personal Vault';
const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE || 'Secure Personal Hub';

function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

function getStrengthLabel(score) {
  if (score === 0) return 'Very Weak';
  if (score === 1) return 'Weak';
  if (score === 2) return 'Fair';
  if (score === 3) return 'Good';
  if (score === 4) return 'Strong';
  return 'Very Strong';
}

function getStrengthColor(score) {
  if (score <= 1) return '#ef4444';
  if (score === 2) return '#f59e0b';
  if (score === 3) return '#eab308';
  if (score === 4) return '#22c55e';
  return '#16a34a';
}

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [requestEmail, setRequestEmail] = useState('');
  const [requestName, setRequestName] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const [requestResult, setRequestResult] = useState(null); // { type: 'success'|'error', text }
  const [howToOpen, setHowToOpen] = useState(false);
  const [ipDisclosureAcknowledged, setIpDisclosureAcknowledged] = useState(false);
  const [disableIpLogging, setDisableIpLogging] = useState(false);

  // Invite link handling
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') || '';
  const [inviteValid, setInviteValid] = useState(null); // null=loading, true/false
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteError, setInviteError] = useState('');

  // Registration mode from backend
  const [selfRegOpen, setSelfRegOpen] = useState(null); // null=loading, true/false

  const { register: authRegister } = useAuth();
  const navigate = useNavigate();

  // Check registration status + validate invite token on mount
  useEffect(() => {
    // Fetch registration config
    api.get('/auth.php?action=registration-status')
      .then((res) => {
        const data = res.data?.data || res.data;
        setSelfRegOpen(!!data.self_registration);
      })
      .catch(() => setSelfRegOpen(false));

    // Validate invite token if present
    if (!inviteToken) {
      setInviteValid(false);
      return;
    }
    api.get(`/invitations.php?action=validate&token=${encodeURIComponent(inviteToken)}`)
      .then((res) => {
        const data = res.data?.data || res.data;
        setInviteInfo(data);
        setInviteValid(true);
        setEmail(data.email || '');
      })
      .catch((err) => {
        setInviteValid(false);
        setInviteError(err.response?.data?.error || 'Invalid or expired invite link.');
      });
  }, [inviteToken]);

  const hasValidInvite = inviteValid === true;
  const canRegister = hasValidInvite || selfRegOpen === true;

  const passwordStrength = getPasswordStrength(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!canRegister) {
      setError('Registration requires a valid invite link.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      // Use direct API call to pass invite_token
      const res = await api.post('/auth.php?action=register', {
        username,
        email,
        password,
        invite_token: inviteToken,
      });
      const data = res.data?.data || res.data;
      if (data.requires_verification) {
        setVerificationSent(true);
        return;
      }
      // Cookie set server-side — set preferences then redirect
      if (disableIpLogging) {
        try { await api.put('/preferences.php', { audit_ip_mode: 'none' }); } catch {}
      }
      window.location.href = '/';
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Registration failed. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Verification email sent — show success screen
  if (verificationSent) {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}>
            <Mail size={48} style={{ color: '#2563eb' }} />
          </div>
          <h2 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Check Your Email</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 20 }}>
            We've sent a verification link to <strong>{email}</strong>.
            Please click the link in the email to verify your account, then you can sign in.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 20 }}>
            The link expires in 24 hours. If you don't see it, check your spam folder.
          </p>
          <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

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
          <p>Register to start managing your data securely</p>
        </div>

        {/* Invite status banners */}
        {inviteToken && inviteValid === null && (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Validating invite link...
          </div>
        )}

        {hasValidInvite && inviteInfo && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 8,
            padding: '12px 14px', marginBottom: 16, color: '#065f46', fontSize: '0.85rem', lineHeight: 1.5,
          }}>
            <Check size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Valid Invite</strong> — You've been invited by <strong>{inviteInfo.invited_by}</strong>.
              Create your account using <strong>{inviteInfo.email}</strong>.
            </div>
          </div>
        )}

        {!hasValidInvite && !selfRegOpen && selfRegOpen !== null && inviteValid !== null && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8,
              padding: '12px 14px', color: '#92400e', fontSize: '0.85rem', lineHeight: 1.5,
            }}>
              <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                {inviteError ? (
                  <><strong>Invalid Invite</strong> — {inviteError}</>
                ) : (
                  <><strong>Invitation Only</strong> — Self-registration is currently disabled. You need an invite link to create an account.</>
                )}
              </div>
            </div>

            <div style={{
              background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 8,
              marginTop: 10, fontSize: '0.84rem', lineHeight: 1.6, color: 'var(--text-muted)', overflow: 'hidden',
            }}>
              <button
                type="button"
                onClick={() => setHowToOpen(!howToOpen)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  fontWeight: 600, fontSize: '0.84rem', color: 'var(--text-color)', textAlign: 'left',
                }}
              >
                {howToOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                How to get access
              </button>
              {howToOpen && <div style={{ padding: '0 16px 14px' }}>
              <ol style={{ margin: 0, paddingLeft: 18, marginBottom: 12 }}>
                <li>Ask someone who already has an account to invite you from their Profile page.</li>
                <li>Or, request an invite from the administrator using the form below.</li>
              </ol>

              {requestResult ? (
                <div className={`alert ${requestResult.type === 'success' ? 'alert-success' : 'alert-danger'}`} style={{ padding: '8px 12px', fontSize: '0.8rem' }}>
                  {requestResult.text}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Your name"
                      value={requestName}
                      onChange={(e) => setRequestName(e.target.value)}
                      style={{ flex: 1, fontSize: '0.84rem', padding: '8px 10px' }}
                    />
                    <input
                      type="email"
                      className="form-control"
                      placeholder="Your email address"
                      value={requestEmail}
                      onChange={(e) => setRequestEmail(e.target.value)}
                      required
                      style={{ flex: 1, fontSize: '0.84rem', padding: '8px 10px' }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={requestSending || !requestEmail.trim()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    onClick={async () => {
                      setRequestSending(true);
                      try {
                        const res = await api.post('/invitations.php?action=request', {
                          email: requestEmail.trim(),
                          name: requestName.trim(),
                        });
                        const data = res.data?.data || res.data;
                        setRequestResult({ type: 'success', text: data.message || 'Request sent! The admin will review it and send you an invite.' });
                      } catch (err) {
                        setRequestResult({ type: 'error', text: err.response?.data?.error || 'Failed to send request.' });
                      }
                      setRequestSending(false);
                    }}
                  >
                    <Send size={14} /> {requestSending ? 'Sending...' : 'Request Invite'}
                  </button>
                </div>
              )}
              </div>}
            </div>
          </div>
        )}

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-control"
                style={{ paddingLeft: 36 }}
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="email"
                className="form-control"
                style={{ paddingLeft: 36, ...(hasValidInvite ? { background: 'var(--bg-hover)', color: 'var(--text-muted)' } : {}) }}
                placeholder="Enter your email"
                value={email}
                onChange={(e) => { if (!hasValidInvite) setEmail(e.target.value); }}
                readOnly={hasValidInvite}
                required
                autoComplete="email"
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
                placeholder="Create a password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  padding: 0, display: 'flex'
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(passwordStrength / 5) * 100}%`,
                      height: '100%',
                      backgroundColor: getStrengthColor(passwordStrength),
                      transition: 'width 0.3s, background-color 0.3s',
                    }}
                  />
                </div>
                <span
                  style={{ fontSize: 12, marginTop: 2, display: 'inline-block', color: getStrengthColor(passwordStrength) }}
                >
                  {getStrengthLabel(passwordStrength)}
                </span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className="form-control"
                style={{ paddingLeft: 36, paddingRight: 40 }}
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                tabIndex={-1}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                  padding: 0, display: 'flex'
                }}
              >
                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* IP Disclosure — required acknowledgment */}
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 8,
            padding: '14px 16px', marginTop: 12, marginBottom: 12, fontSize: '0.84rem', lineHeight: 1.6,
          }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8, fontWeight: 600 }}>
              <Shield size={16} style={{ color: '#2563eb' }} /> Security & Privacy
            </div>
            <p style={{ color: 'var(--text-muted)', marginBottom: 10 }}>
              To protect your account, we log security-related actions (logins, vault access, key changes, sharing)
              with a hashed fingerprint of your IP address. This helps detect unauthorized access.
              We never log your day-to-day data activity.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
              <input type="checkbox" checked={ipDisclosureAcknowledged} onChange={(e) => setIpDisclosureAcknowledged(e.target.checked)} />
              <span>I understand <span style={{ color: '#dc2626' }}>*</span></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={disableIpLogging} onChange={(e) => setDisableIpLogging(e.target.checked)} />
              <span>Disable IP Hash logging (can change later)</span>
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full btn-lg"
            disabled={!canRegister || submitting || !ipDisclosureAcknowledged}
            style={{ marginTop: 8, ...(!canRegister || !ipDisclosureAcknowledged ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
          >
            {submitting ? 'Creating account...' : canRegister ? 'Create Account' : 'Invite Required'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
