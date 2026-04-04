import { useState, useEffect } from 'react';
import { KeyRound, AlertTriangle, Shield, Download, Eye, EyeOff, Loader } from 'lucide-react';
import RecoveryKeyCopyBlock from './RecoveryKeyCopyBlock';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import Modal from '../components/Modal';
import { getVaultKeyMinLength, getUserPreference, VAULT_KEY_MINIMUMS, validateVaultKey } from '../lib/defaults';

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
    setup,
    unlock,
    changeVaultKey,
    recoverWithRecoveryKey,
    skipVault,
  } = useEncryption();

  const { mustChangePassword, mustChangeVaultKey, clearMustChangeVaultKey, adminActionMessage, preferences, preferencesLoaded } = useAuth();

  // ------------------------------------------------------------------
  // Local state (must be declared before any early returns — Rules of Hooks)
  // ------------------------------------------------------------------
  const [mode, setMode] = useState(null); // null = auto-detect
  const savedKeyType = getUserPreference(preferences, 'vault_key_type');
  const [keyType, setKeyType] = useState(savedKeyType);
  const [vaultKey, setVaultKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [newVaultKey, setNewVaultKey] = useState('');
  const [confirmNewKey, setConfirmNewKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Recovery key display (after setup/recovery)
  const [recoveryKeyDisplay, setRecoveryKeyDisplay] = useState('');
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  // For force change (when mustChangeVaultKey)
  const [oldVaultKey, setOldVaultKey] = useState('');
  const [showVaultKey, setShowVaultKey] = useState(false);

  // Sync keyType when preferences arrive (initial load or refresh)
  useEffect(() => {
    if (preferencesLoaded) {
      const saved = getUserPreference(preferences, 'vault_key_type');
      setKeyType(saved);
    }
  }, [preferencesLoaded, preferences]);

  // Block vault modal while loading (prevents flash of setup modal on refresh)
  if (isLoading) return null;
  // Block vault modal if password change is required first
  if (mustChangePassword) return null;
  // Block vault modal until preferences are loaded (KDF iterations, key type depend on it)
  if (!preferencesLoaded) {
    return (
      <Modal isOpen={true} title="Preparing Vault" onClose={null}>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Loader size={32} className="spin" style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading security settings...</p>
        </div>
      </Modal>
    );
  }

  // ------------------------------------------------------------------
  // Determine visibility & effective mode
  // ------------------------------------------------------------------
  const forceChangeMode = mustChangeVaultKey && isUnlocked;
  // When mustChangeVaultKey is set but not yet unlocked, force the unlock modal (no skip)
  const forceUnlockForChange = mustChangeVaultKey && !isUnlocked && vaultKeyExists;
  const standardVisible = !isUnlocked && vaultPromptForced === true;
  // Auto-show setup only if user hasn't skipped (null = initial show, false = skipped)
  const needsSetup = !isUnlocked && !vaultKeyExists && vaultPromptForced !== false;

  // Auto-show for setup or when vault prompt forced
  const isVisible = forceChangeMode || forceUnlockForChange || standardVisible || needsSetup || showRecovery;

  const effectiveMode = mode
    || (forceChangeMode ? 'force_change' : null)
    || (vaultKeyExists ? 'unlock' : 'setup');

  if (!isVisible) return null;

  // All modes use local keyType (initialized from preference, changeable via selector)
  const activeKeyType = keyType;
  const minLen = getVaultKeyMinLength(activeKeyType);
  const isNumeric = activeKeyType === 'numeric';
  const inputType = isNumeric && !showVaultKey ? 'tel' : (showVaultKey ? 'text' : 'password');
  const inputProps = {
    type: inputType,
    ...(isNumeric && { inputMode: 'numeric', pattern: '[0-9]*' }),
    autoComplete: 'off',
  };
  const eyeToggleRow = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
      <button type="button" onClick={() => setShowVaultKey(v => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: 'var(--color-text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
        {showVaultKey ? <EyeOff size={14} /> : <Eye size={14} />} {showVaultKey ? 'Hide' : 'Show'}
      </button>
    </div>
  );

  // ------------------------------------------------------------------
  // Strength meter (simple visual feedback)
  // ------------------------------------------------------------------
  function getStrength(key) {
    if (!key) return { label: '', color: 'var(--color-border)', pct: 0 };
    const min = getVaultKeyMinLength(keyType);
    if (key.length < min) return { label: 'Too short', color: 'var(--color-danger)', pct: 20 };
    const ratio = Math.min(key.length / (min * 2), 1);
    if (ratio < 0.5) return { label: 'Acceptable', color: 'var(--color-warning)', pct: 40 };
    if (ratio < 0.75) return { label: 'Good', color: 'var(--color-success)', pct: 70 };
    return { label: 'Strong', color: 'var(--color-success)', pct: 100 };
  }

  // ------------------------------------------------------------------
  // Reset form
  // ------------------------------------------------------------------
  const resetForm = () => {
    setVaultKey(''); setConfirmKey(''); setError(''); setSubmitting(false);
    setRecoveryKeyDisplay(''); setSavedConfirmed(false);
    setShowRecovery(false); setMode(null); setRecoveryKeyInput('');
    setNewVaultKey(''); setConfirmNewKey(''); setOldVaultKey(''); setShowVaultKey(false);
  };

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------
  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    const keyErr = validateVaultKey(vaultKey, activeKeyType);
    if (keyErr) { setError(keyErr); return; }
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
      // If force change is required, stay in modal — remember the old key and switch to force_change
      // mustChangeVaultKey is from AuthContext (set at login, stable)
      if (mustChangeVaultKey) {
        setOldVaultKey(vaultKey);
        setVaultKey('');
        setError('');
        // forceChangeMode will now be true (mustChangeVaultKey + isUnlocked), modal stays open
      } else {
        resetForm();
      }
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
    const recKeyErr = validateVaultKey(newVaultKey, activeKeyType);
    if (recKeyErr) { setError(recKeyErr); return; }
    if (newVaultKey !== confirmNewKey) { setError('New vault keys do not match.'); return; }

    setSubmitting(true);
    try {
      const result = await recoverWithRecoveryKey(recoveryKeyInput.trim(), newVaultKey);
      // Save chosen key type as new preference
      try { await api.put('/preferences.php', { vault_key_type: activeKeyType }); } catch (_) {}
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
    const forceKeyErr = validateVaultKey(newVaultKey, activeKeyType);
    if (forceKeyErr) { setError(forceKeyErr); return; }
    if (newVaultKey === oldVaultKey) { setError('New vault key must be different from your current key.'); return; }
    if (newVaultKey !== confirmNewKey) { setError('New vault keys do not match.'); return; }

    setSubmitting(true);
    try {
      await changeVaultKey(oldVaultKey, newVaultKey);
      clearMustChangeVaultKey();
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to change vault key.');
    } finally {
      setSubmitting(false);
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
    width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)',
    borderRadius: 8, fontSize: 15, boxSizing: 'border-box', background: 'var(--color-input-bg, var(--bg-primary))', color: 'var(--color-text, inherit)',
  };
  const btnPrimary = (disabled) => ({
    width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
    background: 'var(--color-primary)', color: 'var(--color-primary-text, #fff)', fontWeight: 600, fontSize: 15,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1, marginBottom: 8,
  });
  const btnSecondary = {
    width: '100%', padding: '10px 0', borderRadius: 8, border: '1px solid var(--color-border)',
    background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 500, fontSize: 14, cursor: 'pointer',
  };
  const errorBox = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, color: 'var(--color-danger)', fontSize: 13 }}>
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
          <Shield size={48} style={{ color: 'var(--color-warning)', marginBottom: 16 }} />
          <p style={{ marginBottom: 8, color: 'var(--color-text-muted)', fontSize: 14 }}>
            This recovery key is the <strong>only way</strong> to regain access if you forget your vault key.
          </p>
          <RecoveryKeyCopyBlock recoveryKey={recoveryKeyDisplay} />
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
          <div style={{ textAlign: 'center', marginBottom: 16 }}><KeyRound size={40} style={{ color: 'var(--color-danger)' }} /></div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, color: 'var(--color-danger)', fontSize: 13 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div>Your administrator requires you to change your vault key.</div>
              {adminActionMessage && (
                <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--color-input-bg)', borderRadius: 6, fontStyle: 'italic', color: 'var(--color-danger)' }}>
                  {adminActionMessage}
                </div>
              )}
            </div>
          </div>
          {error && errorBox}
          {eyeToggleRow}
          {/* Only show current key field if not already provided from unlock step */}
          {!oldVaultKey && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Current Vault Key</label>
              <input {...inputProps} placeholder="Current key" value={oldVaultKey} onChange={(e) => setOldVaultKey(e.target.value)} autoFocus required style={inputStyle} />
            </div>
          )}
          {/* Key type selector — same as setup */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>New Key Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries({ numeric: 'PIN', alphanumeric: 'Password', passphrase: 'Passphrase' }).map(([type, label]) => (
                <button key={type} type="button" onClick={() => { setKeyType(type); setNewVaultKey(''); setConfirmNewKey(''); }}
                  style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: `1px solid ${keyType === type ? 'var(--color-primary)' : 'var(--color-border)'}`, background: keyType === type ? 'var(--color-primary-light)' : 'transparent', color: keyType === type ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                  {label}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{VAULT_KEY_MINIMUMS[type]}+ chars</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>New Vault Key</label>
            <input {...inputProps} placeholder={`${minLen}+ characters`} value={newVaultKey} onChange={(e) => setNewVaultKey(e.target.value)} required style={inputStyle} />
            {newVaultKey && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-border)' }}><div style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }} /></div>
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
          <div style={{ textAlign: 'center', marginBottom: 16 }}><Shield size={40} style={{ color: 'var(--color-warning)' }} /></div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 16 }}>
            Enter your recovery key to regain access and set a new vault key.
          </p>
          {error && errorBox}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Recovery Key</label>
            <input type="text" placeholder="Enter your 32-character recovery key" value={recoveryKeyInput} onChange={(e) => setRecoveryKeyInput(e.target.value)} autoComplete="off" autoFocus required style={{ ...inputStyle, fontFamily: 'monospace' }} />
          </div>

          {/* Key type selector for new vault key */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>New Key Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries({ numeric: 'PIN', alphanumeric: 'Password', passphrase: 'Passphrase' }).map(([type, label]) => (
                <button key={type} type="button" onClick={() => { setKeyType(type); setNewVaultKey(''); setConfirmNewKey(''); }}
                  style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: `1px solid ${activeKeyType === type ? 'var(--color-primary)' : 'var(--color-border)'}`, background: activeKeyType === type ? 'var(--color-primary-light)' : 'transparent', color: activeKeyType === type ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                  {label}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{VAULT_KEY_MINIMUMS[type]}+ chars</div>
                </button>
              ))}
            </div>
          </div>

          {eyeToggleRow}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>New Vault Key</label>
            <input {...inputProps} placeholder={`${minLen}+ characters`} value={newVaultKey} onChange={(e) => setNewVaultKey(e.target.value)} required style={inputStyle} />
            {newVaultKey && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-border)' }}><div style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }} /></div>
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
          <div style={{ textAlign: 'center', marginBottom: 16 }}><KeyRound size={40} style={{ color: 'var(--color-primary)' }} /></div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 16 }}>
            Create a vault key to protect your data with end-to-end encryption. All encryption happens in your browser — the server never sees your vault key.
          </p>
          {error && errorBox}

          {/* Key type selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Key Type</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries({ numeric: 'PIN', alphanumeric: 'Password', passphrase: 'Passphrase' }).map(([type, label]) => (
                <button key={type} type="button" onClick={() => { setKeyType(type); setVaultKey(''); setConfirmKey(''); }}
                  style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: `1px solid ${keyType === type ? 'var(--color-primary)' : 'var(--color-border)'}`, background: keyType === type ? 'var(--color-primary-light)' : 'transparent', color: keyType === type ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                  {label}
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{VAULT_KEY_MINIMUMS[type]}+ chars</div>
                </button>
              ))}
            </div>
          </div>

          {eyeToggleRow}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Vault Key</label>
            <input {...inputProps} placeholder={`${minLen}+ characters`} value={vaultKey} onChange={(e) => setVaultKey(e.target.value)} autoFocus required style={inputStyle} />
            {vaultKey && <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-border)' }}><div style={{ height: '100%', width: `${strength.pct}%`, background: strength.color, borderRadius: 2, transition: 'width 0.2s' }} /></div>
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
    <Modal isOpen={true} title={forceUnlockForChange ? 'Vault Key Change Required' : 'Unlock Your Vault'} onClose={forceUnlockForChange ? null : handleSkip}>
      <form onSubmit={handleUnlock}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}><KeyRound size={40} style={{ color: forceUnlockForChange ? 'var(--color-danger)' : 'var(--color-primary)' }} /></div>
        {forceUnlockForChange && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', borderRadius: 8, padding: '10px 12px', color: 'var(--color-danger)', fontSize: 13 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div>Your administrator requires you to change your vault key.</div>
                {adminActionMessage && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--color-input-bg)', borderRadius: 6, fontStyle: 'italic', color: 'var(--color-danger)' }}>
                    {adminActionMessage}
                  </div>
                )}
              </div>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 8 }}>Enter your current vault key to continue.</p>
          </div>
        )}
        {!forceUnlockForChange && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 16 }}>
            Enter your vault key to decrypt your data.
          </p>
        )}
        {error && errorBox}
        {eyeToggleRow}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>Vault Key</label>
          <input {...inputProps} placeholder={keyType === 'numeric' ? 'Enter PIN' : keyType === 'passphrase' ? 'Enter passphrase' : 'Enter vault key'} value={vaultKey} onChange={(e) => setVaultKey(e.target.value)} autoFocus required style={inputStyle} />
        </div>
        <button type="submit" disabled={submitting} style={btnPrimary(submitting)}>
          {submitting ? 'Unlocking...' : forceUnlockForChange ? 'Continue' : 'Unlock Vault'}
        </button>
        <button type="button" onClick={() => setMode('recovery')} style={{ ...btnSecondary, marginBottom: 8, color: 'var(--color-warning)' }}>
          Forgot vault key? Use recovery key
        </button>
        {!forceUnlockForChange && (
          <button type="button" onClick={handleSkip} style={btnSecondary}>Skip for now</button>
        )}
      </form>
    </Modal>
  );
}
