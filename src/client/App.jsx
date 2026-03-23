import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { EncryptionProvider } from './contexts/EncryptionContext';
import { SyncProvider } from './contexts/SyncContext';
import { VaultDataProvider } from './contexts/VaultDataContext';
import Modal from './components/Modal';
import Layout from './components/Layout';
import api from './api/client';

// Page imports
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import DashboardPage from './pages/DashboardPage';
import VaultPage from './pages/VaultPage';
import PortfolioPage from './pages/PortfolioPage';
import SharingPage from './pages/SharingPage';
import ImportExportPage from './pages/ImportExportPage';
import SecurityPage from './pages/SecurityPage';
import ProfilePage from './pages/ProfilePage';
import TemplatesPage from './pages/TemplatesPage';
import UsersPage from './pages/UsersPage';
import ReferenceDataPage from './pages/ReferenceDataPage';
import SettingsPage from './pages/SettingsPage';
import HomePage from './pages/HomePage';
import HelpPage from './pages/HelpPage';
import DevGuidePage from './pages/DevGuidePage';
import FeaturesPage from './pages/FeaturesPage';
import EncryptionKeyModal from './components/EncryptionKeyModal';
import UpdateToast from './components/UpdateToast';
import ErrorBoundary from './components/ErrorBoundary';

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
  const { user, mustChangePassword, clearMustChangePassword, refreshUser, adminActionMessage, logout } = useAuth();
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
      await refreshUser();
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
          <input id="fcpm-new-password" type="password" className="form-control" value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} required autoFocus />
        </div>
        <div className="form-group">
          <label htmlFor="fcpm-confirm-password">Confirm Password</label>
          <input id="fcpm-confirm-password" type="password" className="form-control" value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)} required />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Change Password'}
          </button>
          <button type="button" className="btn btn-outline" onClick={logout}>Sign Out</button>
        </div>
      </form>
    </Modal>
  );
}

// --- Offline Banner ---
function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#f59e0b', color: '#000', textAlign: 'center',
      padding: '6px 12px', fontSize: 13, fontWeight: 600,
    }}>
      You are offline. Viewing cached data. Changes require an internet connection.
    </div>
  );
}

// --- AppRoutes ---
const PUBLIC_PATHS = ['/home', '/help', '/dev-guide', '/features', '/login', '/register', '/forgot-password', '/verify-email'];

function AppRoutes() {
  const { user } = useAuth();
  const location = useLocation();
  const isPublicPage = PUBLIC_PATHS.includes(location.pathname);

  return (
    <>
      <OfflineBanner />
      <UpdateToast />
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
        <Route path="/home" element={user ? <Navigate to="/" replace /> : <HomePage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/dev-guide" element={<DevGuidePage />} />

        {/* Protected routes with Layout */}
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="portfolio" element={<PortfolioPage />} />
          <Route path="sharing" element={<SharingPage />} />
          <Route path="import-export" element={<ImportExportPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="admin/users" element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>} />
          <Route path="admin/reference" element={<ProtectedRoute adminOnly><ReferenceDataPage /></ProtectedRoute>} />
          <Route path="admin/settings" element={<ProtectedRoute adminOnly><SettingsPage /></ProtectedRoute>} />
          <Route path="admin" element={<Navigate to="/admin/users" replace />} />
          <Route path="settings" element={<Navigate to="/admin/settings" replace />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to={user ? '/' : '/home'} replace />} />
      </Routes>

      {/* Global modals — only on protected pages */}
      {user && !isPublicPage && (
        <>
          <ForceChangePasswordModal />
          <EncryptionKeyModal />
        </>
      )}
    </>
  );
}

// --- EncryptionWrapper ---
import useAppConfig from './hooks/useAppConfig';
import * as workerDispatcher from './lib/workerDispatcher';
import * as cachePolicy from './lib/cachePolicy';

function EncryptionWrapper({ children }) {
  const { user } = useAuth();
  const { config } = useAppConfig();

  useEffect(() => {
    if (config) {
      workerDispatcher.configure({
        workerMode: config.worker_mode,
        workerThreshold: config.worker_threshold,
        workerAdaptiveMs: config.worker_adaptive_ms,
      });
      cachePolicy.configure({
        cacheMode: config.cache_mode,
        cacheTtlHours: config.cache_ttl_hours,
      });
    }
  }, [config]);

  return (
    <EncryptionProvider user={user}>
      <VaultDataProvider>
        <SyncProvider>{children}</SyncProvider>
      </VaultDataProvider>
    </EncryptionProvider>
  );
}

// --- App ---
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <EncryptionWrapper>
            <AppRoutes />
          </EncryptionWrapper>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
