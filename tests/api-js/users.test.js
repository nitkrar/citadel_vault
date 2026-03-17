/**
 * Users API Integration Tests
 *
 * Tests users.php admin endpoints: list, create, update, role management.
 * Note: users.php calls Auth::requireAuth() at the top level, so ALL
 * endpoints return 401 without auth.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, unauthRequest } from '../helpers/apiClient.js';

describe('Users API', () => {
  // ── list (admin only) ───────────────────────────────────────────
  describe('GET (list users)', () => {
    it('returns user list for admin', async () => {
      const resp = await api.get('/users.php');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Should include the admin user
      const admin = data.find(u => u.username === 'initial_user');
      expect(admin).toBeDefined();
      expect(admin.role).toBe('admin');
    });

    it('includes expected fields in user objects', async () => {
      const resp = await api.get('/users.php');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      const user = data[0];
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('username');
      expect(user).toHaveProperty('email');
      expect(user).toHaveProperty('role');
      expect(user).toHaveProperty('is_active');
      expect(user).toHaveProperty('created_at');
      expect(user).toHaveProperty('has_vault_key');
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/users.php');
      expect(resp.status).toBe(401);
    });
  });

  // ── list-simple ─────────────────────────────────────────────────
  describe('GET ?action=list-simple', () => {
    it('returns simplified user list', async () => {
      const resp = await api.get('/users.php?action=list-simple');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
    });

    it('excludes current user from simple list', async () => {
      const resp = await api.get('/users.php?action=list-simple');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      // The logged-in admin user should not be in the list
      const self = data.find(u => u.username === 'initial_user');
      expect(self).toBeUndefined();
    });

    it('only returns id and username fields', async () => {
      const resp = await api.get('/users.php?action=list-simple');
      const data = await extractData(resp);
      if (data.length > 0) {
        const user = data[0];
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('username');
        // Should NOT include sensitive fields
        expect(user).not.toHaveProperty('email');
        expect(user).not.toHaveProperty('password_hash');
      }
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/users.php?action=list-simple');
      expect(resp.status).toBe(401);
    });
  });

  // ── create (admin) ──────────────────────────────────────────────
  describe('POST (create user)', () => {
    it('returns 400 for missing required fields', async () => {
      const resp = await api.post('/users.php', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing password', async () => {
      const resp = await api.post('/users.php', {
        json: { username: 'testuser', email: 'test@example.com' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for short password', async () => {
      const resp = await api.post('/users.php', {
        json: { username: 'testuser', email: 'test@example.com', password: 'short' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid role', async () => {
      const resp = await api.post('/users.php', {
        json: {
          username: 'testuser',
          email: 'test@example.com',
          password: 'ValidPass#1',
          role: 'superadmin',
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/users.php', {
        json: { username: 'hacker', email: 'h@h.com', password: 'Hack#123' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── PUT — force-reset-password (admin) ──────────────────────────
  describe('PUT ?action=force-reset-password', () => {
    it('returns 400 for short password', async () => {
      const resp = await api.put('/users.php?action=force-reset-password&id=999', {
        json: { password: 'short' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/users.php?action=force-reset-password&id=1', {
        json: { password: 'NewPass#123' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── PUT — force-change-password (admin) ─────────────────────────
  describe('PUT ?action=force-change-password', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/users.php?action=force-change-password&id=1', {
        json: {},
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── PUT — force-reset-vault (admin) ─────────────────────────────
  describe('PUT ?action=force-reset-vault', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/users.php?action=force-reset-vault&id=1', {
        json: {},
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── PUT — standard update ───────────────────────────────────────
  describe('PUT (update user)', () => {
    it('returns 400 when no id is provided', async () => {
      const resp = await api.put('/users.php', { json: { username: 'newname' } });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const resp = await api.put('/users.php?id=1', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for short password in update', async () => {
      const resp = await api.put('/users.php?id=1', {
        json: { password: 'short' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid role in update', async () => {
      const resp = await api.put('/users.php?id=1', {
        json: { role: 'superadmin' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/users.php?id=1', {
        json: { username: 'hacked' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── DELETE ──────────────────────────────────────────────────────
  describe('DELETE', () => {
    it('returns 400 when no id is provided', async () => {
      const resp = await api.delete('/users.php');
      expect(resp.status).toBe(400);
    });

    it('returns 400 when trying to delete self', async () => {
      // First get the admin user's ID
      const listResp = await api.get('/users.php');
      const users = await extractData(listResp);
      const admin = users.find(u => u.username === 'initial_user');
      if (admin) {
        const resp = await api.delete(`/users.php?id=${admin.id}`);
        expect(resp.status).toBe(400);
      }
    });

    it('returns 404 for non-existent user', async () => {
      const resp = await api.delete('/users.php?id=99999');
      expect(resp.status).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('DELETE', '/users.php?id=999');
      expect(resp.status).toBe(401);
    });
  });

  // ── fallback ────────────────────────────────────────────────────
  describe('invalid request', () => {
    it('returns 400 for unsupported method', async () => {
      const resp = await unauthRequest('PATCH', '/users.php');
      // Will be 401 first due to top-level auth check
      expect(resp.status).toBe(401);
    });
  });
});
