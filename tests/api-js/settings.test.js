import { describe, it, expect } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

describe('Settings API — /settings.php', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/settings.php');
      expect(resp.status).toBe(401);
    });

    it('PUT returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/settings.php', {
        json: { ticker_price_ttl: '3600' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET — enriched settings response
  // -----------------------------------------------------------------------
  describe('GET', () => {
    it('returns enriched settings with metadata', async () => {
      const resp = await api.get('/settings.php');
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(typeof data).toBe('object');
      expect(data).not.toBeNull();

      // Check a known setting has enriched fields
      expect(data).toHaveProperty('self_registration');
      const setting = data.self_registration;
      expect(setting).toHaveProperty('value');
      expect(setting).toHaveProperty('type');
      expect(setting).toHaveProperty('category');
      expect(setting).toHaveProperty('description');
    });

    it('gatekeeper settings have type "gatekeeper"', async () => {
      const resp = await api.get('/settings.php');
      const data = await api.data(resp);

      expect(data.self_registration.type).toBe('gatekeeper');
      expect(data.worker_mode.type).toBe('gatekeeper');
    });

    it('config settings have type "config"', async () => {
      const resp = await api.get('/settings.php');
      const data = await api.data(resp);

      expect(data.ticker_price_ttl.type).toBe('config');
      expect(data.worker_threshold.type).toBe('config');
    });

    it('options is an array when present, null otherwise', async () => {
      const resp = await api.get('/settings.php');
      const data = await api.data(resp);

      // With options
      expect(Array.isArray(data.ticker_price_ttl.options)).toBe(true);
      expect(data.ticker_price_ttl.options.length).toBeGreaterThan(0);

      // Without options
      expect(data.worker_threshold.options).toBeNull();
    });

    it('every setting has a non-empty category', async () => {
      const resp = await api.get('/settings.php');
      const data = await api.data(resp);

      for (const [key, setting] of Object.entries(data)) {
        expect(setting.category, `${key} has empty category`).toBeTruthy();
      }
    });

    it('every setting has a description', async () => {
      const resp = await api.get('/settings.php');
      const data = await api.data(resp);

      for (const [key, setting] of Object.entries(data)) {
        expect(setting.description, `${key} has empty description`).toBeTruthy();
      }
    });
  });

  // -----------------------------------------------------------------------
  // PUT — update settings (admin-only)
  // -----------------------------------------------------------------------
  describe('PUT', () => {
    it('updates an existing setting', async () => {
      // Save original value
      const getResp = await api.get('/settings.php');
      const original = (await api.data(getResp)).ticker_price_ttl.value;

      try {
        const resp = await api.put('/settings.php', {
          json: { ticker_price_ttl: '3600' },
        });
        expect(resp.status).toBe(200);

        // Verify the change persisted
        const verifyResp = await api.get('/settings.php');
        const data = await api.data(verifyResp);
        expect(data.ticker_price_ttl.value).toBe('3600');
      } finally {
        // Restore original value
        await api.put('/settings.php', {
          json: { ticker_price_ttl: original },
        });
      }
    });

    it('rejects unknown key with 400', async () => {
      const resp = await api.put('/settings.php', {
        json: { nonexistent_key: 'value' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for empty body', async () => {
      const resp = await api.put('/settings.php', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });
  });
});
