import { describe, it, expect } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

describe('Sync API — /sync.php', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/sync.php');
      expect(resp.status).toBe(401);
    });

    it('returns 401 without auth even with since param', async () => {
      const resp = await unauthRequest('GET', '/sync.php', {
        params: { since: '2026-01-01T00:00:00Z' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET without since — baseline response
  // -----------------------------------------------------------------------
  describe('GET without since param', () => {
    it('returns baseline with server_time and no changes', async () => {
      const resp = await api.get('/sync.php');
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.changes).toBe(false);
      expect(data.categories).toEqual([]);
      expect(data).toHaveProperty('server_time');
      expect(data).toHaveProperty('poll_interval');
      expect(typeof data.poll_interval).toBe('number');
      expect(data.poll_interval).toBeGreaterThan(0);
    });

    it('server_time is a valid ISO timestamp', async () => {
      const resp = await api.get('/sync.php');
      const data = await api.data(resp);

      // server_time should parse to a valid date
      const parsed = new Date(data.server_time);
      expect(parsed.getTime()).not.toBeNaN();
    });
  });

  // -----------------------------------------------------------------------
  // GET with since param — change detection
  // -----------------------------------------------------------------------
  describe('GET with since param', () => {
    it('returns changes structure with a valid since timestamp', async () => {
      const resp = await api.get('/sync.php', {
        params: { since: '2026-01-01T00:00:00Z' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(typeof data.changes).toBe('boolean');
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data).toHaveProperty('server_time');
      expect(data).toHaveProperty('poll_interval');
    });

    it('categories contains valid category names when changes exist', async () => {
      // Using a very old timestamp to maximize chance of detecting changes
      const resp = await api.get('/sync.php', {
        params: { since: '2000-01-01T00:00:00Z' },
      });
      const data = await api.data(resp);

      const validCategories = ['vault_entries', 'currencies', 'countries', 'templates'];
      for (const cat of data.categories) {
        expect(validCategories).toContain(cat);
      }
    });

    it('returns no changes for a future since timestamp', async () => {
      const resp = await api.get('/sync.php', {
        params: { since: '2099-12-31T23:59:59Z' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.changes).toBe(false);
      expect(data.categories).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------
  describe('validation', () => {
    it('returns 400 for invalid since timestamp', async () => {
      const resp = await api.get('/sync.php', {
        params: { since: 'not-a-date' },
      });
      expect(resp.status).toBe(400);
    });
  });
});
