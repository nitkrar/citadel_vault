import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/src/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 15000, // 15s — prevents iOS PWA from hanging forever on dead requests
});

// Offline check: block mutations when offline
api.interceptors.request.use((config) => {
  if (!navigator.onLine && config.method !== 'get') {
    return Promise.reject(new Error('You are offline. Changes require an internet connection.'));
  }
  return config;
});

// On 401, notify the app so AuthContext can handle navigation via React Router.
// This avoids window.location.href which kills React state and causes full page reloads.
const PUBLIC_PATHS_401 = ['/login', '/register', '/forgot-password', '/verify-email', '/home', '/features', '/help', '/dev-guide'];
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const path = window.location.pathname;
      const url = error.config?.url || '';
      const isAuthCheck = url.includes('action=me') || url.includes('action=registration-status');
      if (!PUBLIC_PATHS_401.includes(path) && !isAuthCheck) {
        window.dispatchEvent(new Event('citadel:auth-expired'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
