import { useState, Fragment } from 'react';
import { User, Check, AlertTriangle, Edit2, Keyboard, Send, Copy, UserPlus, DollarSign, RefreshCw, KeyRound } from 'lucide-react';
import Section from '../components/Section';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import useCurrencies from '../hooks/useCurrencies';
import { getUserPreference } from '../lib/defaults';
import useAppConfig from '../hooks/useAppConfig';

const SYNC_INTERVAL_OPTIONS = [
  { label: 'Every 15 minutes', value: '900' },
  { label: 'Every 30 minutes', value: '1800' },
  { label: 'Every 1 hour', value: '3600' },
  { label: 'Off', value: '0' },
];

const VAULT_TAB_OPTIONS = [
  { label: 'All',        value: 'all' },
  { label: 'Accounts',   value: 'account' },
  { label: 'Assets',     value: 'asset' },
  { label: 'Passwords',  value: 'password' },
  { label: 'Licenses',   value: 'license' },
  { label: 'Insurance',  value: 'insurance' },
  { label: 'Custom',     value: 'custom' },
];

export default function ProfilePage() {
  const { user, refreshUser, preferences, refreshPreferences } = useAuth();
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
  // ── Sync Interval ─────────────────────────────────────────────
  const [syncIntervalValue, setSyncIntervalValue] = useState(getUserPreference(preferences || {}, 'sync_interval'));
  const [savingSyncInterval, setSavingSyncInterval] = useState(false);
  const [syncIntervalSuccess, setSyncIntervalSuccess] = useState('');

  const handleSyncIntervalChange = async (e) => {
    const val = e.target.value;
    setSyncIntervalValue(val);
    setSyncIntervalSuccess('');
    setSavingSyncInterval(true);
    try {
      await api.put('/preferences.php', { sync_interval: val });
      setSyncIntervalSuccess('Sync interval updated.');
      if (refreshPreferences) refreshPreferences();
    } catch {}
    setSavingSyncInterval(false);
  };

  // ── Default Vault Tab ─────────────────────────────────────────
  const { config } = useAppConfig();
  const siteDefaultTab = config.default_vault_tab || 'account';
  const [defaultVaultTab, setDefaultVaultTab] = useState(
    getUserPreference(preferences || {}, 'default_vault_tab') || ''
  );
  const [savingVaultTab, setSavingVaultTab] = useState(false);
  const [vaultTabSuccess, setVaultTabSuccess] = useState('');

  const handleVaultTabChange = async (e) => {
    const val = e.target.value;
    setDefaultVaultTab(val);
    setVaultTabSuccess('');
    setSavingVaultTab(true);
    try {
      await api.put('/preferences.php', { default_vault_tab: val });
      setVaultTabSuccess('Default vault tab updated.');
      if (refreshPreferences) refreshPreferences();
      setTimeout(() => setVaultTabSuccess(''), 3000);
    } catch {}
    setSavingVaultTab(false);
  };

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
        <div><h1 className="page-title">Profile</h1><p className="page-subtitle">Account information &amp; preferences</p></div>
      </div>

      {/* Account Info */}
      <Section icon={User} title="Account" defaultOpen>
        <div className="flex items-center justify-between mb-3">
          {!editingProfile && (
            <button className="btn btn-ghost btn-sm" onClick={openProfileEdit} style={{ marginLeft: 'auto' }}><Edit2 size={14} /> Edit</button>
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
      </Section>

      {/* Invite Someone */}
      <Section icon={UserPlus} title="Invite Someone">
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
      </Section>

      {/* Display Currency */}
      <Section icon={DollarSign} title="Display Currency">
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
      </Section>

      {/* Sync Interval */}
      <Section icon={RefreshCw} title="Sync Interval">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          How often to check for changes from other devices. Set to "Off" to disable automatic sync.
        </p>

        {syncIntervalSuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{syncIntervalSuccess}</span></div>}

        <select
          className="form-control"
          style={{ maxWidth: 300 }}
          value={syncIntervalValue}
          onChange={handleSyncIntervalChange}
          disabled={savingSyncInterval}
        >
          {SYNC_INTERVAL_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Section>

      {/* Default Vault Tab */}
      <Section icon={KeyRound} title="Default Vault Tab">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Which tab to show when you open the Vault page. Navigating from the dashboard overrides this.
        </p>

        {vaultTabSuccess && <div className="alert alert-success mb-3"><Check size={16} /><span>{vaultTabSuccess}</span></div>}

        <select
          className="form-control"
          style={{ maxWidth: 300 }}
          value={defaultVaultTab}
          onChange={handleVaultTabChange}
          disabled={savingVaultTab}
        >
          <option value="">Site default ({VAULT_TAB_OPTIONS.find(o => o.value === siteDefaultTab)?.label || siteDefaultTab})</option>
          {VAULT_TAB_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Section>

      {/* Keyboard Shortcuts (desktop only) */}
      {isDesktop && (
        <Section icon={Keyboard} title="Keyboard Shortcuts">
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
        </Section>
      )}
    </div>
  );
}
