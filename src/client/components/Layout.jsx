import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { isTruthy } from '../lib/checks';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEncryption } from '../contexts/EncryptionContext';
import PageNotice from './PageNotice';
import SaveToast from './SaveToast';
import ShortcutOverlay from './ShortcutOverlay';
import SyncToast from './SyncToast';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { isWebAuthnSupported, registerPasskey } from './WebAuthnLogin';
import api from '../api/client';
import useLayoutMode from '../hooks/useLayoutMode';
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
  Users,
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
  Keyboard,
  ExternalLink,
  Settings,
  Menu,
  X,
  RefreshCw,
  Plus,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Send,
  Smartphone,
  Monitor,
  DollarSign,
} from 'lucide-react';
import { PBKDF2_ITERATIONS_RECOMMENDED, getKdfIterations } from '../lib/crypto';

// --- Hide Amounts Context ---
const HideAmountsContext = createContext();

export function useHideAmounts() {
  return useContext(HideAmountsContext);
}

const ROUTE_META = {
  '/': { title: 'Home', isTab: true },
  '/vault': { title: 'Vault', isTab: true },
  '/portfolio': { title: 'Portfolio', isTab: true },
  '/sharing': { title: 'Sharing', isTab: true },
  '/security': { title: 'Security', isTab: false },
  '/profile': { title: 'Profile', isTab: false },
  '/import-export': { title: 'Import / Export', isTab: false },
  '/templates': { title: 'Templates', isTab: false },
  '/admin/users': { title: 'Users', isTab: false },
  '/admin/reference': { title: 'Reference Data', isTab: false },
  '/admin/settings': { title: 'System Settings', isTab: false },
};

// ── Mobile Native Header ──
function MobileHeader({ routeMeta, navigate, location, isUnlocked, vaultKeyExists, lockVault, promptVault, toggleHideAmounts, hideAmounts }) {
  const meta = routeMeta[location.pathname] || { title: 'Citadel', isTab: true };

  return (
    <header className="mobile-native-header">
      <div className="mobile-native-header-left">
        <button className="mobile-native-header-btn" onClick={() => navigate(-1)} aria-label="Go back">
          <ChevronLeft size={22} />
        </button>
      </div>
      <span className="mobile-native-header-title">{meta.title}</span>
      <div className="mobile-native-header-right">
        {location.pathname === '/vault' && (
          <button className="mobile-native-header-btn" onClick={() => window.dispatchEvent(new CustomEvent('vault:add'))} aria-label="Add entry">
            <Plus size={22} />
          </button>
        )}
        {location.pathname === '/sharing' && (
          <button className="mobile-native-header-btn" onClick={() => window.dispatchEvent(new CustomEvent('sharing:add'))} aria-label="Share entry">
            <Send size={20} />
          </button>
        )}
        {['/vault', '/portfolio'].includes(location.pathname) && (
          <button className="mobile-native-header-btn" onClick={() => window.dispatchEvent(new CustomEvent('vault:currency-toggle'))} aria-label="Change currency">
            <DollarSign size={20} />
          </button>
        )}
        {['/', '/vault', '/portfolio', '/sharing'].includes(location.pathname) && (
          <>
            <button className={`mobile-native-header-btn hide-btn${hideAmounts ? ' active' : ''}`} onClick={toggleHideAmounts} aria-label={hideAmounts ? 'Show amounts' : 'Hide amounts'}>
              {hideAmounts ? <Eye size={20} /> : <EyeOff size={20} />}
            </button>
            {isUnlocked ? (
              <button className="mobile-native-header-btn lock-btn" onClick={lockVault} aria-label="Lock vault">
                <Lock size={20} />
              </button>
            ) : isTruthy(vaultKeyExists) ? (
              <button className="mobile-native-header-btn lock-btn" onClick={promptVault} aria-label="Unlock vault">
                <KeyRound size={20} />
              </button>
            ) : null}
          </>
        )}
        <button className="mobile-native-header-btn" title="Refresh app"
          onClick={async () => {
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map(r => r.unregister()));
            }
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            window.location.reload();
          }}>
          <RefreshCw size={20} />
        </button>
      </div>
    </header>
  );
}

function MobileTabBar({ onMoreClick }) {
  const tabs = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/vault', label: 'Vault', icon: KeyRound },
    { path: '/portfolio', label: 'Portfolio', icon: PieChart },
    { path: '/sharing', label: 'Sharing', icon: Share2 },
  ];

  return (
    <nav className="mobile-tab-bar">
      {tabs.map(({ path, label, icon: Icon }) => (
        <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `mobile-tab-item${isActive ? ' active' : ''}`}>
          <Icon size={24} />
          {label}
        </NavLink>
      ))}
      <button className="mobile-tab-item" onClick={onMoreClick}>
        <MoreHorizontal size={24} />
        More
      </button>
    </nav>
  );
}

function MoreSheet({ open, onClose, navigate, isSiteAdmin, darkMode, toggleDarkMode, hideAmounts, toggleHideAmounts, isUnlocked, vaultKeyExists, lockVault, promptVault, logout, preference, setPreference }) {
  // Swipe-down to dismiss
  const [touchStartY, setTouchStartY] = useState(null);

  const handleNav = (path) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      <div className={`more-sheet-overlay${open ? ' visible' : ''}`} onClick={onClose} />
      <div
        className={`more-sheet${open ? ' visible' : ''}`}
        onTouchStart={(e) => setTouchStartY(e.touches[0].clientY)}
        onTouchMove={(e) => {
          if (touchStartY !== null && e.touches[0].clientY - touchStartY > 60) {
            onClose();
            setTouchStartY(null);
          }
        }}
        onTouchEnd={() => setTouchStartY(null)}
      >
        <div className="more-sheet-handle" />
        <div className="more-sheet-content">
          {/* Navigation */}
          <div className="more-sheet-group">
            <button className="more-sheet-item" onClick={() => handleNav('/security')}>
              <ShieldCheck size={20} className="more-icon" />
              <span>Security</span>
              <ChevronRight size={16} className="more-chevron" />
            </button>
            <button className="more-sheet-item" onClick={() => handleNav('/profile')}>
              <User size={20} className="more-icon" />
              <span>Profile</span>
              <ChevronRight size={16} className="more-chevron" />
            </button>
            <button className="more-sheet-item" onClick={() => handleNav('/import-export')}>
              <FileDown size={20} className="more-icon" />
              <span>Import / Export</span>
              <ChevronRight size={16} className="more-chevron" />
            </button>
            <button className="more-sheet-item" onClick={() => handleNav('/templates')}>
              <FileText size={20} className="more-icon" />
              <span>Templates</span>
              <ChevronRight size={16} className="more-chevron" />
            </button>
          </div>

          {/* Admin — only for site admins */}
          {isSiteAdmin && (
            <div className="more-sheet-group">
              <button className="more-sheet-item" onClick={() => handleNav('/admin/users')}>
                <Users size={20} className="more-icon" />
                <span>Users</span>
                <ChevronRight size={16} className="more-chevron" />
              </button>
              <button className="more-sheet-item" onClick={() => handleNav('/admin/reference')}>
                <Database size={20} className="more-icon" />
                <span>Reference Data</span>
                <ChevronRight size={16} className="more-chevron" />
              </button>
              <button className="more-sheet-item" onClick={() => handleNav('/admin/settings')}>
                <Settings size={20} className="more-icon" />
                <span>System Settings</span>
                <ChevronRight size={16} className="more-chevron" />
              </button>
            </div>
          )}

          {/* Toggles */}
          <div className="more-sheet-group">
            <button className="more-sheet-item" onClick={toggleHideAmounts}>
              {hideAmounts ? <Eye size={20} className="more-icon" /> : <EyeOff size={20} className="more-icon" />}
              <span>{hideAmounts ? 'Show Amounts' : 'Hide Amounts'}</span>
            </button>
            <button className="more-sheet-item" onClick={toggleDarkMode}>
              {darkMode ? <Sun size={20} className="more-icon" /> : <Moon size={20} className="more-icon" />}
              <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
            <button className="more-sheet-item" onClick={() => { isUnlocked ? lockVault() : promptVault(); onClose(); }}>
              <Lock size={20} className="more-icon" />
              <span>{isUnlocked ? 'Lock Vault' : isTruthy(vaultKeyExists) ? 'Unlock Vault' : 'Setup Vault'}</span>
            </button>
          </div>

          {/* Layout switch */}
          <div className="more-sheet-group">
            <button className="more-sheet-item" onClick={() => { setPreference('classic'); onClose(); }}>
              <Monitor size={20} className="more-icon" />
              <span>Switch to Classic Layout</span>
            </button>
          </div>

          {/* Sign out */}
          <div className="more-sheet-group">
            <button className="more-sheet-item danger" onClick={logout}>
              <LogOut size={20} className="more-icon" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Layout() {
  const { user, logout, isSiteAdmin, preferences, refreshPreferences } = useAuth();
  const { isUnlocked, isLoading, vaultKeyExists, lock: lockVault, promptVault } = useEncryption();

  const [hideAmounts, setHideAmounts] = useState(() => {
    return localStorage.getItem('pv_hide_amounts') === 'true';
  });

  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('pv_dark_mode');
    if (stored !== null) return stored === 'true';
    return document.documentElement.classList.contains('dark');
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isMobile, preference, setPreference } = useLayoutMode();
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  const [pendingShareCount, setPendingShareCount] = useState(0);
  const [showPasskeyBanner, setShowPasskeyBanner] = useState(false);
  const [passkeyBannerLoading, setPasskeyBannerLoading] = useState(false);
  const [kdfBannerDismissed, setKdfBannerDismissed] = useState(false);
  const [marketRefreshToast, setMarketRefreshToast] = useState(null);
  const marketRefreshDone = useRef(false);

  // Auto-refresh market data (forex + tickers) on login
  useEffect(() => {
    if (!user || marketRefreshDone.current) return;
    marketRefreshDone.current = true;
    setMarketRefreshToast({ message: 'Refreshing market data…', type: 'info', key: Date.now() });
    api.post('/prices.php?action=refresh', { type: 'all' })
      .then(res => {
        const d = res.data?.data || res.data;
        const parts = [];
        if (d?.forex?.updated > 0) parts.push(`${d.forex.updated} rates`);
        if (d?.ticker?.updated > 0) parts.push(`${d.ticker.updated} prices`);
        setMarketRefreshToast(parts.length > 0
          ? { message: `Updated ${parts.join(', ')}`, type: 'success', key: Date.now() }
          : { message: 'Market data up to date', type: 'success', key: Date.now() });
      })
      .catch(() => {
        setMarketRefreshToast({ message: 'Market refresh failed', type: 'error', key: Date.now() });
      });
  }, [user]);

  // Show KDF banner only when preference was never explicitly set by the user
  const showKdfBanner = isUnlocked && !kdfBannerDismissed
    && preferences && preferences.kdf_iterations === undefined;

  const dismissKdfBannerSession = () => setKdfBannerDismissed(true);

  const dismissKdfBannerPermanent = async () => {
    setKdfBannerDismissed(true);
    try {
      // Save current default as explicit preference — signals "user made a choice"
      await api.put('/preferences.php', { kdf_iterations: String(getKdfIterations(preferences)) });
      refreshPreferences();
    } catch (_) {}
  };

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

  // Body scroll lock when mobile sidebar is open
  useEffect(() => {
    document.body.classList.toggle('sidebar-open', sidebarOpen);
    return () => document.body.classList.remove('sidebar-open');
  }, [sidebarOpen]);

  // Load pending share count
  useEffect(() => {
    let cancelled = false;
    const loadPendingShares = async () => {
      try {
        const res = await (await import('../api/client')).default.get('/sharing.php?action=shared-with-me');
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

  // ── Keyboard shortcuts ──────────────────────────────────────────
  const [showShortcuts, setShowShortcuts] = useState(false);
  const navigate = useNavigate();

  const shortcutCallbacks = useMemo(() => ({
    onLock: () => { if (isUnlocked) lockVault(); },
    onUnlock: () => { if (!isUnlocked && isTruthy(vaultKeyExists)) promptVault(); },
    onSearch: () => { if (isUnlocked) navigate('/vault'); },
    onToggleHelp: () => setShowShortcuts(prev => !prev),
  }), [isUnlocked, vaultKeyExists, lockVault, promptVault, navigate]);

  const { isDesktop, settings: shortcutSettings } = useKeyboardShortcuts(shortcutCallbacks);

  const location = useLocation();

  // Close mobile sidebar and more sheet on navigation
  useEffect(() => {
    setSidebarOpen(false);
    setMoreSheetOpen(false);
  }, [location.pathname]);

  const appName = import.meta.env.VITE_APP_NAME || 'Personal Vault';
  // Pages that don't need the vault locked banner
  const hideVaultBanner = ['/profile', '/admin', '/settings'].includes(location.pathname);
  const appTagline = import.meta.env.VITE_APP_TAGLINE || 'Secure Personal Hub';

  return (
    <HideAmountsContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      <div className={`app-layout${isMobile ? ' mobile-layout-active' : ''}`}>
        {isMobile ? (
          <>
            <MobileHeader
              routeMeta={ROUTE_META}
              navigate={navigate}
              location={location}
              isUnlocked={isUnlocked}
              vaultKeyExists={vaultKeyExists}
              lockVault={lockVault}
              promptVault={promptVault}
              toggleHideAmounts={toggleHideAmounts}
              hideAmounts={hideAmounts}
            />
            <MobileTabBar onMoreClick={() => setMoreSheetOpen(true)} />
            <MoreSheet
              open={moreSheetOpen}
              onClose={() => setMoreSheetOpen(false)}
              navigate={navigate}
              isSiteAdmin={isSiteAdmin}
              darkMode={darkMode}
              toggleDarkMode={toggleDarkMode}
              hideAmounts={hideAmounts}
              toggleHideAmounts={toggleHideAmounts}
              isUnlocked={isUnlocked}
              vaultKeyExists={vaultKeyExists}
              lockVault={lockVault}
              promptVault={promptVault}
              logout={logout}
              preference={preference}
              setPreference={setPreference}
            />
          </>
        ) : (
          <>
            {/* Mobile header — visible ≤768px only */}
            <header className="mobile-header">
              <button className="icon-btn" onClick={() => setSidebarOpen(prev => !prev)} aria-label="Toggle menu">
                {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
              <span className="mobile-header-title">
                <Shield size={20} />
                {appName}
              </span>
              <div className="mobile-header-actions">
                <button className="icon-btn" title="Refresh app"
                  onClick={async () => {
                    if ('serviceWorker' in navigator) {
                      const regs = await navigator.serviceWorker.getRegistrations();
                      await Promise.all(regs.map(r => r.unregister()));
                    }
                    if ('caches' in window) {
                      const keys = await caches.keys();
                      await Promise.all(keys.map(k => caches.delete(k)));
                    }
                    window.location.reload();
                  }}>
                  <RefreshCw size={18} />
                </button>
                <button className="icon-btn" onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'}>
                  {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                {isUnlocked ? (
                  <button className="icon-btn" onClick={lockVault} title="Lock vault">
                    <Lock size={18} />
                  </button>
                ) : isTruthy(vaultKeyExists) ? (
                  <button className="icon-btn" onClick={promptVault} title="Unlock vault">
                    <KeyRound size={18} />
                  </button>
                ) : null}
                <button className="icon-btn" onClick={toggleHideAmounts} title={hideAmounts ? 'Show amounts' : 'Hide amounts'}>
                  {hideAmounts ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </header>

            {/* Backdrop — visible when mobile sidebar is open */}
            <div
              className={`sidebar-backdrop${sidebarOpen ? ' visible' : ''}`}
              onClick={() => setSidebarOpen(false)}
            />

            {/* Sidebar */}
            <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-header">
            <div className="sidebar-logo">
              <Shield size={28} />
              <div>
                <h1>{appName}</h1>
                <span className="sidebar-subtitle">{appTagline}</span>
              </div>
            </div>
            <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
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
              <NavLink to="/vault" className={({ isActive }) => (isActive ? 'active' : '')}>
                <KeyRound size={18} /> Vault
              </NavLink>
              <NavLink to="/portfolio" className={({ isActive }) => (isActive ? 'active' : '')}>
                <PieChart size={18} /> Portfolio
              </NavLink>
            </div>

            {/* Tools */}
            <div className="nav-section">
              <span className="nav-section-label">Tools</span>
              <NavLink to="/sharing" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Share2 size={18} /> Sharing
              </NavLink>
              <NavLink to="/import-export" className={({ isActive }) => (isActive ? 'active' : '')}>
                <FileDown size={18} /> Import / Export
              </NavLink>
              <NavLink to="/templates" className={({ isActive }) => (isActive ? 'active' : '')}>
                <FileText size={18} /> Templates
              </NavLink>
            </div>

            {/* Account */}
            <div className="nav-section">
              <span className="nav-section-label">Account</span>
              <NavLink to="/security" className={({ isActive }) => (isActive ? 'active' : '')}>
                <ShieldCheck size={18} /> Security
              </NavLink>
              <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
                <User size={18} /> Profile
              </NavLink>
            </div>

            {/* Admin — visible to site admins only */}
            {isSiteAdmin && (
            <div className="nav-section">
              <span className="nav-section-label">Admin</span>
              <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Users size={18} /> Users
              </NavLink>
              <NavLink to="/admin/reference" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Database size={18} /> Reference Data
              </NavLink>
              <NavLink to="/admin/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
                <Settings size={18} /> System Settings
              </NavLink>
            </div>
            )}

            {/* Help */}
            <div className="nav-section">
              <span className="nav-section-label">Help</span>
              <a href="/help" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <HelpCircle size={18} /> Help &amp; FAQ
                <ExternalLink size={12} style={{ marginLeft: 'auto', opacity: 0.5 }} />
              </a>
              {isDesktop && (
                <button onClick={() => setShowShortcuts(true)}>
                  <Keyboard size={18} /> Shortcuts
                  <kbd style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5, background: 'rgba(255,255,255,0.1)', borderRadius: 3, padding: '1px 5px' }}>Ctrl+/</kbd>
                </button>
              )}
            </div>
          </nav>

          <div className="sidebar-footer">
            {(import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_BUILD_ID) && (
              <div className="flex items-center gap-2" style={{ color: 'var(--sidebar-text-muted)', marginBottom: 6, fontSize: 11 }}>
                <span>v{import.meta.env.VITE_APP_VERSION || '?'} build {import.meta.env.VITE_BUILD_ID || '?'}</span>
                <button
                  title="Force refresh"
                  onClick={async () => {
                    if ('serviceWorker' in navigator) {
                      const regs = await navigator.serviceWorker.getRegistrations();
                      await Promise.all(regs.map(r => r.unregister()));
                    }
                    if ('caches' in window) {
                      const keys = await caches.keys();
                      await Promise.all(keys.map(k => caches.delete(k)));
                    }
                    window.location.reload();
                  }}
                  style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}
                >
                  <RefreshCw size={11} />
                </button>
              </div>
            )}
            <div className="sidebar-user-info">
              <span>Signed in as <strong>{user?.username}</strong></span>
              {user?.role === 'admin' && <span className="badge badge-admin">Admin</span>}
            </div>
            <div className="sidebar-footer-actions">
              {isUnlocked ? (
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
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setPreference('mobile')}
              style={{ fontSize: 11, padding: '3px 8px', marginTop: 4, opacity: 0.7, width: '100%' }}
            >
              <Smartphone size={12} /> Switch to Mobile Layout
            </button>
          </div>
        </aside>
          </>
        )}

        {/* Main Content */}
        <main className="main-content">
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
              <div className="spinner" />
            </div>
          )}
          {!isLoading && !isUnlocked && !hideVaultBanner && (
            <div className="alert alert-warning" style={{ margin: 'var(--space-md)', marginBottom: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div className="flex items-center gap-2" style={{ flex: '1 1 auto', minWidth: 0 }}>
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
          {!isLoading && showPasskeyBanner && (
            <div className="alert alert-info" style={{ margin: 'var(--space-md)', marginBottom: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div className="flex items-center gap-2" style={{ flex: '1 1 auto', minWidth: 0 }}>
                <Fingerprint size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Set up a passkey for faster sign-in?</strong>{' '}
                  Use your fingerprint or face to sign in next time.
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ flexShrink: 0, flexWrap: 'wrap', gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={handlePasskeySetup} disabled={passkeyBannerLoading}>
                  {passkeyBannerLoading ? 'Setting up...' : 'Set up'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={dismissPasskeyBannerSession} style={{ fontSize: 12 }}>
                  Later
                </button>
                <button className="btn btn-sm btn-outline" onClick={dismissPasskeyBannerPermanent} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Don't show
                </button>
              </div>
            </div>
          )}
          {showKdfBanner && (
            <div className="alert alert-info" style={{ margin: 'var(--space-md)', marginBottom: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div className="flex items-center gap-2" style={{ flex: '1 1 auto', minWidth: 0 }}>
                <Shield size={18} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Strengthen your vault encryption?</strong>{' '}
                  {`Your encryption uses 100K iterations. We recommend ${PBKDF2_ITERATIONS_RECOMMENDED / 1000}K for stronger protection against brute-force attacks.`}
                </div>
              </div>
              <div className="flex items-center gap-2" style={{ flexShrink: 0, flexWrap: 'wrap', gap: 6 }}>
                <button className="btn btn-sm btn-primary" onClick={() => { setKdfBannerDismissed(true); navigate('/security'); }}>
                  Go to Settings
                </button>
                <button className="btn btn-sm btn-outline" onClick={dismissKdfBannerSession} style={{ fontSize: 12 }}>
                  Later
                </button>
                <button className="btn btn-sm btn-outline" onClick={dismissKdfBannerPermanent} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Don't show again
                </button>
              </div>
            </div>
          )}
          {!isLoading && <PageNotice />}
          {!isLoading && <Outlet />}
        </main>

        {showShortcuts && (
          <ShortcutOverlay onClose={() => setShowShortcuts(false)} settings={shortcutSettings} />
        )}
        <SyncToast />
        {marketRefreshToast && (
          <SaveToast key={marketRefreshToast.key} message={marketRefreshToast.message} type={marketRefreshToast.type} onDismiss={() => setMarketRefreshToast(null)} />
        )}
      </div>
    </HideAmountsContext.Provider>
  );
}
