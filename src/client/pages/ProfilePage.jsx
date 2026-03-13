import { useState, Fragment } from 'react';
import { User, Check, AlertTriangle, Edit2, Keyboard, ChevronDown, ChevronRight, Send, Copy, UserPlus, DollarSign } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import useCurrencies from '../hooks/useCurrencies';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { isDesktop, settings: shortcutSettings, toggleShortcut, SHORTCUT_DEFS } = useKeyboardShortcuts();

  // ── Display Currency ────────────────────────────────────────────
  const { currencies: currencyList } = useCurrencies();
  const [displayCurrencyValue, setDisplayCurrencyValue] = useState(user?.display_currency || '');
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencySuccess, setCurrencySuccess] = useState('');

  const handleCurrencyChange = async (e) => {
    const val = e.target.value;
    setDisplayCurrencyValue(val);
    setCurrencySuccess('');
    setSavingCurrency(true);
    try {
      await api.put('/preferences.php', { display_currency: val || '' });
      setCurrencySuccess('Display currency updated.');
      if (refreshUser) refreshUser();
    } catch {}
    setSavingCurrency(false);
  };
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // ── Profile edit ─────────────────────────────────────────────────
  const [editingProfile, setEditingProfile] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const openProfileEdit = () => {
    setEditDisplayName(user?.display_name || '');
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
      await api.put('/auth.php?action=profile', {
        display_name: editDisplayName.trim(),
        email: editEmail.trim(),
      });
      setProfileSuccess('Profile updated.');
      setEditingProfile(false);
      if (refreshUser) refreshUser();
    } catch (err) {
      setProfileError(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Invite someone ─────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState(null); // { type, text, url? }
  const [copied, setCopied] = useState(false);

  const handleSendInvite = async (e) => {
    e.preventDefault();
    setInviteResult(null);
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    try {
      const res = await api.post('/invitations.php?action=create', { email: inviteEmail.trim() });
      const data = res.data?.data || res.data;
      setInviteResult({
        type: 'success',
        text: data.email_sent
          ? `Invite sent to ${inviteEmail.trim()}!`
          : `Invite created! Share the link below with ${inviteEmail.trim()}.`,
        url: data.invite_url,
        reused: data.reused,
      });
      if (!data.reused) setInviteEmail('');
    } catch (err) {
      setInviteResult({ type: 'error', text: err.response?.data?.error || 'Failed to create invite.' });
    } finally {
      setInviteSending(false);
    }
  };

  const copyInviteUrl = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              <span style={{ color: 'var(--text-muted)' }}>Display Name</span>
              <input className="form-control" type="text" value={editDisplayName} onChange={e => setEditDisplayName(e.target.value)} placeholder="Your name" />
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
            <span style={{ color: 'var(--text-muted)' }}>Name</span>
            <span className="font-medium">{user?.display_name || <span style={{ color: 'var(--text-muted)' }}>Not set</span>}</span>
            <span style={{ color: 'var(--text-muted)' }}>Email</span>
            <span className="font-medium">{user?.email || '--'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Role</span>
            <span className="font-medium" style={{ textTransform: 'capitalize' }}>{user?.role || 'user'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Member since</span>
            <span className="font-medium">{user?.created_at ? new Date(user.created_at).toLocaleDateString() : '--'}</span>
          </div>
        )}
      </div>

      {/* Invite Someone */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><UserPlus size={18} /> Invite Someone</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Send an invite link to someone you'd like to join. The link expires in 7 days.
        </p>

        {inviteResult && (
          <div className={`alert ${inviteResult.type === 'success' ? 'alert-success' : 'alert-danger'} mb-3`}>
            {inviteResult.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span>{inviteResult.text}</span>
          </div>
        )}

        {inviteResult?.url && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <input className="form-control" type="text" value={inviteResult.url} readOnly
              style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', background: 'var(--bg-secondary, #f9fafb)' }}
              onClick={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyInviteUrl(inviteResult.url)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        <form onSubmit={handleSendInvite} style={{ display: 'flex', gap: 8, maxWidth: 500 }}>
          <input className="form-control" type="email" placeholder="Email address" value={inviteEmail}
            onChange={(e) => { setInviteEmail(e.target.value); setInviteResult(null); }}
            required style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={inviteSending || !inviteEmail.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Send size={14} /> {inviteSending ? 'Sending...' : 'Send Invite'}
          </button>
        </form>
      </div>

      {/* Display Currency */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><DollarSign size={18} /> Display Currency</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Choose which currency to display portfolio values in. Defaults to the server base currency.
        </p>

        {currencySuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{currencySuccess}</span></div>}

        <select
          className="form-control"
          style={{ maxWidth: 300 }}
          value={displayCurrencyValue}
          onChange={handleCurrencyChange}
          disabled={savingCurrency}
        >
          <option value="">Base currency (default)</option>
          {(currencyList || []).filter(c => c.is_active === 1 || c.is_active === '1' || c.is_active === true).map(c => (
            <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
          ))}
        </select>
      </div>

      {/* Keyboard Shortcuts (desktop only) */}
      {isDesktop && (
        <div className="card mb-4" style={{ padding: 0 }}>
          <button type="button" onClick={() => setShortcutsOpen(!shortcutsOpen)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 16, fontWeight: 600 }}>
            {shortcutsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Keyboard size={18} /> Keyboard Shortcuts
          </button>
          {shortcutsOpen && (
            <div style={{ padding: '0 20px 20px' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Toggle individual shortcuts on or off. Uses the <kbd style={{ fontSize: 11, background: 'var(--bg-secondary, #f3f4f6)', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 3, padding: '1px 5px' }}>Ctrl</kbd> key (not Cmd on Mac).
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SHORTCUT_DEFS.map(s => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 6, background: 'var(--bg-secondary, #f9fafb)', cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={!!shortcutSettings[s.id]} onChange={() => toggleShortcut(s.id)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <kbd style={{ fontSize: 12, background: 'var(--bg, #fff)', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 4, padding: '2px 8px', fontFamily: 'monospace', minWidth: 56, textAlign: 'center' }}>
                      Ctrl+{s.key === '/' ? '/' : s.key.toUpperCase()}
                    </kbd>
                    <span style={{ flex: 1 }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.when}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
