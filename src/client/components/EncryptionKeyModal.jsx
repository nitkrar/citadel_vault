import { useState } from 'react';
import { KeyRound, Copy, Check, AlertTriangle, Shield, Download } from 'lucide-react';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import { isTruthy } from '../lib/checks';
import { getVaultKeyMinLength, VAULT_KEY_MINIMUMS } from '../lib/defaults';

/**
 * EncryptionKeyModal
 *
 * Four modes:
 *  - "setup"        — first-time vault key creation (key type selector + strength meter)
 *  - "unlock"       — returning user unlocks with existing key
 *  - "recovery"     — forgot vault key, use recovery key to set new one
 *  - "force_change" — admin-forced vault key change (must enter current + new)
 */
export default function EncryptionKeyModal() {
  const {
    isUnlocked,
    isLoading,
    vaultKeyExists,
    vaultPromptForced,
    mustResetVaultKey,
    setup,
    unlock,
    changeVaultKey,
    recoverWithRecoveryKey,
    skipVault,
  } = useEncryption();

  const { mustChangePassword } = useAuth();

  // Block vault modal while loading (prevents flash of setup modal on refresh)
  if (isLoading) return null;
  // Block vault modal if password change is required first
  if (mustChangePassword) return null;

  // ------------------------------------------------------------------
  // Local state
  // ------------------------------------------------------------------
  const [mode, setMode] = useState(null); // null = auto-detect
  const [keyType, setKeyType] = useState('alphanumeric');
  const [vaultKey, setVaultKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [newVaultKey, setNewVaultKey] = useState('');
  const [confirmNewKey, setConfirmNewKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Recovery key display (after setup/recovery)
  const [recoveryKeyDisplay, setRecoveryKeyDisplay] = useState('');
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  // For force change (when mustResetVaultKey)
  const [oldVaultKey, setOldVaultKey] = useState('');

  // ------------------------------------------------------------------
  // Determine visibility & effective mode
  // ------------------------------------------------------------------
  const forceChangeMode = isTruthy(mustResetVaultKey) && isTruthy(isUnlocked);
  const standardVisible = !isTruthy(isUnlocked) && vaultPromptForced === true;
  // Auto-show setup only if user hasn't skipped (null = initial show, false = skipped)
  const needsSetup = !isTruthy(isUnlocked) && !isTruthy(vaultKeyExists) && vaultPromptForced !== false;

  // Auto-show for setup or when vault prompt forced
  const isVisible = forceChangeMode || standardVisible || needsSetup || showRecovery;

  const effectiveMode = mode
    || (forceChangeMode ? 'force_change' : null)
    || (isTruthy(vaultKeyExists) ? 'unlock' : 'setup');

  if (!isVisible) return null;

  const minLen = getVaultKeyMinLength(keyType);
  const inputMode = keyType === 'numeric' ? 'numeric' : undefined;
  const inputType = keyType === 'numeric' ? 'tel' : 'text';
  const inputProps = {
    type: inputType,
    ...(inputMode && { inputMode }),
    autoComplete: 'off',
  };

  // ------------------------------------------------------------------
  // Strength meter (simple visual feedback)
  // ------------------------------------------------------------------
  function getStrength(key) {
    if (!key) return { label: '', color: '#d1d5db', pct: 0 };
    const min = getVaultKeyMinLength(keyType);
    if (key.length < min) return { label: 'Too short', color: '#ef4444', pct: 20 };
    const ratio = Math.min(key.length / (min * 2), 1);
    if (ratio < 0.5) return { label: 'Acceptable', color: '#f59e0b', pct: 40 };
    if (ratio < 0.75) return { label: 'Good', color: '#22c55e', pct: 70 };
    return { label: 'Strong', color: '#16a34a', pct: 100 };
  }

  // ------------------------------------------------------------------
  // Reset form
  // ------------------------------------------------------------------
  const resetForm = () => {
    setVaultKey(''); setConfirmKey(''); setError(''); setSubmitting(false);
    setRecoveryKeyDisplay(''); setCopiedRecovery(false); setSavedConfirmed(false);
    setShowRecovery(false); setMode(null); setRecoveryKeyInput('');
    setNewVaultKey(''); setConfirmNewKey(''); setOldVaultKey('');
  };

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    if (vaultKey.length < minLen) { setError(`Vault key must be at least ${minLen} characters.`); return; }
    if (vaultKey !== confirmKey) { setError('Vault keys do not match.'); return; }

    setSubmitting(true);
    try {
      const result = await setup(vaultKey);
      setRecoveryKeyDisplay(result.recoveryKey);
      setShowRecovery(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Setup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');
    if (!vaultKey) { setError('Enter your vault key.'); return; }

    setSubmitting(true);
    try {
      await unlock(vaultKey);
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Invalid vault key.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecovery = async (e) => {
    e.preventDefault();
    setError('');
    if (!recoveryKeyInput.trim()) { setError('Enter your recovery key.'); return; }
    if (newVaultKey.length < minLen) { setError(`New vault key must be at least ${minLen} characters.`); return; }
    if (newVaultKey !== confirmNewKey) { setError('New vault keys do not match.'); return; }

    setSubmitting(true);
    try {
      const result = await recoverWithRecoveryKey(recoveryKeyInput.trim(), newVaultKey);
      setRecoveryKeyDisplay(result.recoveryKey);
      setShowRecovery(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Recovery failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForceChange = async (e) => {
    e.preventDefault();
    setError('');
    if (!oldVaultKey) { setError('Enter your current vault key.'); return; }
    if (newVaultKey.length < minLen) { setError(`New vault key must be at least ${minLen} characters.`); return; }
    if (newVaultKey !== confirmNewKey) { setError('New vault keys do not match.'); return; }

    setSubmitting(true);
    try {
      await changeVaultKey(oldVaultKey, newVaultKey);
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to change vault key.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKeyDisplay);
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = recoveryKeyDisplay;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    }
  };

  const handleDownloadRecovery = () => {
    const blob = new Blob([`Citadel Vault Recovery Key\n\n${recoveryKeyDisplay}\n\nKeep this file safe. This is the only way to recover your vault if you forget your vault key.`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'citadel-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSkip = () => { resetForm(); skipVault(); };
  const handleRecoveryDone = () => { resetForm(); };

  // Shared styles
  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
    borderRadius: 8, fontSize: 15, boxSizing: 'border-box',
  };
  const btnPrimary = (disabled) => ({
    width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
    background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 15,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1, marginBottom: 8,
  });
  const btnSecondary = {
    width: '100%', padding: '10px 0', borderRadius: 8, border: '1px solid #d1d5db',
    background: 'transparent', color: '#6b7280', fontWeight: 500, fontSize: 14, cursor: 'pointer',
  };
  const errorBox = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 12, color: '#dc2626', fontSize: 13 }}>
      <AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{error}</span>
    </div>
  );

  // ==================================================================
  // RECOVERY KEY DISPLAY (after setup or recovery)
  // ==================================================================
  if (showRecovery) {
    return (
      <Modal isOpen={true} title="Save Your Recovery Key" onClose={null}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <Shield size={48} style={{ color: '#f59e0b', marginBottom: 16 }} />
          <p style={{ marginBottom: 8, color: '#6b7280', fontSize: 14 }}>
            This recovery key is the <strong>only way</strong> to regain access if you forget your vault key.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontFamily: 'monospace', fontSize: 16, wordBreak: 'break-all' }}>
            <span>{recoveryKeyDisplay}</span>
            <button type="button" onClick={handleCopyRecovery} title="Copy" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: copiedRecovery ? '#10b981' : '#6b7280', flexShrink: 0 }}>
              {copiedRecovery ? <Check size={18} /> : <Copy size={18} />}
            </button>
          </div>
          <button type="button" onClick={handleDownloadRecovery} style={{ ...btnSecondary, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Download size={16} /> Download as file
          </button>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={savedConfirmed} onChange={(e) => setSavedConfirmed(e.target.checked)} />
            I have saved my recovery key
          </label>
          <button type="button" disabled={!savedConfirmed} onClick={handleRecoveryDone} style={btnPrimary(!savedConfirmed)}>
            Continue
          </button>
        </div>
      </Modal>
    );
  }

  // ==================================================================
  // FORCE CHANGE MODE
  // ==================================================================
  if (effectiveMode === 'force_change') {
    const strength = getStrength(newVaultKey);
    return (
      <Modal isOpen={true} title="Change Your Vault Key" onClose={null}>
        <form onSubmit={handleForceChange}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}><KeyRound size={40} style={{ color: '#dc2626' }} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Your administrator requires you to change your vault key.</span>
          </div>
          {error && errorBox}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Current Vault Key</label>
            <input {...inputProps} placeholder="Current key" value={oldVaultKey} onChange={(e) => setOldVaultKey(e.target.value)} autoFocus required style={inputStyle} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>New Vault Key</label>
            <input {...inputProps} placeholder={`${minLen}+ characters`} value={newVaultKey} onChange={(e) => setNewVaultKey(e.target.value)} required style={inputStyle} />
            {newVaultKey && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#e5e7eb' }}><div style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }} /></div>
              <span style={{ fontSize: 12, color: strength.color }}>{strength.label}</span>
            </div>}
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Confirm New Key</label>
            <input {...inputProps} placeholder="Confirm" value={confirmNewKey} onChange={(e) => setConfirmNewKey(e.target.value)} required style={inputStyle} />
          </div>
          <button type="submit" disabled={submitting} style={btnPrimary(submitting)}>
            {submitting ? 'Changing...' : 'Change Vault Key'}
          </button>
        </form>
      </Modal>
    );
  }

  // ==================================================================
  // RECOVERY MODE
  // ==================================================================
  if (effectiveMode === 'recovery') {
    const strength = getStrength(newVaultKey);
    return (
      <Modal isOpen={true} title="Recover Your Vault" onClose={() => setMode(null)}>
        <form onSubmit={handleRecovery}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}><Shield size={40} style={{ color: '#f59e0b' }} /></div>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
            Enter your recovery key to regain access and set a new vault key.
          </p>
          {error && errorBox}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Recovery Key</label>
            <input type="text" placeholder="Enter your 32-character recovery key" value={recoveryKeyInput} onChange={(e) => setRecoveryKeyInput(e.target.value)} autoComplete="off" autoFocus required style={{ ...inputStyle, fontFamily: 'monospace' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>New Vault Key</label>
            <input {...inputProps} placeholder={`${minLen}+ characters`} value={newVaultKey} onChange={(e) => setNewVaultKey(e.target.value)} required style={inputStyle} />
            {newVaultKey && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#e5e7eb' }}><div style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }} /></div>
              <span style={{ fontSize: 12, color: strength.color }}>{strength.label}</span>
            </div>}
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Confirm New Key</label>
            <input {...inputProps} placeholder="Confirm" value={confirmNewKey} onChange={(e) => setConfirmNewKey(e.target.value)} required style={inputStyle} />
          </div>
          <button type="submit" disabled={submitting} style={btnPrimary(submitting)}>
            {submitting ? 'Recovering...' : 'Recover Vault'}
          </button>
          <button type="button" onClick={() => setMode(null)} style={btnSecondary}>Back</button>
        </form>
      </Modal>
    );
  }

  // ==================================================================
  // SETUP MODE
  // ==================================================================
  if (effectiveMode === 'setup') {
    const strength = getStrength(vaultKey);
    return (
      <Modal isOpen={true} title="Set Up Vault Key" onClose={handleSkip}>
        <form onSubmit={handleSetup}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}><KeyRound size={40} style={{ color: '#2563eb' }} /></div>
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
            Create a vault key to protect your data with end-to-end encryption. All encryption happens in your browser — the server never sees your vault key.
          </p>
          {error && errorBox}

          {/* Key type selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Key Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries({ numeric: 'PIN', alphanumeric: 'Password', passphrase: 'Passphrase' }).map(([type, label]) => (
                <button key={type} type="button" onClick={() => { setKeyType(type); setVaultKey(''); setConfirmKey(''); }}
                  style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: `1px solid ${keyType === type ? '#2563eb' : '#d1d5db'}`, background: keyType === type ? '#eff6ff' : 'transparent', color: keyType === type ? '#2563eb' : '#6b7280', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                  {label}
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{VAULT_KEY_MINIMUMS[type]}+ chars</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Vault Key</label>
            <input {...inputProps} placeholder={`${minLen}+ characters`} value={vaultKey} onChange={(e) => setVaultKey(e.target.value)} autoFocus required style={inputStyle} />
            {vaultKey && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#e5e7eb' }}><div style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }} /></div>
              <span style={{ fontSize: 12, color: strength.color }}>{strength.label}</span>
            </div>}
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Confirm Vault Key</label>
            <input {...inputProps} placeholder="Confirm" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value)} required style={inputStyle} />
          </div>
          <button type="submit" disabled={submitting} style={btnPrimary(submitting)}>
            {submitting ? 'Setting up...' : 'Set Up Vault Key'}
          </button>
          <button type="button" onClick={handleSkip} style={btnSecondary}>Skip for now</button>
        </form>
      </Modal>
    );
  }

  // ==================================================================
  // UNLOCK MODE (default)
  // ==================================================================
  const strength = getStrength(vaultKey);
  return (
    <Modal isOpen={true} title="Unlock Your Vault" onClose={handleSkip}>
      <form onSubmit={handleUnlock}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}><KeyRound size={40} style={{ color: '#2563eb' }} /></div>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
          Enter your vault key to decrypt your data.
        </p>
        {error && errorBox}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Vault Key</label>
          <input {...inputProps} placeholder="Enter vault key" value={vaultKey} onChange={(e) => setVaultKey(e.target.value)} autoFocus required style={inputStyle} />
        </div>
        <button type="submit" disabled={submitting} style={btnPrimary(submitting)}>
          {submitting ? 'Unlocking...' : 'Unlock Vault'}
        </button>
        <button type="button" onClick={() => setMode('recovery')} style={{ ...btnSecondary, marginBottom: 8, color: '#f59e0b' }}>
          Forgot vault key? Use recovery key
        </button>
        <button type="button" onClick={handleSkip} style={btnSecondary}>Skip for now</button>
      </form>
    </Modal>
  );
}
