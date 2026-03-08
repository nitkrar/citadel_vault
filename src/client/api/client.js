import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/src/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT and data token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pv_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Send X-Data-Token header as fallback for mobile / non-cookie clients
  const dataToken = sessionStorage.getItem('pv_data_token');
  if (dataToken) {
    config.headers['X-Data-Token'] = dataToken;
  }
  return config;
});

// On 401, clear auth and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('pv_token');
      sessionStorage.removeItem('pv_data_token');
      sessionStorage.removeItem('pv_data_token_expiry');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
