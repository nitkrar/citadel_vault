/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Default mock values
let mockEncryption = {};
let mockAuth = {};

vi.mock('../../src/client/contexts/EncryptionContext', () => ({
  useEncryption: () => mockEncryption,
}));

vi.mock('../../src/client/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('../../src/client/api/client', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { data: [] } })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../../src/client/hooks/useVaultData', () => ({
  default: (fetchFn, initial) => ({
    data: Array.isArray(initial) ? [
      { action: 'login_success', created_at: '2026-04-01T10:00:00' },
      { action: 'vault_key_changed', created_at: '2026-04-01T11:00:00' },
      { action: 'recovery_key_regenerated', created_at: '2026-04-01T12:00:00' },
    ] : initial,
    loading: false,
  }),
}));

vi.mock('../../src/client/lib/checks', () => ({
  apiData: (resp) => resp?.data?.data ?? resp?.data ?? [],
}));

vi.mock('../../src/client/lib/defaults', () => ({
  getUserPreference: (prefs, key) => prefs?.[key] ?? ({
    auto_lock_mode: 'session',
    auto_lock_timeout: '3600',
    vault_persist_session: 'lock_on_refresh',
    vault_key_type: 'alphanumeric',
  })[key],
  VAULT_KEY_MINIMUMS: { numeric: 6, alphanumeric: 8, passphrase: 16 },
}));

vi.mock('../../src/client/lib/crypto', () => ({
  PBKDF2_ITERATIONS_RECOMMENDED: 600000,
  getKdfIterations: (prefs) => {
    const raw = prefs?.kdf_iterations;
    const parsed = parseInt(raw, 10);
    return parsed > 0 ? parsed : 100000;
  },
}));

vi.mock('../../src/client/components/RecoveryKeyCopyBlock', () => ({
  default: ({ recoveryKey }) => <div data-testid="recovery-key-display">{recoveryKey}</div>,
}));

vi.mock('../../src/client/components/Section', () => ({
  default: ({ children, title, icon: Icon }) => (
    <div data-testid={`section-${title?.replace(/\s/g, '-')}`}>
      <h3>{title}</h3>
      {children}
    </div>
  ),
}));

vi.mock('../../src/client/components/SaveToast', () => ({
  default: ({ message, type }) => message ? <div data-testid="save-toast" data-type={type}>{message}</div> : null,
}));

const iconStub = (name) => (props) => <span data-icon={name} />;
vi.mock('lucide-react', () => ({
  Shield: iconStub('Shield'),
  Key: iconStub('Key'),
  Eye: iconStub('Eye'),
  EyeOff: iconStub('EyeOff'),
  Lock: iconStub('Lock'),
  Clock: iconStub('Clock'),
  Check: iconStub('Check'),
  Download: iconStub('Download'),
  KeyRound: iconStub('KeyRound'),
  Plus: iconStub('Plus'),
}));

const { default: SecurityPage } = await import(
  '../../src/client/pages/SecurityPage.jsx'
);

// -------------------------------------------------------------------
// Defaults
// -------------------------------------------------------------------
const defaultEncryption = {
  isUnlocked: true,
  changeVaultKey: vi.fn(() => Promise.resolve({ success: true })),
  changeKdfIterations: vi.fn(() => Promise.resolve({ success: true })),
  viewRecoveryKey: vi.fn(() => Promise.resolve('viewedrecoverykey123456789abc')),
  regenerateRecoveryKey: vi.fn(() => Promise.resolve('newregenkey1234567890abcdef123456')),
  lock: vi.fn(),
  saveSession: vi.fn(),
};

const defaultAuth = {
  user: { id: 1, username: 'test_user', role: 'user' },
  preferences: { kdf_iterations: '100000', vault_key_type: 'alphanumeric' },
  refreshPreferences: vi.fn(),
};

beforeEach(() => {
  mockEncryption = { ...defaultEncryption };
  mockAuth = { ...defaultAuth };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ===================================================================
// Tests
// ===================================================================

describe('SecurityPage', () => {
  // -----------------------------------------------------------------
  // 21. Change vault key form flow
  // -----------------------------------------------------------------
  describe('change vault key', () => {
    it('shows Change Vault Key button', () => {
      render(<SecurityPage />);
      expect(screen.getByText('Change Vault Key')).toBeInTheDocument();
    });

    it('clicking button reveals the change key form', () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));
      expect(screen.getByText('Current Vault Key')).toBeInTheDocument();
      expect(screen.getByText(/New Vault Key/)).toBeInTheDocument();
      expect(screen.getByText('Confirm New Key')).toBeInTheDocument();
    });

    it('shows error when current key is empty', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));

      // Submit form with empty current key
      const form = screen.getByText('Change Key').closest('form');
      fireEvent.submit(form);

      expect(await screen.findByText('Current key is required.')).toBeInTheDocument();
      expect(mockEncryption.changeVaultKey).not.toHaveBeenCalled();
    });

    it('shows error when new key too short', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));

      const form = screen.getByText('Change Key').closest('form');
      const formInputs = form.querySelectorAll('input');
      fireEvent.change(formInputs[0], { target: { value: 'OldKey#1' } });
      fireEvent.change(formInputs[1], { target: { value: 'short' } });
      fireEvent.change(formInputs[2], { target: { value: 'short' } });
      fireEvent.submit(form);

      expect(await screen.findByText(/at least/)).toBeInTheDocument();
      expect(mockEncryption.changeVaultKey).not.toHaveBeenCalled();
    });

    it('shows error when keys do not match', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));

      const form = screen.getByText('Change Key').closest('form');
      const formInputs = form.querySelectorAll('input');
      fireEvent.change(formInputs[0], { target: { value: 'OldKey#12' } });
      fireEvent.change(formInputs[1], { target: { value: 'NewKey#12' } });
      fireEvent.change(formInputs[2], { target: { value: 'Different#1' } });
      fireEvent.submit(form);

      expect(await screen.findByText('New keys do not match.')).toBeInTheDocument();
      expect(mockEncryption.changeVaultKey).not.toHaveBeenCalled();
    });

    it('calls changeVaultKey() on valid submission', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));

      const form = screen.getByText('Change Key').closest('form');
      const formInputs = form.querySelectorAll('input');
      fireEvent.change(formInputs[0], { target: { value: 'OldKey#12' } });
      fireEvent.change(formInputs[1], { target: { value: 'NewKey#12' } });
      fireEvent.change(formInputs[2], { target: { value: 'NewKey#12' } });
      fireEvent.submit(form);

      await vi.waitFor(() => {
        expect(mockEncryption.changeVaultKey).toHaveBeenCalledWith('OldKey#12', 'NewKey#12');
      });
    });

    it('shows success message after key change', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));

      const form = screen.getByText('Change Key').closest('form');
      const formInputs = form.querySelectorAll('input');
      fireEvent.change(formInputs[0], { target: { value: 'OldKey#12' } });
      fireEvent.change(formInputs[1], { target: { value: 'NewKey#12' } });
      fireEvent.change(formInputs[2], { target: { value: 'NewKey#12' } });
      fireEvent.submit(form);

      expect(await screen.findByText(/changed successfully/)).toBeInTheDocument();
    });

    it('shows error on change failure', async () => {
      mockEncryption.changeVaultKey = vi.fn(() => Promise.reject(new Error('Current vault key is incorrect')));
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));

      const form = screen.getByText('Change Key').closest('form');
      const formInputs = form.querySelectorAll('input');
      fireEvent.change(formInputs[0], { target: { value: 'WrongOld#1' } });
      fireEvent.change(formInputs[1], { target: { value: 'NewKey#12' } });
      fireEvent.change(formInputs[2], { target: { value: 'NewKey#12' } });
      fireEvent.submit(form);

      expect(await screen.findByText('Current vault key is incorrect')).toBeInTheDocument();
    });

    it('cancel hides the form', () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Change Vault Key'));
      expect(screen.getByText('Current Vault Key')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Current Vault Key')).toBeNull();
    });
  });

  // -----------------------------------------------------------------
  // 23. Regenerate recovery key
  // -----------------------------------------------------------------
  describe('regenerate recovery key', () => {
    it('shows Regenerate button', () => {
      render(<SecurityPage />);
      expect(screen.getByText('Regenerate')).toBeInTheDocument();
    });

    it('clicking Regenerate shows confirmation warning', () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Regenerate'));
      expect(screen.getByText(/permanently invalidated/)).toBeInTheDocument();
      expect(screen.getByText('Confirm Regenerate')).toBeInTheDocument();
    });

    it('cancel hides the confirmation', () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Regenerate'));
      expect(screen.getByText('Confirm Regenerate')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Confirm Regenerate')).toBeNull();
    });

    it('calls regenerateRecoveryKey() on confirm', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Regenerate'));
      fireEvent.click(screen.getByText('Confirm Regenerate'));

      await vi.waitFor(() => {
        expect(mockEncryption.regenerateRecoveryKey).toHaveBeenCalled();
      });
    });

    it('displays new recovery key after regeneration', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Regenerate'));
      fireEvent.click(screen.getByText('Confirm Regenerate'));

      expect(await screen.findByTestId('recovery-key-display')).toHaveTextContent('newregenkey1234567890abcdef123456');
    });

    it('shows error toast on failure', async () => {
      mockEncryption.regenerateRecoveryKey = vi.fn(() => Promise.reject(new Error('Failed')));
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('Regenerate'));
      fireEvent.click(screen.getByText('Confirm Regenerate'));

      await vi.waitFor(() => {
        expect(screen.getByTestId('save-toast')).toHaveAttribute('data-type', 'error');
      });
    });
  });

  // -----------------------------------------------------------------
  // View recovery key
  // -----------------------------------------------------------------
  describe('view recovery key', () => {
    it('shows View Recovery Key button', () => {
      render(<SecurityPage />);
      expect(screen.getByText('View Recovery Key')).toBeInTheDocument();
    });

    it('displays recovery key on click', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('View Recovery Key'));

      expect(await screen.findByTestId('recovery-key-display')).toHaveTextContent('viewedrecoverykey123456789abc');
    });

    it('hides recovery key when Hide clicked', async () => {
      render(<SecurityPage />);
      fireEvent.click(screen.getByText('View Recovery Key'));
      await screen.findByTestId('recovery-key-display');

      fireEvent.click(screen.getByText('Hide'));
      expect(screen.queryByTestId('recovery-key-display')).toBeNull();
    });
  });

  // -----------------------------------------------------------------
  // Security log filter
  // -----------------------------------------------------------------
  describe('security log', () => {
    it('shows filter buttons', () => {
      render(<SecurityPage />);
      expect(screen.getByText('All')).toBeInTheDocument();
      expect(screen.getByText('Auth')).toBeInTheDocument();
      expect(screen.getByText('Vault')).toBeInTheDocument();
      expect(screen.getByText('Recovery')).toBeInTheDocument();
      expect(screen.getByText('Sharing')).toBeInTheDocument();
    });
  });
});
