import { describe, it, expect } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

describe('Audit API — /audit.php', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/audit.php');
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET — retrieve audit log
  // -----------------------------------------------------------------------
  describe('GET audit log', () => {
    it('returns array of audit entries', async () => {
      const resp = await api.get('/audit.php');
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(Array.isArray(data)).toBe(true);

      // Each entry should only have action + created_at (no IPs, no user_id)
      if (data.length > 0) {
        expect(data[0]).toHaveProperty('action');
        expect(data[0]).toHaveProperty('created_at');
        expect(data[0]).not.toHaveProperty('ip_hash');
        expect(data[0]).not.toHaveProperty('user_id');
      }
    });

    it('all entries have only action and created_at fields', async () => {
      const resp = await api.get('/audit.php');
      const data = await api.data(resp);

      for (const entry of data) {
        expect(Object.keys(entry).sort()).toEqual(['action', 'created_at']);
      }
    });

    it('entries have ISO-like timestamp in created_at', async () => {
      const resp = await api.get('/audit.php');
      const data = await api.data(resp);

      if (data.length > 0) {
        // Should be a parseable date string
        const ts = new Date(data[0].created_at);
        expect(ts.getTime()).not.toBeNaN();
      }
    });

    it('accepts from/to date filters', async () => {
      const resp = await api.get('/audit.php?from=2020-01-01&to=2099-12-31');
      expect(resp.status).toBe(200);
      expect(Array.isArray(await api.data(resp))).toBe(true);
    });

    it('accepts from-only date filter', async () => {
      const resp = await api.get('/audit.php?from=2020-01-01');
      expect(resp.status).toBe(200);
      expect(Array.isArray(await api.data(resp))).toBe(true);
    });

    it('accepts to-only date filter', async () => {
      const resp = await api.get('/audit.php?to=2099-12-31');
      expect(resp.status).toBe(200);
      expect(Array.isArray(await api.data(resp))).toBe(true);
    });

    it('returns empty array for future-only date range', async () => {
      const resp = await api.get('/audit.php?from=2099-01-01&to=2099-12-31');
      expect(resp.status).toBe(200);
      const data = await api.data(resp);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    it('ignores invalid date format gracefully', async () => {
      // sanitizeDate returns null for non-YYYY-MM-DD, so the query
      // falls back to unfiltered — still returns 200
      const resp = await api.get('/audit.php?from=not-a-date');
      expect(resp.status).toBe(200);
      expect(Array.isArray(await api.data(resp))).toBe(true);
    });

    it('ignores SQL injection attempt in date params', async () => {
      const resp = await api.get(
        "/audit.php?from=2020-01-01' OR 1=1 --&to=2099-12-31",
      );
      expect(resp.status).toBe(200);
      // sanitizeDate rejects anything that doesn't match YYYY-MM-DD
    });
  });

  // -----------------------------------------------------------------------
  // Invalid methods — should return 400
  // -----------------------------------------------------------------------
  describe('invalid methods', () => {
    it('POST returns 400', async () => {
      const resp = await api.post('/audit.php', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('PUT returns 400', async () => {
      const resp = await api.put('/audit.php', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('DELETE returns 400', async () => {
      const resp = await api.delete('/audit.php');
      expect(resp.status).toBe(400);
    });
  });
});
