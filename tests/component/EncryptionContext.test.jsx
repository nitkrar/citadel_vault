/** @vitest-environment jsdom */
/**
 * EncryptionContext — Unit Tests
 *
 * Tests EncryptionProvider state transitions:
 * initialization, lock/unlock, session restore, user-switch cleanup, auto-lock.
 * All external dependencies (crypto, API, vaultSession) are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { EncryptionProvider, useEncryption } from '../../src/client/contexts/EncryptionContext';
import * as workerDispatcher from '../../src/client/lib/workerDispatcher';

// ── Storage mocks ─────────────────────────────────────────────────────────────

function makeStorageMock() {
  const store = new Map();
  const methods = {
    getItem:    (k) => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
    get length() { return store.size; },
    key:        (i) => [...store.keys()][i] ?? null,
  };
  return new Proxy(methods, {
    ownKeys: () => [...Object.keys(methods), ...store.keys()],
    getOwnPropertyDescriptor(target, prop) {
      if (store.has(prop)) return { configurable: true, enumerable: true, value: store.get(prop) };
      return Object.getOwnPropertyDescriptor(target, prop);
    },
    get(target, prop) { return prop in target ? target[prop] : store.get(prop); },
    set(target, prop, value) {
      if (prop in target) { target[prop] = value; return true; }
      store.set(prop, String(value));
      return true;
    },
  });
}

const sessionStore = makeStorageMock();
const localStore   = makeStorageMock();
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStore, writable: true, configurable: true });
Object.defineProperty(globalThis, 'localStorage',   { value: localStore,   writable: true, configurable: true });

// ── Web Crypto mock ───────────────────────────────────────────────────────────

const MOCK_DEK = { type: 'secret', algorithm: { name: 'AES-GCM' } };
const subtleMock = {
  importKey: vi.fn(() => Promise.resolve(MOCK_DEK)),
  exportKey: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
};
Object.defineProperty(globalThis, 'crypto', {
  value: { subtle: subtleMock },
  writable: true,
  configurable: true,
});

// ── Mutable mock state — closures read these by name at call time ─────────────

let mockPreferences = {};
let apiGetImpl      = vi.fn();
let apiPostImpl     = vi.fn();
let unlockVaultImpl = vi.fn();
let isUnlockedImpl  = vi.fn(() => false);

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/client/contexts/AuthContext', () => ({
  useAuth: () => ({ preferences: mockPreferences }),
}));

vi.mock('../../src/client/api/client', () => ({
  default: {
    get:  (...a) => apiGetImpl(...a),
    post: (...a) => apiPostImpl(...a),
    put:  vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../../src/client/lib/crypto', () => ({
  getKdfIterations: (prefs) => {
    const v = parseInt(prefs?.kdf_iterations, 10);
    return v > 0 ? v : 100000;
  },
  unlockVault:            (...a) => unlockVaultImpl(...a),
  isUnlocked:             (...a) => isUnlockedImpl(...a),
  lockVault:              vi.fn(),
  setDek:                 vi.fn(),
  _getDekForContext:      vi.fn(() => MOCK_DEK),
  encryptEntry:           vi.fn(() => Promise.resolve('encrypted')),
  decryptEntry:           vi.fn(() => Promise.resolve('decrypted')),
  setupVault:             vi.fn(),
  changeVaultKey:         vi.fn(),
  reWrapDekIterations:    vi.fn(),
  recoverWithRecoveryKey: vi.fn(),
  viewRecoveryKey:        vi.fn(),
  regenerateRecoveryKey:  vi.fn(),
  PBKDF2_ITERATIONS:      100000,
}));

const vaultSessionLock    = vi.fn(() => Promise.resolve());
const vaultSessionDestroy = vi.fn(() => Promise.resolve());
vi.mock('../../src/client/lib/vaultSession', () => ({
  lock:    (...a) => vaultSessionLock(...a),
  destroy: (...a) => vaultSessionDestroy(...a),
}));

vi.mock('../../src/client/lib/workerDispatcher', () => ({
  setKey:    vi.fn(() => Promise.resolve()),
  terminate: vi.fn(),
}));

vi.mock('../../src/client/lib/cachePolicy', () => ({
  hasFreshCache:      vi.fn(() => Promise.resolve(true)),
  markCacheRefreshed: vi.fn(),
  onVaultLock:        vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/client/lib/entryStore', () => ({
  entryStore: {
    putAll: vi.fn(() => Promise.resolve()),
    clear:  vi.fn(() => Promise.resolve()),
    switchUser: vi.fn(),
  },
}));

vi.mock('../../src/client/lib/checks', () => ({
  // Mirrors real isTruthy: only true, 1, "true"/"1"/"yes" are truthy. "0", "false", false, 0 → false.
  isTruthy: (v) => {
    if (v === true || v === 1) return true;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes';
    }
    return false;
  },
  apiData:  (resp) => resp?.data?.data ?? resp?.data ?? null,
}));

vi.mock('../../src/client/lib/defaults', () => ({
  getUserPreference: (prefs, key) =>
    prefs?.[key] ?? ({
      auto_lock_mode:        'session',
      auto_lock_timeout:     '3600',
      vault_persist_session: 'lock_on_refresh',
    })[key],
  PREFERENCE_DEFAULTS: {},
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const KEY_MATERIAL_WITH_VAULT = {
  data: { data: { has_vault_key: 1, vault_key_salt: 'salt', encrypted_dek: 'edek' } },
};
const KEY_MATERIAL_NO_VAULT = {
  data: { data: { has_vault_key: 0 } },
};

// A valid base64-encoded 32-byte buffer (32 zero bytes)
const FAKE_SESSION_DEK = btoa(String.fromCharCode(...new Uint8Array(32)));

// ── Consumer component ────────────────────────────────────────────────────────

let capturedCtx = null;

function Probe() {
  const ctx = useEncryption();
  capturedCtx = ctx;
  return (
    <div
      data-testid="probe"
      data-unlocked={String(ctx.isUnlocked)}
      data-loading={String(ctx.isLoading)}
      data-vault-exists={String(ctx.vaultKeyExists)}
      data-prompt-forced={String(ctx.vaultPromptForced)}
    />
  );
}

function renderWithUser(user = { id: 1 }) {
  return render(
    <EncryptionProvider user={user}>
      <Probe />
    </EncryptionProvider>
  );
}

const getProbe      = () => document.querySelector('[data-testid="probe"]');
const probeUnlocked = () => getProbe()?.dataset.unlocked === 'true';
const probeLoading  = () => getProbe()?.dataset.loading === 'true';
const probeVaultExists = () => getProbe()?.dataset.vaultExists === 'true';

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedCtx  = null;
  mockPreferences = {};
  sessionStore.clear();
  localStore.clear();

  apiGetImpl      = vi.fn(() => Promise.resolve(KEY_MATERIAL_WITH_VAULT));
  apiPostImpl     = vi.fn(() => Promise.resolve({ data: {} }));
  unlockVaultImpl = vi.fn(() => Promise.resolve(true));
  isUnlockedImpl  = vi.fn(() => false);

  subtleMock.importKey.mockResolvedValue(MOCK_DEK);
  subtleMock.exportKey.mockResolvedValue(new ArrayBuffer(32));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); // undo any spyOn(setTimeout) so it doesn't poison later tests
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EncryptionProvider — mount initialization', () => {
  it('completes loading without API call when no user is provided', async () => {
    renderWithUser(null);
    await waitFor(() => expect(probeLoading()).toBe(false));
    expect(apiGetImpl).not.toHaveBeenCalled();
  });

  it('sets vaultKeyExists=false when the API reports no vault key', async () => {
    apiGetImpl = vi.fn(() => Promise.resolve(KEY_MATERIAL_NO_VAULT));
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));
    expect(probeVaultExists()).toBe(false);
    expect(probeUnlocked()).toBe(false);
  });

  it('sets vaultKeyExists=true without unlocking when vault exists but no session', async () => {
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));
    expect(probeVaultExists()).toBe(true);
    expect(probeUnlocked()).toBe(false);
  });

  it('restores session from sessionStorage and sets isUnlocked=true', async () => {
    sessionStore.setItem('pv_session_dek', FAKE_SESSION_DEK);
    renderWithUser();
    await waitFor(() => expect(probeUnlocked()).toBe(true));
    expect(subtleMock.importKey).toHaveBeenCalled();
    // DEK must be sent to the worker — without this, worker-dispatched crypto silently fails
    expect(workerDispatcher.setKey).toHaveBeenCalledWith(MOCK_DEK);
  });

  it('stays locked and calls vaultSession.lock() when sessionStorage DEK is corrupted', async () => {
    sessionStore.setItem('pv_session_dek', '!!!not-valid-base64!!!');
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));
    expect(probeUnlocked()).toBe(false);
    expect(vaultSessionLock).toHaveBeenCalled();
  });
});

describe('EncryptionProvider — lock()', () => {
  async function renderUnlocked() {
    sessionStore.setItem('pv_session_dek', FAKE_SESSION_DEK);
    renderWithUser();
    await waitFor(() => expect(probeUnlocked()).toBe(true));
  }

  it('sets isUnlocked=false', async () => {
    await renderUnlocked();
    await act(async () => { await capturedCtx.lock(); });
    expect(probeUnlocked()).toBe(false);
  });

  it('calls vaultSession.lock() with no arguments (clears session DEK — security)', async () => {
    await renderUnlocked();
    await act(async () => { await capturedCtx.lock(); });
    // Must NOT pass preserveSession:true — explicit lock should always clear pv_session_dek
    expect(vaultSessionLock).toHaveBeenCalledWith();
  });
});

describe('EncryptionProvider — unlock()', () => {
  it('sets isUnlocked=true when the vault key is correct', async () => {
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await act(async () => { await capturedCtx.unlock('validkey12'); });

    expect(probeUnlocked()).toBe(true);
    // DEK must be sent to the worker — without this, worker-dispatched crypto silently fails
    expect(workerDispatcher.setKey).toHaveBeenCalledWith(MOCK_DEK);
  });

  it('stays locked and throws when the vault key is incorrect', async () => {
    unlockVaultImpl = vi.fn(() => Promise.resolve(false));
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await expect(
      act(async () => { await capturedCtx.unlock('wrongkey99'); })
    ).rejects.toThrow('Invalid vault key.');

    expect(probeUnlocked()).toBe(false);
  });

  it('persists DEK to sessionStorage when vault_persist_session is persist_in_tab', async () => {
    mockPreferences = { vault_persist_session: 'persist_in_tab' };
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await act(async () => { await capturedCtx.unlock('validkey12'); });

    expect(sessionStore.getItem('pv_session_dek')).not.toBeNull();
  });

  it('does NOT persist DEK to sessionStorage when vault_persist_session is lock_on_refresh', async () => {
    mockPreferences = { vault_persist_session: 'lock_on_refresh' };
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await act(async () => { await capturedCtx.unlock('validkey12'); });

    expect(sessionStore.getItem('pv_session_dek')).toBeNull();
  });
});

describe('EncryptionProvider — user switch', () => {
  it('calls vaultSession.destroy() and sets isUnlocked=false when user id changes', async () => {
    // Start from genuinely unlocked so the isUnlocked=false assertion is non-vacuous
    sessionStore.setItem('pv_session_dek', FAKE_SESSION_DEK);
    const { rerender } = renderWithUser({ id: 1 });
    await waitFor(() => expect(probeUnlocked()).toBe(true));

    // Real vaultSession.destroy() clears pv_session_dek so the new user's init
    // doesn't restore the old session. Simulate that side effect here.
    vaultSessionDestroy.mockImplementationOnce(async () => {
      sessionStore.removeItem('pv_session_dek');
    });

    rerender(
      <EncryptionProvider user={{ id: 2 }}>
        <Probe />
      </EncryptionProvider>
    );

    await waitFor(() => expect(vaultSessionDestroy).toHaveBeenCalled());
    await waitFor(() => expect(probeUnlocked()).toBe(false)); // proven: was true, now false
  });

  it('does NOT call vaultSession.destroy() when the same user rerenders', async () => {
    const { rerender } = renderWithUser({ id: 1 });
    await waitFor(() => expect(probeLoading()).toBe(false));

    rerender(
      <EncryptionProvider user={{ id: 1 }}>
        <Probe />
      </EncryptionProvider>
    );

    expect(vaultSessionDestroy).not.toHaveBeenCalled();
  });
});

describe('EncryptionProvider — auto-lock timer', () => {
  it('schedules a 60-second auto-lock timer when auto_lock_mode is timed', async () => {
    mockPreferences = { auto_lock_mode: 'timed', auto_lock_timeout: '60' };
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    // Spy AFTER waitFor so its internal setTimeout polling is unaffected
    const registeredTimers = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, delay) => {
      registeredTimers.push({ fn, delay });
      return registeredTimers.length;
    });

    await act(async () => { await capturedCtx.unlock('validkey12'); });

    const autoLockTimer = registeredTimers.find(t => t.delay === 60_000);
    expect(autoLockTimer).toBeDefined();
  });

  it('locks vault when the auto-lock timer callback fires', async () => {
    mockPreferences = { auto_lock_mode: 'timed', auto_lock_timeout: '60' };
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    // Spy AFTER waitFor so its internal setTimeout polling is unaffected
    const registeredTimers = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, delay) => {
      registeredTimers.push({ fn, delay });
      return registeredTimers.length;
    });

    await act(async () => { await capturedCtx.unlock('validkey12'); });
    // act() flushes React state — no waitFor needed (setTimeout is mocked so waitFor can't poll)
    expect(probeUnlocked()).toBe(true); // pre-condition: must be unlocked first

    const autoLockTimer = registeredTimers.find(t => t.delay === 60_000);
    expect(autoLockTimer).toBeDefined();

    // Fire the timer callback directly — simulates timeout firing
    await act(async () => { await autoLockTimer.fn(); });

    expect(probeUnlocked()).toBe(false); // proven: was true, now false
  });

  it('does NOT schedule auto-lock timer when auto_lock_mode is session', async () => {
    mockPreferences = { auto_lock_mode: 'session', auto_lock_timeout: '60' };
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    // Spy AFTER waitFor so its internal setTimeout polling is unaffected
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await act(async () => { await capturedCtx.unlock('validkey12'); });

    const longTimers = setTimeoutSpy.mock.calls.filter(([, delay]) => delay >= 60_000);
    expect(longTimers).toHaveLength(0);
  });
});

describe('EncryptionProvider — vault prompt state', () => {
  it('promptVault sets vaultPromptForced to true', async () => {
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    act(() => { capturedCtx.promptVault(); });

    expect(getProbe()?.dataset.promptForced).toBe('true');
  });

  it('skipVault sets vaultPromptForced to false', async () => {
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    act(() => { capturedCtx.promptVault(); });
    act(() => { capturedCtx.skipVault(); });

    expect(getProbe()?.dataset.promptForced).toBe('false');
  });
});

describe('EncryptionProvider — encrypt/decrypt guards', () => {
  it('encrypt() throws "Vault is locked." when crypto.isUnlocked() is false', async () => {
    isUnlockedImpl = vi.fn(() => false);
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await expect(capturedCtx.encrypt({ secret: 'data' })).rejects.toThrow('Vault is locked.');
  });

  it('decrypt() throws "Vault is locked." when crypto.isUnlocked() is false', async () => {
    isUnlockedImpl = vi.fn(() => false);
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await expect(capturedCtx.decrypt('some-blob')).rejects.toThrow('Vault is locked.');
  });

  it('encrypt() delegates to crypto.encryptEntry when unlocked', async () => {
    isUnlockedImpl = vi.fn(() => true);
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    const result = await capturedCtx.encrypt({ secret: 'data' });

    expect(result).toBe('encrypted'); // value returned by crypto.encryptEntry mock
  });

  it('decrypt() delegates to crypto.decryptEntry when unlocked', async () => {
    isUnlockedImpl = vi.fn(() => true);
    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    const result = await capturedCtx.decrypt('some-blob');

    expect(result).toBe('decrypted'); // value returned by crypto.decryptEntry mock
  });
});

describe('EncryptionProvider — setup() first-time vault creation', () => {
  it('sets isUnlocked=true and vaultKeyExists=true after setup', async () => {
    const { setupVault } = await import('../../src/client/lib/crypto');
    vi.mocked(setupVault).mockResolvedValue({
      keyMaterial: { vault_key_salt: 's', encrypted_dek: 'e', recovery_key_salt: 'r', encrypted_dek_recovery: 'er', recovery_key_encrypted: 'rke' },
      recoveryKey: 'RECOVERY-KEY-MOCK',
    });

    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    let result;
    await act(async () => { result = await capturedCtx.setup('newvaultkey'); });

    expect(probeUnlocked()).toBe(true);
    expect(probeVaultExists()).toBe(true);
    expect(result.recoveryKey).toBe('RECOVERY-KEY-MOCK');
  });

  it('posts key material to the server during setup', async () => {
    const { setupVault } = await import('../../src/client/lib/crypto');
    const keyMaterial = { vault_key_salt: 's', encrypted_dek: 'e', recovery_key_salt: 'r', encrypted_dek_recovery: 'er', recovery_key_encrypted: 'rke' };
    vi.mocked(setupVault).mockResolvedValue({ keyMaterial, recoveryKey: 'RK' });

    renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    await act(async () => { await capturedCtx.setup('newvaultkey'); });

    expect(apiPostImpl).toHaveBeenCalledWith(
      expect.stringContaining('setup'),
      keyMaterial,
    );
  });
});

describe('EncryptionProvider — unmount cleanup', () => {
  it('calls vaultSession.lock({ preserveSession: true }) on unmount', async () => {
    const { unmount } = renderWithUser();
    await waitFor(() => expect(probeLoading()).toBe(false));

    // Clear any lock() calls that happened during init (e.g. corrupted session)
    vaultSessionLock.mockClear();

    unmount();

    expect(vaultSessionLock).toHaveBeenCalledWith({ preserveSession: true });
  });
});
