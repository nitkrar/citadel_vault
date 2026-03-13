import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';
import { authenticateWithPasskey } from '../components/WebAuthnLogin';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('pv_token'));
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustChangeVaultKey, setMustChangeVaultKey] = useState(false);
  const [adminActionMessage, setAdminActionMessage] = useState(null);
  const [preferences, setPreferences] = useState({});

  // On mount, if we have a stored token, validate it and fetch user info
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    Promise.all([
      api.get('/auth.php?action=me'),
      api.get('/preferences.php'),
    ])
      .then(([meRes, prefsRes]) => {
        const u = meRes.data.data;
        setUser(u);
        setMustChangePassword(!!u?.must_change_password);
        setMustChangeVaultKey(!!u?.must_change_vault_key);
        setAdminActionMessage(u?.admin_action_message || null);
        setPreferences(prefsRes.data?.data || prefsRes.data || {});
      })
      .catch(() => {
        // Token is invalid or expired — clean up
        localStorage.removeItem('pv_token');
        setToken(null);
        setUser(null);
        setMustChangePassword(false);
        setMustChangeVaultKey(false);
        setAdminActionMessage(null);
        setPreferences({});
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const login = async (username, password) => {
    // Clear any stale vault session from previous login
    // No server-side data tokens in client-side encryption mode

    const res = await api.post('/auth.php?action=login', { username, password });
    const { token: newToken, user: newUser } = res.data.data;
    localStorage.setItem('pv_token', newToken);
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(!!newUser?.must_change_password);
    setMustChangeVaultKey(!!newUser?.must_change_vault_key);
    setAdminActionMessage(newUser?.admin_action_message || null);
    return res.data.data;
  };

  const loginWithPasskey = async () => {
    // No server-side data tokens in client-side encryption mode
    const result = await authenticateWithPasskey(api);
    const { token: newToken, user: newUser } = result;
    localStorage.setItem('pv_token', newToken);
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(!!newUser?.must_change_password);
    setMustChangeVaultKey(!!newUser?.must_change_vault_key);
    setAdminActionMessage(newUser?.admin_action_message || null);
    return result;
  };

  const register = async (username, email, password) => {
    const res = await api.post('/auth.php?action=register', {
      username,
      email,
      password,
    });
    const { token: newToken, user: newUser } = res.data.data;
    localStorage.setItem('pv_token', newToken);
    setToken(newToken);
    setUser(newUser);
    return res.data.data;
  };

  const logout = () => {
    localStorage.removeItem('pv_token');
    // No server-side data tokens in client-side encryption mode
    // Clear all form drafts
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('pv_draft_')) localStorage.removeItem(key);
    });
    // Clear HttpOnly cookie via server
    api.post('/encryption.php?action=lock').catch(() => {});
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setMustChangeVaultKey(false);
    setAdminActionMessage(null);
  };

  const clearMustChangePassword = () => {
    setMustChangePassword(false);
  };

  const clearMustChangeVaultKey = () => {
    setMustChangeVaultKey(false);
  };

  const clearAdminActionMessage = () => {
    setAdminActionMessage(null);
  };

  const refreshUser = async () => {
    try {
      const res = await api.get('/auth.php?action=me');
      const u = res.data.data;
      setUser(u);
    } catch {}
  };

  const refreshPreferences = async () => {
    try {
      const res = await api.get('/preferences.php');
      setPreferences(res.data?.data || res.data || {});
    } catch {}
  };

  const value = {
    user,
    token,
    loading,
    login,
    loginWithPasskey,
    logout,
    register,
    isSiteAdmin: user?.role === 'admin',
    isAdmin: user?.role === 'admin',
    mustChangePassword,
    clearMustChangePassword,
    mustChangeVaultKey,
    clearMustChangeVaultKey,
    adminActionMessage,
    clearAdminActionMessage,
    refreshUser,
    preferences,
    refreshPreferences,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
