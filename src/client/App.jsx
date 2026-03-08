import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { EncryptionProvider } from './contexts/EncryptionContext';
import Modal from './components/Modal';
import Layout from './components/Layout';
import api from './api/client';

// Page imports
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import AssetsPage from './pages/AssetsPage';
import InsurancePage from './pages/InsurancePage';
import PortfolioPage from './pages/PortfolioPage';
import VaultPage from './pages/VaultPage';
import LicensesPage from './pages/LicensesPage';
import SharingPage from './pages/SharingPage';
import ExportPage from './pages/ExportPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import HomePage from './pages/HomePage';
import HelpPage from './pages/HelpPage';
import DevGuidePage from './pages/DevGuidePage';
import FeaturesPage from './pages/FeaturesPage';
import EncryptionKeyModal from './components/EncryptionKeyModal';

// --- ProtectedRoute ---
function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isSiteAdmin } = useAuth();

  if (loading) {
    return (
      <div className="page-spinner">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/home" replace />;
  }

  if (adminOnly && !isSiteAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

// --- ForceChangePasswordModal ---
function ForceChangePasswordModal() {
  const { user, mustChangePassword, clearMustChangePassword, adminActionMessage, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user || !mustChangePassword) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setSaving(true);
      await api.post('/auth.php?action=force-change-password', {
        new_password: newPassword,
      });
      clearMustChangePassword();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={true} title="Change Your Password">
      <p className="mb-3">{adminActionMessage || 'Your administrator requires you to change your password before continuing.'}</p>
      <form onSubmit={handleSubmit}>
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="form-group">
          <label htmlFor="fcpm-new-password">New Password</label>
          <input
            id="fcpm-new-password"
            type="password"
            className="form-control"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="fcpm-confirm-password">Confirm Password</label>
          <input
            id="fcpm-confirm-password"
            type="password"
            className="form-control"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Change Password'}
          </button>
          <button type="button" className="btn btn-outline" onClick={logout}>
            Sign Out
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- AppRoutes ---
function AppRoutes() {
  const { user } = useAuth();

  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={user ? <Navigate to="/" replace /> : <RegisterPage />}
        />
        <Route
          path="/forgot-password"
          element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />}
        />
        <Route path="/home" element={user ? <Navigate to="/" replace /> : <HomePage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/dev-guide" element={<DevGuidePage />} />

        {/* Protected routes with Layout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="insurance" element={<InsurancePage />} />
          <Route path="portfolio" element={<PortfolioPage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="licenses" element={<LicensesPage />} />
          <Route path="sharing" element={<SharingPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route
            path="admin"
            element={
              <ProtectedRoute adminOnly>
                <AdminPage />
              </ProtectedRoute>
            }
          />
        </Route>

        {/* Catch-all: authenticated users go to dashboard, others go to home */}
        <Route path="*" element={<Navigate to={user ? '/' : '/home'} replace />} />
      </Routes>

      {/* Global modals */}
      {user && <ForceChangePasswordModal />}
      {user && <EncryptionKeyModal />}
    </>
  );
}

// --- EncryptionWrapper ---
// Bridges AuthContext -> EncryptionProvider by passing `user` as a prop
function EncryptionWrapper({ children }) {
  const { user } = useAuth();
  return <EncryptionProvider user={user}>{children}</EncryptionProvider>;
}

// --- App ---
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <EncryptionWrapper>
          <AppRoutes />
        </EncryptionWrapper>
      </AuthProvider>
    </BrowserRouter>
  );
}
