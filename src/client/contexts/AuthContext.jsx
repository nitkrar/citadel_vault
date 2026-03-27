import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';
import { authenticateWithPasskey } from '../components/WebAuthnLogin';
import * as vaultSession from '../lib/vaultSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustChangeVaultKey, setMustChangeVaultKey] = useState(false);
  const [adminActionMessage, setAdminActionMessage] = useState(null);
  const [preferences, setPreferences] = useState({});

  // On mount, check if we have a valid auth cookie by calling /me
  useEffect(() => {
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
        // No valid cookie or expired — user is not logged in
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth.php?action=login', { username, password });
    const { user: newUser } = res.data.data;
    setUser(newUser);
    setMustChangePassword(!!newUser?.must_change_password);
    setMustChangeVaultKey(!!newUser?.must_change_vault_key);
    setAdminActionMessage(newUser?.admin_action_message || null);
    return res.data.data;
  };

  const loginWithToken = (data) => {
    const { user: newUser } = data;
    setUser(newUser);
    setMustChangePassword(!!newUser?.must_change_password);
    setMustChangeVaultKey(!!newUser?.must_change_vault_key);
    setAdminActionMessage(newUser?.admin_action_message || null);
  };

  const loginWithPasskey = async () => {
    const result = await authenticateWithPasskey(api);
    loginWithToken(result);
    return result;
  };

  const register = async (username, email, password) => {
    const res = await api.post('/auth.php?action=register', {
      username,
      email,
      password,
    });
    const { user: newUser } = res.data.data;
    setUser(newUser);
    return res.data.data;
  };

  const logout = () => {
    // 1. Full vault teardown (crypto, worker, storage, IndexedDB)
    vaultSession.destroy();

    // 2. Clear auth cookie via server
    api.post('/auth.php?action=logout').catch(() => {});

    // 3. Reset all React state
    setUser(null);
    setMustChangePassword(false);
    setMustChangeVaultKey(false);
    setAdminActionMessage(null);
    setPreferences({});
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
    loading,
    login,
    loginWithToken,
    loginWithPasskey,
    logout,
    register,
    isAuthenticated: !!user,
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
