import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/src/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request (no more X-Data-Token — encryption is client-side)
api.interceptors.request.use((config) => {
  // Offline check: block mutations when offline
  if (!navigator.onLine && config.method !== 'get') {
    return Promise.reject(new Error('You are offline. Changes require an internet connection.'));
  }

  const token = localStorage.getItem('pv_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear auth and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('pv_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
