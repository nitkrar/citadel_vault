/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Default mock values
let mockAuth = {};
const mockNavigate = vi.fn();

vi.mock('../../src/client/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));

vi.mock('../../src/client/components/WebAuthnLogin', () => ({
  isWebAuthnSupported: () => false,
  startConditionalMediation: vi.fn(),
  abortConditionalMediation: vi.fn(),
}));

vi.mock('../../src/client/api/client', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const iconStub = (name) => (props) => <span data-icon={name} />;
vi.mock('lucide-react', () => ({
  Database: iconStub('Database'),
  Eye: iconStub('Eye'),
  EyeOff: iconStub('EyeOff'),
  Fingerprint: iconStub('Fingerprint'),
  Lock: iconStub('Lock'),
  User: iconStub('User'),
}));

const { default: LoginPage } = await import(
  '../../src/client/pages/LoginPage.jsx'
);

// Also import the WebAuthn mock so we can change isWebAuthnSupported per test
const WebAuthnLogin = await import('../../src/client/components/WebAuthnLogin');

// -------------------------------------------------------------------
// Defaults
// -------------------------------------------------------------------
const defaultAuth = {
  login: vi.fn(() => Promise.resolve()),
  loginWithToken: vi.fn(),
  loginWithPasskey: vi.fn(() => Promise.resolve()),
};

beforeEach(() => {
  mockAuth = { ...defaultAuth };
  mockNavigate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ===================================================================
// Tests
// ===================================================================

describe('LoginPage', () => {
  // -----------------------------------------------------------------
  // 1. Renders login form with username and password fields
  // -----------------------------------------------------------------
  describe('rendering', () => {
    it('renders username/email input field', () => {
      render(<LoginPage />);
      expect(screen.getByPlaceholderText('Enter your username or email')).toBeInTheDocument();
    });

    it('renders password input field', () => {
      render(<LoginPage />);
      expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    });

    it('renders "Username or Email" label', () => {
      render(<LoginPage />);
      expect(screen.getByText('Username or Email')).toBeInTheDocument();
    });

    it('renders "Password" label', () => {
      render(<LoginPage />);
      expect(screen.getByText('Password')).toBeInTheDocument();
    });

    it('renders Sign In button', () => {
      render(<LoginPage />);
      expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    });

    it('renders app name heading', () => {
      render(<LoginPage />);
      // Default is 'Personal Vault' from import.meta.env fallback
      expect(screen.getByRole('heading', { name: 'Personal Vault' })).toBeInTheDocument();
    });

    it('password field has type password by default', () => {
      render(<LoginPage />);
      const passwordInput = screen.getByPlaceholderText('Enter your password');
      expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });

  // -----------------------------------------------------------------
  // 2. Shows error when submitting empty form
  // -----------------------------------------------------------------
  describe('form field validation attributes', () => {
    it('username and password inputs have required attribute', () => {
      render(<LoginPage />);
      const usernameInput = screen.getByPlaceholderText('Enter your username or email');
      const passwordInput = screen.getByPlaceholderText('Enter your password');
      expect(usernameInput).toHaveAttribute('required');
      expect(passwordInput).toHaveAttribute('required');
    });
  });

  // -----------------------------------------------------------------
  // 3. Shows error on invalid credentials (login rejects)
  // -----------------------------------------------------------------
  describe('invalid credentials', () => {
    it('shows error message from server response', async () => {
      const serverError = new Error('Login failed');
      serverError.response = { data: { error: 'Invalid username or password.' } };
      mockAuth.login = vi.fn(() => Promise.reject(serverError));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'baduser' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'badpass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
    });

    it('shows fallback error message when no response data', async () => {
      mockAuth.login = vi.fn(() => Promise.reject(new Error('Network error')));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      expect(
        await screen.findByText('Login failed. Please check your credentials.')
      ).toBeInTheDocument();
    });

    it('shows error from response.data.message when error field absent', async () => {
      const serverError = new Error('Login failed');
      serverError.response = { data: { message: 'Account locked.' } };
      mockAuth.login = vi.fn(() => Promise.reject(serverError));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'locked_user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      expect(await screen.findByText('Account locked.')).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // 4. Calls login function with correct username/password
  // -----------------------------------------------------------------
  describe('successful login', () => {
    it('calls login with entered username and password', async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'myuser' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'MyPass#123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(mockAuth.login).toHaveBeenCalledWith('myuser', 'MyPass#123');
      });
    });

    it('navigates to "/" on successful login', async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'myuser' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'MyPass#123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });

    it('does not navigate on failed login', async () => {
      mockAuth.login = vi.fn(() => Promise.reject(new Error('fail')));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(mockAuth.login).toHaveBeenCalled();
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  // 5. Error state is cleared on new submission
  // -----------------------------------------------------------------
  describe('error clearing', () => {
    it('clears previous error when submitting again', async () => {
      // First attempt fails
      mockAuth.login = vi.fn(() => Promise.reject(new Error('fail')));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      expect(
        await screen.findByText('Login failed. Please check your credentials.')
      ).toBeInTheDocument();

      // Second attempt succeeds — error should disappear
      mockAuth.login = vi.fn(() => Promise.resolve());
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(
          screen.queryByText('Login failed. Please check your credentials.')
        ).not.toBeInTheDocument();
      });
    });
  });

  // -----------------------------------------------------------------
  // 6. Shows loading state while logging in
  // -----------------------------------------------------------------
  describe('loading state', () => {
    it('shows "Signing in..." while login is pending', async () => {
      // Create a login promise that doesn't resolve immediately
      let resolveLogin;
      mockAuth.login = vi.fn(
        () => new Promise((resolve) => { resolveLogin = resolve; })
      );

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      // Should show loading text
      expect(screen.getByText('Signing in...')).toBeInTheDocument();

      // Button should be disabled
      expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();

      // Resolve login to clean up
      resolveLogin();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeDisabled();
      });
    });

    it('re-enables button after login failure', async () => {
      mockAuth.login = vi.fn(() => Promise.reject(new Error('fail')));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeDisabled();
      });
    });
  });

  // -----------------------------------------------------------------
  // 7. Has link to forgot password page
  // -----------------------------------------------------------------
  describe('forgot password link', () => {
    it('renders a link to /forgot-password', () => {
      render(<LoginPage />);
      const link = screen.getByText('Forgot password?');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/forgot-password');
    });
  });

  // -----------------------------------------------------------------
  // 8. Has link to register page
  // -----------------------------------------------------------------
  describe('register link', () => {
    it('renders a link to /register', () => {
      render(<LoginPage />);
      const link = screen.getByText('Create one');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/register');
    });

    it('shows "Don\'t have an account?" text', () => {
      render(<LoginPage />);
      expect(screen.getByText(/Don't have an account/)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // 9. Password show/hide toggle
  // -----------------------------------------------------------------
  describe('password visibility toggle', () => {
    it('toggles password field between password and text type', () => {
      render(<LoginPage />);
      const passwordInput = screen.getByPlaceholderText('Enter your password');
      expect(passwordInput).toHaveAttribute('type', 'password');

      // Find the toggle button via its Eye icon child
      const eyeIcon = document.querySelector('[data-icon="Eye"]');
      const toggleBtn = eyeIcon.closest('button');
      fireEvent.click(toggleBtn);

      expect(passwordInput).toHaveAttribute('type', 'text');

      // After toggle, icon changes to EyeOff — find the button again
      const eyeOffIcon = document.querySelector('[data-icon="EyeOff"]');
      fireEvent.click(eyeOffIcon.closest('button'));
      expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });

  // -----------------------------------------------------------------
  // 10. Passkey button (when WebAuthn is supported)
  // -----------------------------------------------------------------
  describe('passkey support', () => {
    it('does not show passkey button when WebAuthn is unsupported', () => {
      render(<LoginPage />);
      expect(screen.queryByText('Sign in with Passkey')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------
  // 11. Error alert visibility
  // -----------------------------------------------------------------
  describe('error alert', () => {
    it('does not show error alert initially', () => {
      render(<LoginPage />);
      const alertDiv = document.querySelector('.alert-danger');
      expect(alertDiv).toBeNull();
    });

    it('shows error alert with alert-danger class on failure', async () => {
      mockAuth.login = vi.fn(() => Promise.reject(new Error('fail')));

      render(<LoginPage />);
      fireEvent.change(screen.getByPlaceholderText('Enter your username or email'), {
        target: { value: 'user' },
      });
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'pass' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        const alertDiv = document.querySelector('.alert-danger');
        expect(alertDiv).not.toBeNull();
        expect(alertDiv.textContent).toBe(
          'Login failed. Please check your credentials.'
        );
      });
    });
  });
});
