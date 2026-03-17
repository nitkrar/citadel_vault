import { describe, it, expect } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

describe('Preferences API — /preferences.php', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/preferences.php');
      expect(resp.status).toBe(401);
    });

    it('PUT returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/preferences.php', {
        json: { display_currency: 'USD' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET — retrieve all preferences
  // -----------------------------------------------------------------------
  describe('GET', () => {
    it('returns preferences as key-value object', async () => {
      const resp = await api.get('/preferences.php');
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(typeof data).toBe('object');
      expect(data).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // PUT — upsert preferences
  // -----------------------------------------------------------------------
  describe('PUT', () => {
    it('updates a valid preference key', async () => {
      const resp = await api.put('/preferences.php', {
        json: { display_currency: 'USD' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.message).toBe('Preferences updated.');

      // Verify the change persisted
      const getResp = await api.get('/preferences.php');
      const prefs = await api.data(getResp);
      expect(prefs.display_currency).toBe('USD');
    });

    it('updates multiple preferences at once', async () => {
      const resp = await api.put('/preferences.php', {
        json: {
          display_currency: 'GBP',
          default_vault_tab: 'all',
        },
      });
      expect(resp.status).toBe(200);

      // Verify both were saved
      const getResp = await api.get('/preferences.php');
      const prefs = await api.data(getResp);
      expect(prefs.display_currency).toBe('GBP');
      expect(prefs.default_vault_tab).toBe('all');
    });

    it('silently ignores unknown preference keys', async () => {
      const resp = await api.put('/preferences.php', {
        json: {
          unknown_key_xyz: 'value',
          display_currency: 'INR',
        },
      });
      expect(resp.status).toBe(200);

      // The known key should be saved
      const getResp = await api.get('/preferences.php');
      const prefs = await api.data(getResp);
      expect(prefs.display_currency).toBe('INR');
      // Unknown key should not appear
      expect(prefs).not.toHaveProperty('unknown_key_xyz');
    });

    it('returns 400 for empty body', async () => {
      const resp = await api.put('/preferences.php', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('accepts vault_key_type preference', async () => {
      const resp = await api.put('/preferences.php', {
        json: { vault_key_type: 'password' },
      });
      expect(resp.status).toBe(200);

      const getResp = await api.get('/preferences.php');
      const prefs = await api.data(getResp);
      expect(prefs.vault_key_type).toBe('password');
    });

    it('accepts auto_lock_mode preference', async () => {
      const resp = await api.put('/preferences.php', {
        json: { auto_lock_mode: 'idle' },
      });
      expect(resp.status).toBe(200);

      const getResp = await api.get('/preferences.php');
      const prefs = await api.data(getResp);
      expect(prefs.auto_lock_mode).toBe('idle');
    });

    it('accepts sync_interval preference', async () => {
      const resp = await api.put('/preferences.php', {
        json: { sync_interval: '300' },
      });
      expect(resp.status).toBe(200);

      const getResp = await api.get('/preferences.php');
      const prefs = await api.data(getResp);
      expect(prefs.sync_interval).toBe('300');
    });
  });

  // -----------------------------------------------------------------------
  // Invalid method
  // -----------------------------------------------------------------------
  describe('invalid method', () => {
    it('POST returns 400', async () => {
      const resp = await api.post('/preferences.php', {
        json: { display_currency: 'USD' },
      });
      expect(resp.status).toBe(400);
    });

    it('DELETE returns 400', async () => {
      const resp = await api.delete('/preferences.php');
      expect(resp.status).toBe(400);
    });
  });
});
