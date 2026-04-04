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

vi.mock('../../src/client/components/Modal', () => ({
  default: ({ children, title, isOpen }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock('../../src/client/lib/defaults', () => ({
  getVaultKeyMinLength: (type) =>
    ({ numeric: 4, alphanumeric: 8, passphrase: 12 })[type] || 8,
  getUserPreference: () => 'alphanumeric',
  VAULT_KEY_MINIMUMS: { numeric: 4, alphanumeric: 8, passphrase: 12 },
  validateVaultKey: (key, keyType) => {
    const min = ({ numeric: 4, alphanumeric: 8, passphrase: 12 })[keyType] || 8;
    if (!key || key.length < min) return `Vault key must be at least ${min} characters.`;
    return null;
  },
}));

vi.mock('../../src/client/api/client', () => ({
  default: { put: vi.fn(() => Promise.resolve({ data: {} })) },
}));

vi.mock('../../src/client/components/RecoveryKeyCopyBlock', () => ({
  default: ({ recoveryKey }) => <div data-testid="recovery-key-display">{recoveryKey}</div>,
}));

const iconStub = (name) => (props) => <span data-icon={name} />;
vi.mock('lucide-react', () => ({
  KeyRound: iconStub('KeyRound'),
  Copy: iconStub('Copy'),
  Check: iconStub('Check'),
  AlertTriangle: iconStub('AlertTriangle'),
  Shield: iconStub('Shield'),
  Download: iconStub('Download'),
  Eye: iconStub('Eye'),
  EyeOff: iconStub('EyeOff'),
}));

const { default: EncryptionKeyModal } = await import(
  '../../src/client/components/EncryptionKeyModal.jsx'
);

// -------------------------------------------------------------------
// Defaults
// -------------------------------------------------------------------
const defaultEncryption = {
  isUnlocked: false,
  isLoading: false,
  vaultKeyExists: false,
  vaultPromptForced: null,
  setup: vi.fn(),
  unlock: vi.fn(),
  changeVaultKey: vi.fn(),
  recoverWithRecoveryKey: vi.fn(),
  skipVault: vi.fn(),
};

const defaultAuth = {
  mustChangePassword: false,
  mustChangeVaultKey: false,
  clearMustChangeVaultKey: vi.fn(),
  adminActionMessage: null,
  preferences: {},
  preferencesLoaded: true,
};

beforeEach(() => {
  mockEncryption = { ...defaultEncryption };
  mockAuth = { ...defaultAuth };
});

afterEach(() => {
  cleanup();
});

// ===================================================================
// Tests
// ===================================================================

describe('EncryptionKeyModal', () => {
  // -----------------------------------------------------------------
  // Visibility
  // -----------------------------------------------------------------
  describe('visibility', () => {
    it('returns null when isLoading is true', () => {
      mockEncryption = { ...defaultEncryption, isLoading: true };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).toBe('');
    });

    it('returns null when mustChangePassword is true', () => {
      mockAuth = { ...defaultAuth, mustChangePassword: true };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).toBe('');
    });

    it('returns null when unlocked and no force change', () => {
      mockEncryption = {
        ...defaultEncryption,
        isUnlocked: true,
        vaultKeyExists: true,
        vaultPromptForced: false,
      };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).toBe('');
    });

    it('renders when vault key does not exist (setup needed)', () => {
      // vaultKeyExists false + vaultPromptForced null => needsSetup
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: false,
        vaultPromptForced: null,
      };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).not.toBe('');
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('renders when vaultPromptForced is true', () => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: true,
        vaultPromptForced: true,
      };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).not.toBe('');
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('renders when mustChangeVaultKey and isUnlocked (force change)', () => {
      mockEncryption = {
        ...defaultEncryption,
        isUnlocked: true,
        vaultKeyExists: true,
      };
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).not.toBe('');
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('returns null when vault key does not exist but user skipped (vaultPromptForced === false)', () => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: false,
        vaultPromptForced: false,
      };
      const { container } = render(<EncryptionKeyModal />);
      expect(container.innerHTML).toBe('');
    });
  });

  // -----------------------------------------------------------------
  // Mode detection
  // -----------------------------------------------------------------
  describe('mode detection', () => {
    it('shows setup mode when vaultKeyExists is false', () => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: false,
        vaultPromptForced: null,
      };
      render(<EncryptionKeyModal />);
      expect(screen.getByRole('heading', { name: 'Set Up Vault Key' })).toBeInTheDocument();
    });

    it('shows unlock mode when vaultKeyExists is true', () => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: true,
        vaultPromptForced: true,
      };
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Unlock Your Vault')).toBeInTheDocument();
    });

    it('shows force_change mode when mustChangeVaultKey and isUnlocked', () => {
      mockEncryption = {
        ...defaultEncryption,
        isUnlocked: true,
        vaultKeyExists: true,
      };
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Change Your Vault Key')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // Setup mode
  // -----------------------------------------------------------------
  describe('setup mode', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: false,
        vaultPromptForced: null,
      };
    });

    it('renders "Set Up Vault Key" title', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByRole('heading', { name: 'Set Up Vault Key' })).toBeInTheDocument();
    });

    it('shows key type selector (PIN, Password, Passphrase)', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('PIN')).toBeInTheDocument();
      expect(screen.getByText('Password')).toBeInTheDocument();
      expect(screen.getByText('Passphrase')).toBeInTheDocument();
    });

    it('shows key type minimum character labels', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('4+ chars')).toBeInTheDocument();
      expect(screen.getByText('8+ chars')).toBeInTheDocument();
      expect(screen.getByText('12+ chars')).toBeInTheDocument();
    });

    it('shows Skip button', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Skip for now')).toBeInTheDocument();
    });

    it('calls skipVault when Skip clicked', () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Skip for now'));
      expect(defaultEncryption.skipVault).toHaveBeenCalledTimes(1);
    });

    it('shows submit button with correct text', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Set Up Vault Key', { selector: 'button' })).toBeInTheDocument();
    });

    it('shows vault key and confirm inputs', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Vault Key')).toBeInTheDocument();
      expect(screen.getByText('Confirm Vault Key')).toBeInTheDocument();
    });

    it('shows description text about encryption', () => {
      render(<EncryptionKeyModal />);
      expect(
        screen.getByText(/Create a vault key to protect your data/),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // Unlock mode
  // -----------------------------------------------------------------
  describe('unlock mode', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: true,
        vaultPromptForced: true,
      };
    });

    it('renders "Unlock Your Vault" title', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Unlock Your Vault')).toBeInTheDocument();
    });

    it('shows "Forgot vault key?" recovery link', () => {
      render(<EncryptionKeyModal />);
      expect(
        screen.getByText('Forgot vault key? Use recovery key'),
      ).toBeInTheDocument();
    });

    it('shows Skip button', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Skip for now')).toBeInTheDocument();
    });

    it('shows unlock submit button', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Unlock Vault')).toBeInTheDocument();
    });

    it('shows description text about decryption', () => {
      render(<EncryptionKeyModal />);
      expect(
        screen.getByText(/Enter your vault key to decrypt your data/),
      ).toBeInTheDocument();
    });

    it('hides Skip button when forceUnlockForChange is active', () => {
      // mustChangeVaultKey + !isUnlocked + vaultKeyExists => forceUnlockForChange
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
      render(<EncryptionKeyModal />);
      expect(screen.queryByText('Skip for now')).toBeNull();
    });

    it('shows "Vault Key Change Required" title for forceUnlockForChange', () => {
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Vault Key Change Required')).toBeInTheDocument();
    });

    it('shows "Continue" button instead of "Unlock Vault" for forceUnlockForChange', () => {
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Continue')).toBeInTheDocument();
      expect(screen.queryByText('Unlock Vault')).toBeNull();
    });

    it('shows admin warning message in forceUnlockForChange', () => {
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
      render(<EncryptionKeyModal />);
      expect(
        screen.getByText(/administrator requires you to change/),
      ).toBeInTheDocument();
    });

    it('shows custom admin message in forceUnlockForChange when provided', () => {
      mockAuth = {
        ...defaultAuth,
        mustChangeVaultKey: true,
        adminActionMessage: 'Security policy update',
      };
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Security policy update')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // Force change mode
  // -----------------------------------------------------------------
  describe('force_change mode', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        isUnlocked: true,
        vaultKeyExists: true,
      };
      mockAuth = { ...defaultAuth, mustChangeVaultKey: true };
    });

    it('renders "Change Your Vault Key" title', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Change Your Vault Key')).toBeInTheDocument();
    });

    it('shows admin warning message', () => {
      render(<EncryptionKeyModal />);
      expect(
        screen.getByText(/administrator requires you to change your vault key/),
      ).toBeInTheDocument();
    });

    it('shows custom admin action message when provided', () => {
      mockAuth = {
        ...defaultAuth,
        mustChangeVaultKey: true,
        adminActionMessage: 'Quarterly key rotation',
      };
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Quarterly key rotation')).toBeInTheDocument();
    });

    it('shows key type selector (PIN, Password, Passphrase)', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('PIN')).toBeInTheDocument();
      expect(screen.getByText('Password')).toBeInTheDocument();
      expect(screen.getByText('Passphrase')).toBeInTheDocument();
    });

    it('shows new vault key and confirm inputs', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('New Vault Key')).toBeInTheDocument();
      expect(screen.getByText('Confirm New Key')).toBeInTheDocument();
    });

    it('shows "Change Vault Key" submit button', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Change Vault Key')).toBeInTheDocument();
    });

    it('shows "Current Vault Key" field when oldVaultKey is empty', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('Current Vault Key')).toBeInTheDocument();
    });

    it('shows "New Key Type" label', () => {
      render(<EncryptionKeyModal />);
      expect(screen.getByText('New Key Type')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // Recovery mode (via clicking recovery link from unlock)
  // -----------------------------------------------------------------
  describe('recovery mode', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: true,
        vaultPromptForced: true,
      };
    });

    it('switches to recovery mode when recovery link is clicked', () => {
      render(<EncryptionKeyModal />);
      // Initially in unlock mode
      expect(screen.getByText('Unlock Your Vault')).toBeInTheDocument();

      // Click recovery link
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));

      // Now in recovery mode
      expect(screen.getByText('Recover Your Vault')).toBeInTheDocument();
    });

    it('shows recovery key input field', () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));
      expect(screen.getByText('Recovery Key')).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText('Enter your 32-character recovery key'),
      ).toBeInTheDocument();
    });

    it('shows new vault key and confirm fields', () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));
      expect(screen.getByText('New Vault Key')).toBeInTheDocument();
      expect(screen.getByText('Confirm New Key')).toBeInTheDocument();
    });

    it('shows "Recover Vault" submit button', () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));
      expect(screen.getByText('Recover Vault')).toBeInTheDocument();
    });

    it('shows Back button to return to unlock mode', () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));
      expect(screen.getByText('Back')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Back'));
      expect(screen.getByText('Unlock Your Vault')).toBeInTheDocument();
    });

    it('shows description about recovery', () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));
      expect(
        screen.getByText(/Enter your recovery key to regain access/),
      ).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // Show/hide vault key toggle
  // -----------------------------------------------------------------
  describe('show/hide vault key toggle', () => {
    it('toggles between Show and Hide in setup mode', () => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: false,
        vaultPromptForced: null,
      };
      render(<EncryptionKeyModal />);
      const showBtn = screen.getByText('Show');
      expect(showBtn).toBeInTheDocument();

      fireEvent.click(showBtn);
      expect(screen.getByText('Hide')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Hide'));
      expect(screen.getByText('Show')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // 18. Setup interaction — submit calls setup(), shows recovery key
  // -----------------------------------------------------------------
  describe('setup interaction', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: false,
        vaultPromptForced: null,
        setup: vi.fn(() => Promise.resolve({ recoveryKey: 'abc123def456abc123def456abc123de' })),
      };
    });

    it('shows error when keys do not match', async () => {
      render(<EncryptionKeyModal />);
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'VaultKey#1' } });
      fireEvent.change(inputs[1], { target: { value: 'Different#1' } });
      fireEvent.click(screen.getByText('Set Up Vault Key', { selector: 'button' }));

      expect(await screen.findByText('Vault keys do not match.')).toBeInTheDocument();
      expect(mockEncryption.setup).not.toHaveBeenCalled();
    });

    it('shows error when key too short', async () => {
      render(<EncryptionKeyModal />);
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'short' } });
      fireEvent.change(inputs[1], { target: { value: 'short' } });
      fireEvent.click(screen.getByText('Set Up Vault Key', { selector: 'button' }));

      expect(await screen.findByText(/at least 8/)).toBeInTheDocument();
      expect(mockEncryption.setup).not.toHaveBeenCalled();
    });

    it('calls setup() and shows recovery key on success', async () => {
      render(<EncryptionKeyModal />);
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'ValidKey#1' } });
      fireEvent.change(inputs[1], { target: { value: 'ValidKey#1' } });
      fireEvent.click(screen.getByText('Set Up Vault Key', { selector: 'button' }));

      // Wait for recovery key display
      expect(await screen.findByText('Save Your Recovery Key')).toBeInTheDocument();
      expect(mockEncryption.setup).toHaveBeenCalledWith('ValidKey#1');
      expect(screen.getByTestId('recovery-key-display')).toHaveTextContent('abc123def456abc123def456abc123de');
    });

    it('shows error on setup failure', async () => {
      mockEncryption.setup = vi.fn(() => Promise.reject(new Error('Setup failed.')));
      render(<EncryptionKeyModal />);
      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'ValidKey#1' } });
      fireEvent.change(inputs[1], { target: { value: 'ValidKey#1' } });
      fireEvent.click(screen.getByText('Set Up Vault Key', { selector: 'button' }));

      expect(await screen.findByText('Setup failed.')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // 19. Recovery interaction — submit calls recoverWithRecoveryKey()
  // -----------------------------------------------------------------
  describe('recovery interaction', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        vaultKeyExists: true,
        vaultPromptForced: true,
        recoverWithRecoveryKey: vi.fn(() => Promise.resolve({ recoveryKey: 'newreckey1234567890abcdef12345678' })),
      };
    });

    it('shows error when recovery key is empty', async () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));

      // Submit form directly (bypasses HTML required)
      const form = screen.getByText('Recover Vault').closest('form');
      fireEvent.submit(form);

      expect(await screen.findByText('Enter your recovery key.')).toBeInTheDocument();
      expect(mockEncryption.recoverWithRecoveryKey).not.toHaveBeenCalled();
    });

    it('calls recoverWithRecoveryKey() and shows new recovery key', async () => {
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));

      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'abc123def456abc123def456abc123de' } });
      fireEvent.change(inputs[1], { target: { value: 'NewVault#1' } });
      fireEvent.change(inputs[2], { target: { value: 'NewVault#1' } });
      fireEvent.click(screen.getByText('Recover Vault'));

      expect(await screen.findByText('Save Your Recovery Key')).toBeInTheDocument();
      expect(mockEncryption.recoverWithRecoveryKey).toHaveBeenCalledWith(
        'abc123def456abc123def456abc123de', 'NewVault#1'
      );
      expect(screen.getByTestId('recovery-key-display')).toHaveTextContent('newreckey1234567890abcdef12345678');
    });

    it('shows error on recovery failure', async () => {
      mockEncryption.recoverWithRecoveryKey = vi.fn(() => Promise.reject(new Error('Recovery key is incorrect')));
      render(<EncryptionKeyModal />);
      fireEvent.click(screen.getByText('Forgot vault key? Use recovery key'));

      const inputs = screen.getAllByDisplayValue('');
      fireEvent.change(inputs[0], { target: { value: 'wrongreckeywrongreckeywrongrecke' } });
      fireEvent.change(inputs[1], { target: { value: 'NewVault#1' } });
      fireEvent.change(inputs[2], { target: { value: 'NewVault#1' } });
      fireEvent.click(screen.getByText('Recover Vault'));

      expect(await screen.findByText('Recovery key is incorrect')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // 20. Force change interaction — submit calls changeVaultKey()
  // -----------------------------------------------------------------
  describe('force change interaction', () => {
    beforeEach(() => {
      mockEncryption = {
        ...defaultEncryption,
        isUnlocked: true,
        vaultKeyExists: true,
        changeVaultKey: vi.fn(() => Promise.resolve({ success: true })),
      };
      mockAuth = {
        ...defaultAuth,
        mustChangeVaultKey: true,
        clearMustChangeVaultKey: vi.fn(),
      };
    });

    it('shows error when current key is empty', async () => {
      render(<EncryptionKeyModal />);
      fireEvent.change(screen.getByPlaceholderText(/characters/), { target: { value: 'NewForce#1' } });
      fireEvent.change(screen.getByPlaceholderText('Confirm'), { target: { value: 'NewForce#1' } });

      // Submit form directly (bypasses HTML required on current key input)
      const form = screen.getByText('Change Vault Key').closest('form');
      fireEvent.submit(form);

      expect(await screen.findByText('Enter your current vault key.')).toBeInTheDocument();
      expect(mockEncryption.changeVaultKey).not.toHaveBeenCalled();
    });

    it('shows error when new key matches current', async () => {
      render(<EncryptionKeyModal />);
      fireEvent.change(screen.getByPlaceholderText('Current key'), { target: { value: 'SameKey#1' } });
      fireEvent.change(screen.getByPlaceholderText(/characters/), { target: { value: 'SameKey#1' } });
      fireEvent.change(screen.getByPlaceholderText('Confirm'), { target: { value: 'SameKey#1' } });
      fireEvent.click(screen.getByText('Change Vault Key'));

      expect(await screen.findByText(/must be different/)).toBeInTheDocument();
      expect(mockEncryption.changeVaultKey).not.toHaveBeenCalled();
    });

    it('calls changeVaultKey() and clearMustChangeVaultKey() on success', async () => {
      render(<EncryptionKeyModal />);
      fireEvent.change(screen.getByPlaceholderText('Current key'), { target: { value: 'OldForce#1' } });
      fireEvent.change(screen.getByPlaceholderText(/characters/), { target: { value: 'NewForce#1' } });
      fireEvent.change(screen.getByPlaceholderText('Confirm'), { target: { value: 'NewForce#1' } });
      fireEvent.click(screen.getByText('Change Vault Key'));

      await vi.waitFor(() => {
        expect(mockEncryption.changeVaultKey).toHaveBeenCalledWith('OldForce#1', 'NewForce#1');
        expect(mockAuth.clearMustChangeVaultKey).toHaveBeenCalled();
      });
    });

    it('shows error on change failure', async () => {
      mockEncryption.changeVaultKey = vi.fn(() => Promise.reject(new Error('Current vault key is incorrect')));
      render(<EncryptionKeyModal />);
      fireEvent.change(screen.getByPlaceholderText('Current key'), { target: { value: 'WrongOld#1' } });
      fireEvent.change(screen.getByPlaceholderText(/characters/), { target: { value: 'NewForce#1' } });
      fireEvent.change(screen.getByPlaceholderText('Confirm'), { target: { value: 'NewForce#1' } });
      fireEvent.click(screen.getByText('Change Vault Key'));

      expect(await screen.findByText('Current vault key is incorrect')).toBeInTheDocument();
    });
  });
});
