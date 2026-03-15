import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/src/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Offline check: block mutations when offline
api.interceptors.request.use((config) => {
  if (!navigator.onLine && config.method !== 'get') {
    return Promise.reject(new Error('You are offline. Changes require an internet connection.'));
  }
  return config;
});

// On 401, redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
