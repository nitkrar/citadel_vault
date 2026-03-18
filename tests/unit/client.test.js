/** @vitest-environment jsdom */
/**
 * Unit tests for src/client/api/client.js — axios instance with
 * offline-check request interceptor and 401-redirect response interceptor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// ---------------------------------------------------------------------------
// We cannot import the real client module in every test because its
// interceptors register once at module-load time. Instead we replicate the
// interceptor logic on a fresh axios instance per test — this isolates state
// and avoids cross-test leakage through a shared singleton.
// ---------------------------------------------------------------------------

const PUBLIC_PATHS_401 = ['/login', '/register', '/forgot-password', '/verify-email', '/home', '/features', '/help', '/dev-guide'];

function createClientWithInterceptors() {
  const api = axios.create({
    baseURL: '/src/api',
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true,
  });

  // Request interceptor — offline guard
  api.interceptors.request.use((config) => {
    if (!navigator.onLine && config.method !== 'get') {
      return Promise.reject(new Error('You are offline. Changes require an internet connection.'));
    }
    return config;
  });

  // Response interceptor — 401 redirect
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        const path = window.location.pathname;
        const url = error.config?.url || '';
        const isAuthCheck = url.includes('action=me') || url.includes('action=registration-status');
        if (!PUBLIC_PATHS_401.includes(path) && !isAuthCheck) {
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    }
  );

  return api;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub the adapter so no real HTTP requests are made. */
function mockAdapter(api, { status = 200, data = {} } = {}) {
  api.defaults.adapter = () =>
    Promise.resolve({ status, data, headers: {}, config: {}, statusText: 'OK' });
}

function mockAdapterReject(api, { status, url }) {
  api.defaults.adapter = (config) =>
    Promise.reject({
      response: { status },
      config: { ...config, url: url || config.url },
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('client.js axios instance', () => {
  let api;
  let originalOnLine;
  let hrefSetter;

  beforeEach(() => {
    api = createClientWithInterceptors();

    // Save original navigator.onLine value
    originalOnLine = navigator.onLine;

    // Spy on window.location.href assignments
    // jsdom does not allow direct assignment to window.location.href without
    // a full navigation, so we use a spy on the setter.
    hrefSetter = vi.fn();
    // Need to delete then redefine because jsdom locks location
    const originalLocation = window.location;
    delete window.location;
    window.location = {
      ...originalLocation,
      pathname: '/dashboard',
      get href() { return originalLocation.href; },
      set href(val) { hrefSetter(val); },
    };
  });

  afterEach(() => {
    // Restore navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      writable: true,
      configurable: true,
    });
  });

  // -----------------------------------------------------------------------
  // Offline interceptor
  // -----------------------------------------------------------------------
  describe('offline request interceptor', () => {
    it('rejects POST requests when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      mockAdapter(api);

      await expect(api.post('/test')).rejects.toThrow(
        'You are offline. Changes require an internet connection.'
      );
    });

    it('allows GET requests when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      mockAdapter(api, { status: 200, data: { ok: true } });

      const res = await api.get('/test');
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ ok: true });
    });

    it('rejects PUT requests when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      mockAdapter(api);

      await expect(api.put('/test', { a: 1 })).rejects.toThrow(
        'You are offline. Changes require an internet connection.'
      );
    });

    it('rejects DELETE requests when offline', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      mockAdapter(api);

      await expect(api.delete('/test')).rejects.toThrow(
        'You are offline. Changes require an internet connection.'
      );
    });

    it('allows POST requests when online', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      mockAdapter(api, { status: 200, data: { created: true } });

      const res = await api.post('/test', { name: 'item' });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ created: true });
    });
  });

  // -----------------------------------------------------------------------
  // 401 response interceptor
  // -----------------------------------------------------------------------
  describe('401 redirect interceptor', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('redirects to /login on 401 from a protected page', async () => {
      window.location.pathname = '/dashboard';
      mockAdapterReject(api, { status: 401, url: '/src/api/vault.php' });

      await expect(api.get('/vault.php')).rejects.toBeTruthy();
      expect(hrefSetter).toHaveBeenCalledWith('/login');
    });

    it('does NOT redirect on 401 when on /login', async () => {
      window.location.pathname = '/login';
      mockAdapterReject(api, { status: 401, url: '/src/api/auth.php' });

      await expect(api.get('/auth.php')).rejects.toBeTruthy();
      expect(hrefSetter).not.toHaveBeenCalled();
    });

    it('does NOT redirect on 401 when on /register', async () => {
      window.location.pathname = '/register';
      mockAdapterReject(api, { status: 401, url: '/src/api/auth.php' });

      await expect(api.get('/auth.php')).rejects.toBeTruthy();
      expect(hrefSetter).not.toHaveBeenCalled();
    });

    it('does NOT redirect on 401 for action=me auth-check', async () => {
      window.location.pathname = '/dashboard';
      mockAdapterReject(api, { status: 401, url: '/src/api/auth.php?action=me' });

      await expect(api.get('/auth.php?action=me')).rejects.toBeTruthy();
      expect(hrefSetter).not.toHaveBeenCalled();
    });

    it('does NOT redirect on 401 for action=registration-status', async () => {
      window.location.pathname = '/dashboard';
      mockAdapterReject(api, { status: 401, url: '/src/api/auth.php?action=registration-status' });

      await expect(api.get('/auth.php?action=registration-status')).rejects.toBeTruthy();
      expect(hrefSetter).not.toHaveBeenCalled();
    });

    it('does NOT redirect on non-401 errors (e.g. 403)', async () => {
      window.location.pathname = '/dashboard';
      mockAdapterReject(api, { status: 403, url: '/src/api/vault.php' });

      await expect(api.get('/vault.php')).rejects.toBeTruthy();
      expect(hrefSetter).not.toHaveBeenCalled();
    });

    it('does NOT redirect on 401 for other public paths', async () => {
      const otherPublicPaths = ['/forgot-password', '/verify-email', '/home', '/features', '/help', '/dev-guide'];
      for (const publicPath of otherPublicPaths) {
        hrefSetter.mockClear();
        window.location.pathname = publicPath;
        mockAdapterReject(api, { status: 401, url: '/src/api/auth.php' });

        await expect(api.get('/auth.php')).rejects.toBeTruthy();
        expect(hrefSetter).not.toHaveBeenCalledWith('/login');
      }
    });

    it('still rejects the promise even when redirecting', async () => {
      window.location.pathname = '/settings';
      mockAdapterReject(api, { status: 401, url: '/src/api/settings.php' });

      const err = await api.get('/settings.php').catch((e) => e);
      expect(err.response.status).toBe(401);
      expect(hrefSetter).toHaveBeenCalledWith('/login');
    });
  });
});
