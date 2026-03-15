import { useState, useEffect } from 'react';
import api from '../api/client';
import { Settings, Save, Clock, KeyRound, ShieldCheck, UserPlus, Gauge } from 'lucide-react';
import Section from '../components/Section';

const TTL_OPTIONS = [
  { label: '1 hour',   value: '3600' },
  { label: '6 hours',  value: '21600' },
  { label: '12 hours', value: '43200' },
  { label: '24 hours', value: '86400' },
];

const AUTH_CHECK_OPTIONS = [
  { label: '1 minute',   value: '60' },
  { label: '5 minutes',  value: '300' },
  { label: '15 minutes', value: '900' },
  { label: '30 minutes', value: '1800' },
];

const INVITE_EXPIRY_OPTIONS = [
  { label: '1 day',   value: '1' },
  { label: '3 days',  value: '3' },
  { label: '7 days',  value: '7' },
  { label: '14 days', value: '14' },
  { label: '30 days', value: '30' },
];

const LOCKOUT_TIER3_OPTIONS = [
  { label: '1 day',    value: '86400' },
  { label: '7 days',   value: '604800' },
  { label: '30 days',  value: '2592000' },
  { label: '90 days',  value: '7776000' },
];

const BOOLEAN_OPTIONS = [
  { label: 'Enabled',  value: 'true' },
  { label: 'Disabled', value: 'false' },
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

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Local form state
  const [tickerPriceTtl, setTickerPriceTtl] = useState('86400');
  const [defaultVaultTab, setDefaultVaultTab] = useState('account');
  const [authCheckInterval, setAuthCheckInterval] = useState('300');
  const [selfRegistration, setSelfRegistration] = useState('false');
  const [requireEmailVerification, setRequireEmailVerification] = useState('false');
  const [inviteExpiryDays, setInviteExpiryDays] = useState('7');
  const [lockoutTier3Duration, setLockoutTier3Duration] = useState('7776000');
  const [workerEnabled, setWorkerEnabled] = useState('1');
  const [workerThreshold, setWorkerThreshold] = useState('50');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get('/settings.php');
        const data = res.data?.data || res.data || {};
        if (!cancelled) {
          setTickerPriceTtl(data.ticker_price_ttl ?? '86400');
          setDefaultVaultTab(data.default_vault_tab ?? 'account');
          setAuthCheckInterval(data.auth_check_interval ?? '300');
          setSelfRegistration(data.self_registration ?? 'false');
          setRequireEmailVerification(data.require_email_verification ?? 'false');
          setInviteExpiryDays(data.invite_expiry_days ?? '7');
          setLockoutTier3Duration(data.lockout_tier3_duration ?? '7776000');
          setWorkerEnabled(data.worker_enabled ?? '1');
          setWorkerThreshold(data.worker_threshold ?? '50');
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      await api.put('/settings.php', {
        ticker_price_ttl: tickerPriceTtl,
        default_vault_tab: defaultVaultTab,
        auth_check_interval: authCheckInterval,
        self_registration: selfRegistration,
        require_email_verification: requireEmailVerification,
        invite_expiry_days: inviteExpiryDays,
        lockout_tier3_duration: lockoutTier3Duration,
        worker_enabled: workerEnabled,
        worker_threshold: workerThreshold,
      });
      setSuccess('Settings saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-spinner">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><Settings size={22} /> System Settings</h2>
        <p className="text-muted">Configure global application settings.</p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form onSubmit={handleSave}>
        <Section icon={UserPlus} title="Registration" defaultOpen={false}>
          <div className="form-group">
            <label htmlFor="self-registration">Self Registration</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              Allow anyone to create an account. When disabled, users can only join via invite.
            </p>
            <select
              id="self-registration"
              className="form-control"
              value={selfRegistration}
              onChange={(e) => setSelfRegistration(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {BOOLEAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="require-email-verification">Email Verification</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              Require new users to verify their email before they can sign in. Invited users are verified automatically.
            </p>
            <select
              id="require-email-verification"
              className="form-control"
              value={requireEmailVerification}
              onChange={(e) => setRequireEmailVerification(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {BOOLEAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="invite-expiry-days">Invite Link Expiry</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              How long invite links remain valid before they expire.
            </p>
            <select
              id="invite-expiry-days"
              className="form-control"
              value={inviteExpiryDays}
              onChange={(e) => setInviteExpiryDays(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {INVITE_EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section icon={KeyRound} title="Default Vault Tab" defaultOpen={false}>
          <div className="form-group">
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              The tab shown when users open the Vault page. Users can override this in their Profile.
            </p>
            <select
              id="default-vault-tab"
              className="form-control"
              value={defaultVaultTab}
              onChange={(e) => setDefaultVaultTab(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {VAULT_TAB_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section icon={Clock} title="Price Cache" defaultOpen={false}>
          <div className="form-group">
            <label htmlFor="ticker-price-ttl">Price Cache Duration</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              How long to cache fetched stock/crypto prices before refreshing from the source.
            </p>
            <select
              id="ticker-price-ttl"
              className="form-control"
              value={tickerPriceTtl}
              onChange={(e) => setTickerPriceTtl(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {TTL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section icon={ShieldCheck} title="Security" defaultOpen={false}>
          <div className="form-group">
            <label htmlFor="auth-check-interval">Auth Check Interval</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              How often to verify user status (active/role) against the database. Between checks, the JWT token is trusted.
            </p>
            <select
              id="auth-check-interval"
              className="form-control"
              value={authCheckInterval}
              onChange={(e) => setAuthCheckInterval(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {AUTH_CHECK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="lockout-tier3-duration">Permanent Lockout Duration</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              How long to lock an account after repeated failed login attempts (tier 3). Only a password reset unlocks it.
            </p>
            <select
              id="lockout-tier3-duration"
              className="form-control"
              value={lockoutTier3Duration}
              onChange={(e) => setLockoutTier3Duration(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              {LOCKOUT_TIER3_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section icon={Gauge} title="Performance" defaultOpen={false}>
          <div className="form-group">
            <label htmlFor="worker-enabled">Web Worker Encryption</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              Use a Web Worker for encryption/decryption to keep the UI responsive. Disable if you experience compatibility issues.
            </p>
            <select
              id="worker-enabled"
              className="form-control"
              value={workerEnabled}
              onChange={(e) => setWorkerEnabled(e.target.value)}
              style={{ maxWidth: 240 }}
            >
              <option value="1">Enabled</option>
              <option value="0">Disabled</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="worker-threshold">Worker Batch Threshold</label>
            <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
              Number of vault entries above which encryption/decryption is offloaded to a Web Worker. Below this threshold, work runs on the main thread.
            </p>
            <input
              id="worker-threshold"
              type="number"
              className="form-control"
              value={workerThreshold}
              onChange={(e) => setWorkerThreshold(e.target.value)}
              min={1}
              max={10000}
              style={{ maxWidth: 240 }}
            />
          </div>
        </Section>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
