import { createContext, useContext, useState, useEffect } from 'react';
import { isTruthy } from '../lib/checks';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEncryption } from '../contexts/EncryptionContext';
import PageNotice from './PageNotice';
import { isWebAuthnSupported, registerPasskey } from './WebAuthnLogin';
import api from '../api/client';
import {
  LayoutDashboard,
  Landmark,
  Briefcase,
  ShieldCheck,
  PieChart,
  KeyRound,
  FileText,
  Share2,
  User,
  Shield,
  LogOut,
  Database,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  FileDown,
  Sun,
  Moon,
  HelpCircle,
} from 'lucide-react';

// --- Hide Amounts Context ---
const HideAmountsContext = createContext();

export function useHideAmounts() {
  return useContext(HideAmountsContext);
}

export default function Layout() {
  const { user, logout, isSiteAdmin } = useAuth();
  const { vaultUnlocked, vaultKeyExists, lockVault, promptVault } = useEncryption();

  const [hideAmounts, setHideAmounts] = useState(() => {
    return localStorage.getItem('pv_hide_amounts') === 'true';
  });

  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('pv_dark_mode');
    if (stored !== null) return stored === 'true';
    return document.documentElement.classList.contains('dark');
  });

  const [pendingShareCount, setPendingShareCount] = useState(0);
  const [showPasskeyBanner, setShowPasskeyBanner] = useState(false);
  const [passkeyBannerLoading, setPasskeyBannerLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('pv_hide_amounts', hideAmounts);
  }, [hideAmounts]);

  // Dark mode toggle
  useEffect(() => {
    localStorage.setItem('pv_dark_mode', darkMode);
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Load pending share count
  useEffect(() => {
    let cancelled = false;
    const loadPendingShares = async () => {
      try {
        const res = await (await import('../api/client')).default.get('/sharing.php?action=received');
        if (!cancelled) {
          const shares = res.data?.data || res.data?.shares || [];
          setPendingShareCount(shares.length);
        }
      } catch {
        // silently fail
      }
    };
    loadPendingShares();
    return () => { cancelled = true; };
  }, []);

  // Check if passkey enrollment banner should show
  useEffect(() => {
    if (!isWebAuthnSupported()) return;
    if (localStorage.getItem('pv_passkey_banner_dismissed') === 'true') return;
    let cancelled = false;
    api.get('/webauthn.php?action=list')
      .then((res) => {
        if (!cancelled) {
          const passkeys = res.data?.data || [];
          setShowPasskeyBanner(passkeys.length === 0);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handlePasskeySetup = async () => {
    const name = prompt('Give this passkey a name (e.g., "My MacBook"):', 'My Passkey');
    if (name === null) return;
    setPasskeyBannerLoading(true);
    try {
      await registerPasskey(api, name || 'My Passkey');
      setShowPasskeyBanner(false);
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        alert(err.response?.data?.error || err.message || 'Failed to register passkey.');
      }
    }
    setPasskeyBannerLoading(false);
  };

  const dismissPasskeyBannerSession = () => {
    setShowPasskeyBanner(false);
  };

  const dismissPasskeyBannerPermanent = () => {
    localStorage.setItem('pv_passkey_banner_dismissed', 'true');
    setShowPasskeyBanner(false);
  };

  const toggleHideAmounts = () => setHideAmounts((prev) => !prev);
  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  const location = useLocation();
  const appName = import.meta.env.VITE_APP_NAME || 'Personal Vault';
  // Pages that don't need the vault locked banner
  const hideVaultBanner = ['/profile', '/admin'].includes(location.pathname);
  const appTagline = import.meta.env.VITE_APP_TAGLINE || 'Secure Personal Hub';

  return (
    <HideAmountsContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo">
              <Shield size={28} />
              <div>
                <h1>{appName}</h1>
                <span className="sidebar-subtitle">{appTagline}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="icon-btn"
                onClick={toggleDarkMode}
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                className="icon-btn"
                onClick={toggleHideAmounts}
                title={hideAmounts ? 'Show amounts' : 'Hide amounts'}
              >
                {hideAmounts ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <nav className="sidebar-nav">
            {/* Overview */}
            <div className="nav-section">
              <span className="nav-section-label">Overview</span>
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
                <LayoutDashboard size={18} /> Dashboard
              </NavLink>
              <NavLink to="/portfolio" className={({ isActive }) => (isActive ? 'active' : '')}>
                <PieChart size={18} /> Portfolio
              </NavLink>
              <NavLink to="/export" className={({ isActive }) => (isActive ? 'active' : '')}>
                <FileDown size={18} /> Export
              </NavLink>
            </div>

            {/* Finance */}
            <div className="nav-section">
              <span className="nav-section-label">Finance</span>
              <NavLink to="/accounts" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Landmark size={18} /> Accounts
              </NavLink>
              <NavLink to="/assets" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Briefcase size={18} /> Assets
              </NavLink>
              <NavLink to="/insurance" className={({ isActive }) => (isActive ? 'active' : '')}>
                <ShieldCheck size={18} /> Insurance
              </NavLink>
            </div>

            {/* Secure Storage */}
            <div className="nav-section">
              <span className="nav-section-label">Secure Storage</span>
              <NavLink to="/vault" className={({ isActive }) => (isActive ? 'active' : '')}>
                <KeyRound size={18} /> Password Vault
              </NavLink>
              <NavLink to="/licenses" className={({ isActive }) => (isActive ? 'active' : '')}>
                <FileText size={18} /> Licenses
              </NavLink>
            </div>

            {/* Settings */}
            <div className="nav-section">
              <span className="nav-section-label">Settings</span>
              <NavLink to="/sharing" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Share2 size={18} />
                <span>Sharing</span>
                {pendingShareCount > 0 && (
                  <span className="badge badge-primary" style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 6px' }}>
                    {pendingShareCount}
                  </span>
                )}
              </NavLink>
              <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
                <User size={18} /> Profile
              </NavLink>
              {isSiteAdmin && (
                <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Database size={18} /> Admin
                </NavLink>
              )}
            </div>

            {/* Help */}
            <div className="nav-section">
              <span className="nav-section-label">Help</span>
              <a href="/help" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <HelpCircle size={18} /> Help &amp; FAQ
              </a>
            </div>
          </nav>

          <div className="sidebar-footer">
            {(import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_BUILD_ID) && (
              <div className="text-sm" style={{ color: 'var(--sidebar-text-muted)', marginBottom: 6, fontSize: 11 }}>
                v{import.meta.env.VITE_APP_VERSION || '?'} build {import.meta.env.VITE_BUILD_ID || '?'}
              </div>
            )}
            <div className="sidebar-user-info">
              <span>Signed in as <strong>{user?.username}</strong></span>
              {user?.site_admin && <span className="badge badge-admin">Admin</span>}
            </div>
            <div className="sidebar-footer-actions">
              {isTruthy(vaultUnlocked) ? (
                <button
                  className="btn btn-sm btn-outline"
                  onClick={lockVault}
                  style={{ fontSize: 12, padding: '3px 10px' }}
                >
                  <Lock size={12} /> Lock Vault
                </button>
              ) : isTruthy(vaultKeyExists) ? (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={promptVault}
                  style={{ fontSize: 12, padding: '3px 10px' }}
                >
                  <Lock size={12} /> Unlock Vault
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-warning"
                  onClick={promptVault}
                  style={{ fontSize: 12, padding: '3px 10px' }}
                >
                  <Lock size={12} /> Setup Vault
                </button>
              )}
              <button className="btn btn-sm btn-outline" onClick={logout}>
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          {!isTruthy(vaultUnlocked) && !hideVaultBanner && (
            <div className="alert alert-warning" style={{ margin: 'var(--space-lg)', marginBottom: 0, justifyContent: 'space-between' }}>
              <div className="flex items-center gap-2">
                <Lock size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Vault is locked.</strong>{' '}
                  {isTruthy(vaultKeyExists)
                    ? 'Unlock your vault to access encrypted data.'
                    : 'Set up your vault key to get started.'}
                </div>
              </div>
              <button className="btn btn-sm btn-warning" onClick={promptVault} style={{ flexShrink: 0 }}>
                {isTruthy(vaultKeyExists) ? 'Unlock' : 'Setup Key'}
              </button>
            </div>
          )}
          {showPasskeyBanner && (
            <div className="alert alert-info" style={{ margin: 'var(--space-lg)', marginBottom: 0, justifyContent: 'space-between' }}>
              <div className="flex items-center gap-2">
                <Fingerprint size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Set up a passkey for faster sign-in?</strong>{' '}
                  Use your fingerprint or face to sign in next time.
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-primary" onClick={handlePasskeySetup} disabled={passkeyBannerLoading}>
                  {passkeyBannerLoading ? 'Setting up...' : 'Set up'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={dismissPasskeyBannerSession} style={{ fontSize: 12 }}>
                  Maybe later
                </button>
                <button className="btn btn-sm btn-outline" onClick={dismissPasskeyBannerPermanent} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Don't show again
                </button>
              </div>
            </div>
          )}
          <PageNotice />
          <Outlet />
        </main>
      </div>
    </HideAmountsContext.Provider>
  );
}
