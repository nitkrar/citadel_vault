import { useState, useCallback } from 'react';
import {
  Shield, Key, Eye, EyeOff, Lock, Clock, Fingerprint, AlertTriangle,
  Copy, Check, Download, Trash2, Plus, RefreshCw,
} from 'lucide-react';
import api from '../api/client';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import useVaultData from '../hooks/useVaultData';
import { apiData, isTruthy } from '../lib/checks';
import { getUserPreference, VAULT_KEY_MINIMUMS } from '../lib/defaults';

export default function SecurityPage() {
  const { isUnlocked, preferences, changeVaultKey, viewRecoveryKey, lock } = useEncryption();
  const { user } = useAuth();

  // ── Vault Key Change ─────────────────────────────────────────────
  const [showChangeKey, setShowChangeKey] = useState(false);
  const [currentKey, setCurrentKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [changingKey, setChangingKey] = useState(false);
  const [changeError, setChangeError] = useState('');
  const [changeSuccess, setChangeSuccess] = useState('');

  const handleChangeKey = async (e) => {
    e.preventDefault();
    setChangeError(''); setChangeSuccess('');
    if (!currentKey || !newKey) { setChangeError('Both fields are required.'); return; }
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

  // ── Recovery Key ─────────────────────────────────────────────────
  const [recoveryKey, setRecoveryKey] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [loadingRecovery, setLoadingRecovery] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

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

  const handleCopyRecovery = async () => {
    try { await navigator.clipboard.writeText(recoveryKey); } catch {}
    setCopiedRecovery(true);
    setTimeout(() => setCopiedRecovery(false), 2000);
  };

  // ── Privacy: IP logging ──────────────────────────────────────────
  const currentIpMode = getUserPreference(preferences, 'audit_ip_mode');
  const [savingIpMode, setSavingIpMode] = useState(false);

  const handleIpModeChange = async (mode) => {
    setSavingIpMode(true);
    try {
      await api.put('/preferences.php', { audit_ip_mode: mode });
      // preferences will be stale — user needs to re-unlock for fresh state
    } catch {}
    setSavingIpMode(false);
  };

  // ── Audit log ────────────────────────────────────────────────────
  const fetchAudit = useCallback(async () => {
    const { data: resp } = await api.get('/audit.php');
    return apiData({ data: resp }) || [];
  }, []);

  const { data: auditLog, loading: auditLoading } = useVaultData(fetchAudit, []);

  // ── Auto-lock settings ───────────────────────────────────────────
  const autoLockMode = getUserPreference(preferences, 'auto_lock_mode');
  const autoLockTimeout = getUserPreference(preferences, 'auto_lock_timeout');

  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state"><Lock size={40} className="empty-icon" /><h3>Vault is locked</h3><p>Unlock to access security settings.</p></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Security</h1><p className="page-subtitle">Vault key, recovery, privacy, and audit log</p></div>
      </div>

      {/* Vault Key */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><Key size={18} /> Vault Key</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Key type: <strong>{getUserPreference(preferences, 'vault_key_type')}</strong> | Auto-lock: <strong>{autoLockMode}</strong> ({autoLockTimeout}s timeout)
        </p>
        <button className="btn btn-secondary" onClick={() => setShowChangeKey(!showChangeKey)}>
          <Key size={14} /> Change Vault Key
        </button>
        {showChangeKey && (
          <form onSubmit={handleChangeKey} style={{ marginTop: 16, maxWidth: 400 }}>
            {changeError && <div className="alert alert-danger mb-3">{changeError}</div>}
            {changeSuccess && <div className="alert alert-success mb-3">{changeSuccess}</div>}
            <div className="form-group">
              <label className="form-label">Current Vault Key</label>
              <input className="form-control" type="text" value={currentKey} onChange={e => setCurrentKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">New Vault Key</label>
              <input className="form-control" type="text" value={newKey} onChange={e => setNewKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Key</label>
              <input className="form-control" type="text" value={confirmKey} onChange={e => setConfirmKey(e.target.value)} autoComplete="off" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={changingKey}>{changingKey ? 'Changing...' : 'Change Key'}</button>
          </form>
        )}
      </div>

      {/* Recovery Key */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><Shield size={18} /> Recovery Key</h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          Your recovery key is the only way to regain access if you forget your vault key.
        </p>
        {showRecovery ? (
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: 16, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', marginBottom: 12, wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>{recoveryKey}</span>
              <button className="btn btn-ghost btn-icon" onClick={handleCopyRecovery}>{copiedRecovery ? <Check size={16} style={{ color: '#10b981' }} /> : <Copy size={16} />}</button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowRecovery(false); setRecoveryKey(''); }}>Hide</button>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={handleViewRecovery} disabled={loadingRecovery}>
            <Eye size={14} /> {loadingRecovery ? 'Decrypting...' : 'View Recovery Key'}
          </button>
        )}
      </div>

      {/* Privacy */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><EyeOff size={18} /> Privacy</h3>
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
      </div>

      {/* Security Log */}
      <div className="card mb-4" style={{ padding: 20 }}>
        <h3 className="flex items-center gap-2 mb-3"><Clock size={18} /> Security Log</h3>
        {auditLoading ? <div className="spinner" /> :
          auditLog.length === 0 ? <p className="text-muted">No security events recorded.</p> : (
            <div className="table-wrapper"><table>
              <thead><tr><th>Action</th><th>Date</th></tr></thead>
              <tbody>{auditLog.slice(0, 20).map((entry, i) => (
                <tr key={i}>
                  <td>{entry.action?.replace(/_/g, ' ')}</td>
                  <td style={{ fontSize: 13 }}>{new Date(entry.created_at).toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )
        }
      </div>

      {/* Danger Zone */}
      <div className="card" style={{ padding: 20, borderColor: '#fecaca' }}>
        <h3 className="flex items-center gap-2 mb-3" style={{ color: '#dc2626' }}><AlertTriangle size={18} /> Danger Zone</h3>
        <button className="btn btn-danger" onClick={() => lock()}>
          <Lock size={14} /> Lock Vault Now
        </button>
      </div>
    </div>
  );
}
