import { describe, it, expect } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

describe('Dashboard API — /dashboard.php', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET ?action=stats returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/dashboard.php', {
        params: { action: 'stats' },
      });
      expect(resp.status).toBe(401);
    });

    it('GET ?action=page-notices returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/dashboard.php', {
        params: { action: 'page-notices' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET ?action=stats
  // -----------------------------------------------------------------------
  describe('GET ?action=stats', () => {
    it('returns dashboard statistics', async () => {
      const resp = await api.get('/dashboard.php', {
        params: { action: 'stats' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data).toHaveProperty('entry_counts');
      expect(data).toHaveProperty('shared_with_me_count');
      expect(data).toHaveProperty('last_login');
      expect(data).toHaveProperty('last_vault_unlock');

      // entry_counts should be an object (may be empty)
      expect(typeof data.entry_counts).toBe('object');
      // shared_with_me_count should be a number
      expect(typeof data.shared_with_me_count).toBe('number');
    });

    it('entry_counts values are integers', async () => {
      const resp = await api.get('/dashboard.php', {
        params: { action: 'stats' },
      });
      const data = await api.data(resp);

      for (const [, count] of Object.entries(data.entry_counts)) {
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // GET ?action=page-notices
  // -----------------------------------------------------------------------
  describe('GET ?action=page-notices', () => {
    it('returns an array of notices', async () => {
      const resp = await api.get('/dashboard.php', {
        params: { action: 'page-notices' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      // Should be an array (may be empty if no notices.json exists)
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid action
  // -----------------------------------------------------------------------
  describe('invalid action', () => {
    it('returns 400 for unknown action', async () => {
      const resp = await api.get('/dashboard.php', {
        params: { action: 'nonexistent' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing action', async () => {
      const resp = await api.get('/dashboard.php');
      expect(resp.status).toBe(400);
    });
  });
});
