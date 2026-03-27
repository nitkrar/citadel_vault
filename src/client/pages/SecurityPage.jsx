import { useState, useCallback } from 'react';
import {
  Shield, Key, Eye, EyeOff, Lock,
  Check, Download, KeyRound, Plus,
} from 'lucide-react';
import api from '../api/client';
import RecoveryKeyCopyBlock from '../components/RecoveryKeyCopyBlock';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import useVaultData from '../hooks/useVaultData';
import { apiData } from '../lib/checks';
import { getUserPreference, VAULT_KEY_MINIMUMS } from '../lib/defaults';
import Section from '../components/Section';

export default function SecurityPage() {
  const { isUnlocked, changeVaultKey, viewRecoveryKey, lock } = useEncryption();
  const { user, preferences, refreshPreferences } = useAuth();

  // ── Vault Key Change ─────────────────────────────────────────────
  const [showChangeKey, setShowChangeKey] = useState(false);
  const [currentKey, setCurrentKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [changingKey, setChangingKey] = useState(false);
  const [changeError, setChangeError] = useState('');
  const [changeSuccess, setChangeSuccess] = useState('');
  const [showKeyValues, setShowKeyValues] = useState(false);

  // Key type change
  const [newKeyType, setNewKeyType] = useState(getUserPreference(preferences, 'vault_key_type'));
  const [savingKeyType, setSavingKeyType] = useState(false);

  const handleChangeKeyType = async (type) => {
    setSavingKeyType(true);
    try {
      await api.put('/preferences.php', { vault_key_type: type });
      setNewKeyType(type);
      refreshPreferences();
    } catch {}
    setSavingKeyType(false);
  };

  const handleChangeKey = async (e) => {
    e.preventDefault();
    setChangeError(''); setChangeSuccess('');
    const minLen = VAULT_KEY_MINIMUMS[newKeyType] || 8;
    if (!currentKey) { setChangeError('Current key is required.'); return; }
    if (newKey.length < minLen) { setChangeError(`New key must be at least ${minLen} characters.`); return; }
    if (newKey === currentKey) { setChangeError('New key must be different from your current key.'); return; }
    if (newKey !== confirmKey) { setChangeError('New keys do not match.'); return; }
    setChangingKey(true);
    try {
      await changeVaultKey(currentKey, newKey);
      setChangeSuccess('Vault key changed successfully.');
      setCurrentKey(''); setNewKey(''); setConfirmKey('');
      setShowChangeKey(false);
    } catch (err) {
      setChangeError(err.message || 'Failed to change vault key.');
    } finally {
      setChangingKey(false);
    }
  };

  // ── Login Password Change ────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassValues, setShowPassValues] = useState(false);
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
    } catch (err) {
      setPwError(err.response?.data?.error || 'Failed to change password.');
    } finally {
      setChangingPw(false);
    }
  };

  // ── RSA Keys ───────────────────────────────────────────────────
  const [hasRsaKeys, setHasRsaKeys] = useState(null); // null = loading
  const [generatingRsa, setGeneratingRsa] = useState(false);

  const checkRsaKeys = useCallback(async () => {
    try {
      const { data: resp } = await api.get('/encryption.php?action=public-key');
      const d = apiData({ data: resp });
      return !!d?.public_key;
    } catch {
      return false;
    }
  }, []);

  const { data: rsaKeysExist } = useVaultData(checkRsaKeys, false);

  const handleGenerateRsa = async () => {
    setGeneratingRsa(true);
    try {
      const { generateKeyPair, exportPublicKey, encryptPrivateKey, _getDekForContext } = await import('../lib/crypto');
      const dek = _getDekForContext();
      const keyPair = await generateKeyPair();
      const publicKey = await exportPublicKey(keyPair.publicKey);
      const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, dek);

      await api.post('/encryption.php?action=setup-rsa', {
        public_key: publicKey,
        encrypted_private_key: encryptedPrivateKey,
      });
      setHasRsaKeys(true);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to generate RSA keys.');
    } finally {
      setGeneratingRsa(false);
    }
  };

  // ── Recovery Key ─────────────────────────────────────────────────
  const [recoveryKey, setRecoveryKey] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [loadingRecovery, setLoadingRecovery] = useState(false);

  const handleViewRecovery = async () => {
    setLoadingRecovery(true);
    try {
      const key = await viewRecoveryKey();
      setRecoveryKey(key);
      setShowRecovery(true);
    } catch (err) {
      alert(err.message || 'Failed to view recovery key.');
    } finally {
      setLoadingRecovery(false);
    }
  };

  // ── Local prefs (shared by auto-lock & privacy) ─────────────────
  const [localPrefs, setLocalPrefs] = useState({});
  const getLocalPref = (key) => localPrefs[key] ?? getUserPreference(preferences, key);

  // ── Privacy: IP logging ──────────────────────────────────────────
  const currentIpMode = getLocalPref('audit_ip_mode');
  const [savingIpMode, setSavingIpMode] = useState(false);

  const handleIpModeChange = async (mode) => {
    setLocalPrefs(prev => ({ ...prev, audit_ip_mode: mode }));
    setSavingIpMode(true);
    try { await api.put('/preferences.php', { audit_ip_mode: mode }); } catch {}
    setSavingIpMode(false);
  };

  // ── Audit log ────────────────────────────────────────────────────
  const fetchAudit = useCallback(async () => {
    const { data: resp } = await api.get('/audit.php');
    return apiData({ data: resp }) || [];
  }, []);

  const { data: auditLog, loading: auditLoading } = useVaultData(fetchAudit, []);
  const autoLockMode = getLocalPref('auto_lock_mode') === 'manual' ? 'session' : getLocalPref('auto_lock_mode');
  const autoLockTimeout = getLocalPref('auto_lock_timeout');
  const [savingAutoLock, setSavingAutoLock] = useState(false);

  const handleAutoLockChange = async (key, value) => {
    setLocalPrefs(prev => ({ ...prev, [key]: value }));
    // Switching to lock_on_refresh: clear cached session DEK so next refresh locks
    if (key === 'vault_persist_session' && value === 'lock_on_refresh') {
      sessionStorage.removeItem('pv_session_dek');
    }
    // Mark that user has customized lock settings (hides default hint on lock screen)
    try { localStorage.setItem('pv_lock_customized', '1'); } catch {}
    setSavingAutoLock(true);
    try { await api.put('/preferences.php', { [key]: value }); } catch {}
    setSavingAutoLock(false);
  };

  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state"><Lock size={40} className="empty-icon" /><h3>Vault is locked</h3><p>Unlock to access security settings.</p></div>
      </div>
    );
  }

  const currentKeyType = newKeyType || getUserPreference(preferences, 'vault_key_type');

  return (
    <div className="page-content">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1 className="page-title">Security</h1><p className="page-subtitle">Vault key, recovery, privacy, and audit log</p></div>
        <button className="btn btn-secondary btn-sm" onClick={() => lock()} style={{ flexShrink: 0 }}>
          <Lock size={14} /> Lock Vault
        </button>
      </div>

      {/* ── Vault Key ──────────────────────────────────────────── */}
      <Section icon={Key} title="Vault Key">
        {/* Auto-lock settings */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Auto-Lock Mode</label>
          <div className="flex gap-2 mb-2">
            {[
              { value: 'timed', label: 'Timed' },
              { value: 'session', label: 'Session' },
            ].map(opt => (
              <button key={opt.value}
                className={`btn btn-sm ${autoLockMode === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => handleAutoLockChange('auto_lock_mode', opt.value)}
                disabled={savingAutoLock}>
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {autoLockMode === 'timed' && 'Vault locks automatically after a period of inactivity. Best balance of security and convenience.'}
            {autoLockMode === 'session' && 'Vault stays unlocked while you use it, but locks when you close the tab or browser. No inactivity timer.'}
          </p>
          {autoLockMode === 'timed' && (
            <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
              <label style={{ fontSize: 13 }}>Timeout:</label>
              <select className="form-control" style={{ width: 160 }} value={autoLockTimeout}
                onChange={e => handleAutoLockChange('auto_lock_timeout', e.target.value)} disabled={savingAutoLock}>
                <option value="300">5 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">1 hour</option>
                <option value="7200">2 hours</option>
                <option value="28800">8 hours</option>
              </select>
            </div>
          )}
        </div>

        {/* Session persistence */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>On Page Refresh</label>
          <div className="flex gap-2 mb-2">
            {[
              { value: 'lock_on_refresh', label: 'Lock vault' },
              { value: 'persist_in_tab', label: 'Stay unlocked in tab' },
            ].map(opt => (
              <button key={opt.value}
                className={`btn btn-sm ${getLocalPref('vault_persist_session') === opt.value ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => handleAutoLockChange('vault_persist_session', opt.value)}
                disabled={savingAutoLock}>
                {opt.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {getLocalPref('vault_persist_session') === 'persist_in_tab'
              ? 'The encryption key (not your vault key) is cached in this tab\'s session storage. Survives refreshes, cleared on tab close. Your vault key is never stored.'
              : 'Encryption key is held in memory only. Refreshing or navigating away requires re-entering your vault key.'}
          </p>
        </div>

        {/* Combined summary */}
        <div style={{ padding: '10px 14px', background: 'var(--bg-secondary, #f3f4f6)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--text-secondary, #4b5563)' }}>
          <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>In practice</strong>
          <p style={{ margin: '4px 0 0' }}>
            {autoLockMode === 'timed' && getLocalPref('vault_persist_session') === 'lock_on_refresh'
              && `Your vault locks after ${({'300':'5 min','900':'15 min','1800':'30 min','3600':'1 hour','7200':'2 hours','28800':'8 hours'})[autoLockTimeout] || autoLockTimeout + 's'} of inactivity and every time you refresh the page. You'll enter your vault key frequently.`}
            {autoLockMode === 'timed' && getLocalPref('vault_persist_session') === 'persist_in_tab'
              && `Your vault locks after ${({'300':'5 min','900':'15 min','1800':'30 min','3600':'1 hour','7200':'2 hours','28800':'8 hours'})[autoLockTimeout] || autoLockTimeout + 's'} of inactivity but survives page refreshes. Closing the tab locks it.`}
            {autoLockMode === 'session' && getLocalPref('vault_persist_session') === 'lock_on_refresh'
              && 'Your vault locks when you refresh the page or close the tab. No inactivity timer, but refreshes require re-entry.'}
            {autoLockMode === 'session' && getLocalPref('vault_persist_session') === 'persist_in_tab'
              && 'Your vault stays unlocked for the entire browser tab session. Only closing the tab or clicking "Lock Vault" locks it.'}
          </p>
        </div>

        {/* Key type selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Key Type</label>
          <div className="flex gap-2">
            {Object.entries({ numeric: 'PIN', alphanumeric: 'Password', passphrase: 'Passphrase' }).map(([type, label]) => (
              <button key={type}
                className={`btn btn-sm ${currentKeyType === type ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => handleChangeKeyType(type)}
                disabled={savingKeyType}>
                {label} ({VAULT_KEY_MINIMUMS[type]}+ chars)
              </button>
            ))}
          </div>
        </div>

        {/* Change key */}
        {changeSuccess && <div className="alert alert-success mb-3"><Check size={14} /> {changeSuccess}</div>}

        {!showChangeKey ? (
          <button className="btn btn-secondary" onClick={() => { setShowChangeKey(true); setChangeError(''); setChangeSuccess(''); }}>
            <Key size={14} /> Change Vault Key
          </button>
        ) : (
          <form onSubmit={handleChangeKey} style={{ maxWidth: 400 }}>
            {changeError && <div className="alert alert-danger mb-3">{changeError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKeyValues(v => !v)} style={{ fontSize: 12, gap: 4 }}>
                {showKeyValues ? <EyeOff size={14} /> : <Eye size={14} />} {showKeyValues ? 'Hide values' : 'Show values'}
              </button>
            </div>
            <div className="form-group">
              <label className="form-label">Current Vault Key</label>
              <input className="form-control" type={showKeyValues ? 'text' : 'password'} value={currentKey} onChange={e => setCurrentKey(e.target.value)} autoComplete="off" autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">New Vault Key ({VAULT_KEY_MINIMUMS[currentKeyType] || 8}+ characters)</label>
              <input className="form-control" type={showKeyValues ? 'text' : 'password'} value={newKey} onChange={e => setNewKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Key</label>
              <input className="form-control" type={showKeyValues ? 'text' : 'password'} value={confirmKey} onChange={e => setConfirmKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={changingKey}>{changingKey ? 'Changing...' : 'Change Key'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setShowChangeKey(false); setCurrentKey(''); setNewKey(''); setConfirmKey(''); setChangeError(''); }}>Cancel</button>
            </div>
          </form>
        )}
      </Section>

      {/* ── Login Password ────────────────────────────────────── */}
      <Section icon={Lock} title="Login Password">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          This is your login password, separate from your vault key.
        </p>
        {pwSuccess && <div className="alert alert-success mb-3"><Check size={14} /> {pwSuccess}</div>}
        <form onSubmit={handleChangePassword} style={{ maxWidth: 400 }}>
          {pwError && <div className="alert alert-danger mb-3">{pwError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPassValues(v => !v)} style={{ fontSize: 12, gap: 4 }}>
              {showPassValues ? <EyeOff size={14} /> : <Eye size={14} />} {showPassValues ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input className="form-control" type={showPassValues ? 'text' : 'password'} value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input className="form-control" type={showPassValues ? 'text' : 'password'} value={newPassword}
              onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input className="form-control" type={showPassValues ? 'text' : 'password'} value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={changingPw}>
            {changingPw ? 'Changing...' : 'Update Password'}
          </button>
        </form>
      </Section>

      {/* ── RSA Keys (Sharing) ─────────────────────────────────── */}
      <Section icon={KeyRound} title="Sharing Keys (RSA)">
        {rsaKeysExist ? (
          <div className="flex items-center gap-2">
            <Check size={16} style={{ color: '#22c55e' }} />
            <span style={{ fontSize: 14 }}>RSA key pair is configured. You can share and receive entries.</span>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
              RSA keys are required for sharing entries with other users. Your account does not have them yet — this can happen if the account was created from the backend.
            </p>
            <button className="btn btn-primary" onClick={handleGenerateRsa} disabled={generatingRsa}>
              <Plus size={14} /> {generatingRsa ? 'Generating...' : 'Generate RSA Keys'}
            </button>
          </div>
        )}
      </Section>

      {/* ── Recovery Key ───────────────────────────────────────── */}
      <Section icon={Shield} title="Recovery Key">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Your recovery key is the only way to regain access if you forget your vault key.
        </p>
        {showRecovery ? (
          <div>
            <RecoveryKeyCopyBlock recoveryKey={recoveryKey} />
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowRecovery(false); setRecoveryKey(''); }}>Hide</button>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={handleViewRecovery} disabled={loadingRecovery}>
            <Eye size={14} /> {loadingRecovery ? 'Decrypting...' : 'View Recovery Key'}
          </button>
        )}
      </Section>

      {/* ── Privacy ────────────────────────────────────────────── */}
      <Section icon={EyeOff} title="Privacy">
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Security actions are logged with a one-way hash of your IP address. You can disable IP logging entirely.
        </p>
        <div className="flex gap-2">
          <button className={`btn btn-sm ${currentIpMode === 'hashed' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => handleIpModeChange('hashed')} disabled={savingIpMode}>
            Hashed IP (recommended)
          </button>
          <button className={`btn btn-sm ${currentIpMode === 'none' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => handleIpModeChange('none')} disabled={savingIpMode}>
            No IP logging
          </button>
        </div>
      </Section>

      {/* ── Security Log ───────────────────────────────────────── */}
      <Section icon={Clock} title="Security Log">
        {auditLoading ? <div className="spinner" /> :
          auditLog.length === 0 ? <p className="text-muted">No security events recorded.</p> : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ width: '100%' }}>
                <thead><tr><th>Action</th><th>Date</th></tr></thead>
                <tbody>{auditLog.slice(0, 10).map((entry, i) => (
                  <tr key={i}>
                    <td style={{ textTransform: 'capitalize' }}>{entry.action?.replace(/_/g, ' ')}</td>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString()}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )
        }
      </Section>

    </div>
  );
}
