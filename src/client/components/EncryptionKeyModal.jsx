import { useState, useEffect } from 'react';
import { KeyRound, Copy, Check, AlertTriangle, Shield } from 'lucide-react';
import api from '../api/client';
import { useEncryption } from '../contexts/EncryptionContext';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import { isTruthy } from '../lib/checks';

/**
 * EncryptionKeyModal
 *
 * Shown when the user is authenticated, vaultKeyExists status is known,
 * and the vault is neither unlocked nor skipped.
 *
 * Three modes:
 *  - "setup"        — first-time vault key creation (has_vault_key === false)
 *  - "unlock"       — returning user unlocks with existing key
 *  - "force_change" — admin forced vault key change (vault is unlocked but must change)
 */
export default function EncryptionKeyModal() {
  const {
    vaultUnlocked,
    vaultSkipped,
    vaultKeyExists,
    vaultPromptForced,
    mustChangeVaultKey,
    adminVaultMessage,
    backfilledRecoveryKey,
    setupVaultKey,
    unlockVault,
    changeVaultKey,
    changeVaultKeyWithRecovery,
    skipVault,
    clearBackfilledRecoveryKey,
  } = useEncryption();

  const { mustChangePassword } = useAuth();

  // ------------------------------------------------------------------
  // Block vault modal if password change is required first
  // ------------------------------------------------------------------
  if (mustChangePassword) return null;

  // ------------------------------------------------------------------
  // Vault key policy (fetched from backend)
  // ------------------------------------------------------------------
  const [vaultKeyPolicy, setVaultKeyPolicy] = useState({ min_length: 8, mode: 'alphanumeric', description: '8+ characters (letters and numbers)' });
  useEffect(() => {
    api.get('/encryption.php?action=vault-key-policy')
      .then((r) => { const d = r.data?.data || r.data; if (d?.min_length) setVaultKeyPolicy(d); })
      .catch(() => {});
  }, []);

  // ------------------------------------------------------------------
  // Local state
  // ------------------------------------------------------------------
  const [vaultKey, setVaultKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Recovery key flow (setup & force_change modes)
  const [recoveryKey, setRecoveryKey] = useState('');
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  // Force change mode: method selection and extra fields
  const [changeMethod, setChangeMethod] = useState('vault_key'); // 'vault_key' or 'recovery'
  const [oldVaultKey, setOldVaultKey] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newVaultKey, setNewVaultKey] = useState('');
  const [confirmNewKey, setConfirmNewKey] = useState('');

  // ------------------------------------------------------------------
  // Determine visibility & mode
  // ------------------------------------------------------------------
  const forceChangeMode = isTruthy(mustChangeVaultKey) && isTruthy(vaultUnlocked);

  // Standard modal: vault not unlocked AND (not skipped OR force-opened)
  const standardVisible = !isTruthy(vaultUnlocked) && (!isTruthy(vaultSkipped) || isTruthy(vaultPromptForced));

  const isVisible = forceChangeMode || standardVisible || showRecovery;

  const mode = forceChangeMode
    ? 'force_change'
    : isTruthy(vaultKeyExists)
      ? 'unlock'
      : 'setup';

  if (!isVisible) return null;

  const minLen = vaultKeyPolicy.min_length || 8;
  const vkMode = vaultKeyPolicy.mode || 'alphanumeric';
  const vkInputType = vkMode === 'numeric' ? 'tel' : 'text';
  const vkInputMode = vkMode === 'numeric' ? 'numeric' : undefined;
  const vkPattern = vkMode === 'numeric' ? '[0-9]*' : undefined;
  const vkPlaceholder = vaultKeyPolicy.description || `${minLen}+ characters`;
  const vkProps = { type: vkInputType, ...(vkInputMode && { inputMode: vkInputMode }), ...(vkPattern && { pattern: vkPattern }) };

  // ------------------------------------------------------------------
  // Reset form fields
  // ------------------------------------------------------------------
  const resetForm = () => {
    setVaultKey('');
    setConfirmKey('');
    setError('');
    setSubmitting(false);
    setRecoveryKey('');
    setCopiedRecovery(false);
    setSavedConfirmed(false);
    setShowRecovery(false);
    setChangeMethod('vault_key');
    setOldVaultKey('');
    setRecoveryInput('');
    setNewVaultKey('');
    setConfirmNewKey('');
  };

  // ------------------------------------------------------------------
  // Handle setup submission
  // ------------------------------------------------------------------
  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');

    if (vaultKey.length < minLen) {
      setError(`Vault key must be at least ${minLen} characters.`);
      return;
    }

    if (vaultKey !== confirmKey) {
      setError('Vault keys do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await setupVaultKey(vaultKey, confirmKey);
      setRecoveryKey(result.recovery_key);
      setShowRecovery(true);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Failed to set up vault key.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Handle unlock submission
  // ------------------------------------------------------------------
  const handleUnlock = async (e) => {
    e.preventDefault();
    setError('');

    if (vaultKey.length < minLen) {
      setError(`Vault key must be at least ${minLen} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await unlockVault(vaultKey);
      // If server backfilled a recovery key, show it to the user
      if (result.recovery_key) {
        setRecoveryKey(result.recovery_key);
        setShowRecovery(true);
      } else {
        resetForm();
      }
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Invalid vault key.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Handle forced vault key change submission
  // ------------------------------------------------------------------
  const handleForceChange = async (e) => {
    e.preventDefault();
    setError('');

    if (newVaultKey.length < minLen) {
      setError(`New vault key must be at least ${minLen} characters.`);
      return;
    }

    if (newVaultKey !== confirmNewKey) {
      setError('New vault keys do not match.');
      return;
    }

    if (changeMethod === 'vault_key' && oldVaultKey.length < minLen) {
      setError(`Current vault key must be at least ${minLen} characters.`);
      return;
    }

    if (changeMethod === 'recovery' && !recoveryInput.trim()) {
      setError('Recovery key is required.');
      return;
    }

    setSubmitting(true);
    try {
      let result;
      if (changeMethod === 'vault_key') {
        result = await changeVaultKey(oldVaultKey, newVaultKey, confirmNewKey);
      } else {
        result = await changeVaultKeyWithRecovery(recoveryInput.trim(), newVaultKey, confirmNewKey);
      }
      if (result.recovery_key) {
        setRecoveryKey(result.recovery_key);
        setShowRecovery(true);
      } else {
        // Vault key changed without recovery key rotation — just close
        resetForm();
      }
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        'Failed to change vault key.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------
  // Copy recovery key to clipboard
  // ------------------------------------------------------------------
  const handleCopyRecovery = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    } catch {
      // Fallback: select text in a temporary input
      const tmp = document.createElement('textarea');
      tmp.value = recoveryKey;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    }
  };

  // ------------------------------------------------------------------
  // Finish recovery key confirmation (close modal)
  // ------------------------------------------------------------------
  const handleRecoveryDone = () => {
    clearBackfilledRecoveryKey();
    resetForm();
  };

  // ------------------------------------------------------------------
  // Skip vault
  // ------------------------------------------------------------------
  const handleSkip = () => {
    resetForm();
    skipVault();
  };

  // ------------------------------------------------------------------
  // Render: recovery key display (after successful setup or change)
  // ------------------------------------------------------------------
  if (showRecovery) {
    return (
      <Modal isOpen={true} title="Save Your Recovery Key" onClose={null}>
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <Shield size={48} style={{ color: '#f59e0b', marginBottom: 16 }} />

          <p style={{ marginBottom: 8, color: '#6b7280', fontSize: 14 }}>
            This recovery key is the <strong>only way</strong> to regain access
            to your encrypted data if you forget your vault key. Save it
            somewhere safe.
          </p>

          <p style={{ marginBottom: 16, color: '#6b7280', fontSize: 13 }}>
            You can always view your recovery key on the Profile page when your vault is unlocked.
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
            <span>{recoveryKey}</span>
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
            onClick={handleRecoveryDone}
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: savedConfirmed ? '#2563eb' : '#93c5fd',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              cursor: savedConfirmed ? 'pointer' : 'not-allowed',
            }}
          >
            Continue
          </button>
        </div>
      </Modal>
    );
  }

  // ------------------------------------------------------------------
  // Render: forced vault key change mode
  // ------------------------------------------------------------------
  if (mode === 'force_change') {
    return (
      <Modal isOpen={true} title="Change Your Vault Key" onClose={null}>
        <form onSubmit={handleForceChange}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <KeyRound size={40} style={{ color: '#dc2626' }} />
          </div>

          {/* Admin message alert */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 16,
              color: '#dc2626',
              fontSize: 13,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {adminVaultMessage || 'Your administrator requires you to change your vault key.'}
            </span>
          </div>

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
                color: '#dc2626',
                fontSize: 13,
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Method selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
              Verify identity using
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setChangeMethod('vault_key')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${changeMethod === 'vault_key' ? '#2563eb' : '#d1d5db'}`,
                  background: changeMethod === 'vault_key' ? '#eff6ff' : 'transparent',
                  color: changeMethod === 'vault_key' ? '#2563eb' : '#6b7280',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Current Key
              </button>
              <button
                type="button"
                onClick={() => setChangeMethod('recovery')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${changeMethod === 'recovery' ? '#2563eb' : '#d1d5db'}`,
                  background: changeMethod === 'recovery' ? '#eff6ff' : 'transparent',
                  color: changeMethod === 'recovery' ? '#2563eb' : '#6b7280',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Recovery Key
              </button>
            </div>
          </div>

          {/* Old key or recovery key input */}
          {changeMethod === 'vault_key' ? (
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor="force-old-key"
                style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
              >
                Current Vault Key
              </label>
              <input
                id="force-old-key"
                {...vkProps}
                placeholder={`Current key (${vkPlaceholder})`}
                value={oldVaultKey}
                onChange={(e) => setOldVaultKey(e.target.value)}
                autoComplete="off"
                autoFocus
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 15,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <label
                htmlFor="force-recovery-key"
                style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
              >
                Recovery Key
              </label>
              <input
                id="force-recovery-key"
                type="text"
                placeholder="Enter your recovery key"
                value={recoveryInput}
                onChange={(e) => setRecoveryInput(e.target.value)}
                autoComplete="off"
                autoFocus
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 15,
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* New key */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="force-new-key"
              style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
            >
              New Vault Key
            </label>
            <input
              id="force-new-key"
              {...vkProps}
              placeholder={vkPlaceholder}
              value={newVaultKey}
              onChange={(e) => setNewVaultKey(e.target.value)}
              autoComplete="off"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 15,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Confirm new key */}
          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="force-confirm-key"
              style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
            >
              Confirm New Vault Key
            </label>
            <input
              id="force-confirm-key"
              {...vkProps}
              placeholder="Confirm new key"
              value={confirmNewKey}
              onChange={(e) => setConfirmNewKey(e.target.value)}
              autoComplete="off"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 15,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Changing key...' : 'Change Vault Key'}
          </button>
        </form>
      </Modal>
    );
  }

  // ------------------------------------------------------------------
  // Render: setup mode
  // ------------------------------------------------------------------
  if (mode === 'setup') {
    return (
      <Modal isOpen={true} title="Set Up Vault Key" onClose={handleSkip}>
        <form onSubmit={handleSetup}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <KeyRound size={40} style={{ color: '#2563eb' }} />
          </div>

          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
            Create a vault key to protect your vault data (minimum {minLen} characters, alphanumeric recommended). You will need this key each time you start a new session.
          </p>

          {error && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
                color: '#dc2626',
                fontSize: 13,
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="setup-vault-key"
              style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
            >
              Vault Key
            </label>
            <input
              id="setup-vault-key"
              {...vkProps}
              placeholder={vkPlaceholder}
              value={vaultKey}
              onChange={(e) => setVaultKey(e.target.value)}
              autoComplete="off"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 15,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="setup-confirm-key"
              style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
            >
              Confirm Vault Key
            </label>
            <input
              id="setup-confirm-key"
              {...vkProps}
              placeholder="Confirm key"
              value={confirmKey}
              onChange={(e) => setConfirmKey(e.target.value)}
              autoComplete="off"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 15,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              fontSize: 15,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              marginBottom: 8,
            }}
          >
            {submitting ? 'Setting up...' : 'Set Up Vault Key'}
          </button>

          <button
            type="button"
            onClick={handleSkip}
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: 'transparent',
              color: '#6b7280',
              fontWeight: 500,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Skip for now
          </button>
        </form>
      </Modal>
    );
  }

  // ------------------------------------------------------------------
  // Render: unlock mode
  // ------------------------------------------------------------------
  return (
    <Modal isOpen={true} title="Unlock Your Vault" onClose={handleSkip}>
      <form onSubmit={handleUnlock}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <KeyRound size={40} style={{ color: '#2563eb' }} />
        </div>

        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
          Enter your vault key to unlock your vault data.
        </p>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 12,
              color: '#dc2626',
              fontSize: 13,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <label
            htmlFor="unlock-vault-key"
            style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}
          >
            Vault Key
          </label>
          <input
            id="unlock-vault-key"
            {...vkProps}
            placeholder={vkPlaceholder}
            value={vaultKey}
            onChange={(e) => setVaultKey(e.target.value)}
            autoComplete="off"
            autoFocus
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontSize: 15,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 8,
            border: 'none',
            background: '#2563eb',
            color: '#fff',
            fontWeight: 600,
            fontSize: 15,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            marginBottom: 8,
          }}
        >
          {submitting ? 'Unlocking...' : 'Unlock Vault'}
        </button>

        <button
          type="button"
          onClick={handleSkip}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: 'transparent',
            color: '#6b7280',
            fontWeight: 500,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Skip for now
        </button>
      </form>
    </Modal>
  );
}
