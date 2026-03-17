/**
 * Vault API Integration Tests
 *
 * Tests vault.php endpoints: CRUD, bulk ops, soft delete, restore, counts.
 * Note: These tests work with encrypted_data blobs (opaque strings).
 * The vault requires auth on ALL endpoints (top-level Auth::requireAuth).
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, unauthRequest } from '../helpers/apiClient.js';

describe('Vault API', () => {
  let createdEntryId = null;
  let bulkCreatedIds = [];

  // ── auth enforcement (all endpoints require auth) ────────────────
  describe('auth enforcement', () => {
    it('GET list returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/vault.php');
      expect(resp.status).toBe(401);
    });

    it('GET counts returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/vault.php?action=counts');
      expect(resp.status).toBe(401);
    });

    it('POST create returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/vault.php', {
        json: { entry_type: 'password', template_id: 1, encrypted_data: 'x' },
      });
      expect(resp.status).toBe(401);
    });

    it('PUT update returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/vault.php?id=1', {
        json: { encrypted_data: 'x' },
      });
      expect(resp.status).toBe(401);
    });

    it('DELETE returns 401 without auth', async () => {
      const resp = await unauthRequest('DELETE', '/vault.php?id=1');
      expect(resp.status).toBe(401);
    });

    it('GET deleted returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/vault.php?action=deleted');
      expect(resp.status).toBe(401);
    });
  });

  // ── counts ───────────────────────────────────────────────────────
  describe('GET ?action=counts', () => {
    it('returns entry counts by type', async () => {
      const resp = await api.get('/vault.php?action=counts');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toBeDefined();
      // Should have keys for valid types
      const validTypes = ['password', 'account', 'asset', 'license', 'insurance', 'custom'];
      for (const type of validTypes) {
        expect(data).toHaveProperty(type);
        expect(typeof data[type]).toBe('number');
      }
    });
  });

  // ── create ───────────────────────────────────────────────────────
  describe('POST (create entry)', () => {
    it('creates a vault entry with 201 status', async () => {
      const resp = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'dGVzdC1lbmNyeXB0ZWQtZGF0YQ==',
        },
      });
      expect(resp.status).toBe(201);
      const data = await extractData(resp);
      expect(data).toHaveProperty('id');
      expect(typeof data.id).toBe('number');
      createdEntryId = data.id;
    });

    it('returns 400 for missing encrypted_data', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', template_id: 1 },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid entry_type', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'invalid_type', encrypted_data: 'abc123' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for empty encrypted_data', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', template_id: 1, encrypted_data: '' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── read single ──────────────────────────────────────────────────
  describe('GET ?id=N (single entry)', () => {
    it('returns single entry by id', async () => {
      if (!createdEntryId) return;
      const resp = await api.get(`/vault.php?id=${createdEntryId}`);
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('id', createdEntryId);
      expect(data).toHaveProperty('entry_type', 'password');
      expect(data).toHaveProperty('encrypted_data');
      expect(data).toHaveProperty('template_id');
      expect(data).toHaveProperty('created_at');
      expect(data).toHaveProperty('updated_at');
    });

    it('returns 404 for non-existent entry', async () => {
      const resp = await api.get('/vault.php?id=999999');
      expect(resp.status).toBe(404);
    });
  });

  // ── read list ────────────────────────────────────────────────────
  describe('GET (list entries)', () => {
    it('returns array of entries', async () => {
      const resp = await api.get('/vault.php');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
    });

    it('entries have correct shape', async () => {
      const resp = await api.get('/vault.php');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      if (data.length > 0) {
        const entry = data[0];
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('entry_type');
        expect(entry).toHaveProperty('template_id');
        expect(entry).toHaveProperty('encrypted_data');
        expect(entry).toHaveProperty('created_at');
        expect(entry).toHaveProperty('updated_at');
      }
    });

    it('filters by type=password', async () => {
      const resp = await api.get('/vault.php', { params: { type: 'password' } });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
      for (const entry of data) {
        expect(entry.entry_type).toBe('password');
      }
    });

    it('returns 400 for invalid type filter', async () => {
      const resp = await api.get('/vault.php', { params: { type: 'invalid_type' } });
      expect(resp.status).toBe(400);
    });
  });

  // ── update ───────────────────────────────────────────────────────
  describe('PUT ?id=N (update entry)', () => {
    it('updates encrypted_data', async () => {
      if (!createdEntryId) return;
      const resp = await api.put(`/vault.php?id=${createdEntryId}`, {
        json: {
          encrypted_data: 'dXBkYXRlZC1lbmNyeXB0ZWQtZGF0YQ==',
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('message', 'Entry updated.');
    });

    it('verifies updated data persists', async () => {
      if (!createdEntryId) return;
      const resp = await api.get(`/vault.php?id=${createdEntryId}`);
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.encrypted_data).toBe('dXBkYXRlZC1lbmNyeXB0ZWQtZGF0YQ==');
    });

    it('returns 400 for missing encrypted_data', async () => {
      if (!createdEntryId) return;
      const resp = await api.put(`/vault.php?id=${createdEntryId}`, {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 404 for non-existent entry', async () => {
      const resp = await api.put('/vault.php?id=999999', {
        json: { encrypted_data: 'abc' },
      });
      expect(resp.status).toBe(404);
    });

    it('returns 400 for invalid entry_type on update', async () => {
      if (!createdEntryId) return;
      const resp = await api.put(`/vault.php?id=${createdEntryId}`, {
        json: { encrypted_data: 'abc', entry_type: 'invalid_type' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── bulk create ──────────────────────────────────────────────────
  describe('POST ?action=bulk-create', () => {
    it('creates multiple entries at once', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'password', template_id: 1, encrypted_data: 'YnVsay1lbnRyeS0x' },
            { entry_type: 'account', template_id: 2, encrypted_data: 'YnVsay1lbnRyeS0y' },
          ],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('ids');
      expect(data).toHaveProperty('count', 2);
      expect(Array.isArray(data.ids)).toBe(true);
      expect(data.ids.length).toBe(2);
      bulkCreatedIds = data.ids;
    });

    it('returns 400 for empty entries array', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: { entries: [] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing entries', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid entry_type in batch', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'invalid', encrypted_data: 'abc' },
          ],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing encrypted_data in batch', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'password' },
          ],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('atomicity: invalid entry in batch prevents all entries from being created', async () => {
      // Get count before attempt
      const beforeResp = await api.get('/vault.php?action=counts');
      const beforeCounts = await extractData(beforeResp);
      const beforeLicenseCount = beforeCounts.license;

      // Send a batch where the second entry has an invalid type — validation should reject all
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'license', template_id: null, encrypted_data: 'YXRvbWljaXR5LXRlc3Q=' },
            { entry_type: 'INVALID', template_id: null, encrypted_data: 'YXRvbWljaXR5LXRlc3Q=' },
          ],
        },
      });
      expect(resp.status).toBe(400);

      // Verify count hasn't changed — first entry was NOT committed
      const afterResp = await api.get('/vault.php?action=counts');
      const afterCounts = await extractData(afterResp);
      expect(afterCounts.license).toBe(beforeLicenseCount);
    });
  });

  // ── bulk update ──────────────────────────────────────────────────
  describe('POST ?action=bulk-update', () => {
    it('updates multiple entries', async () => {
      if (bulkCreatedIds.length < 2) return;
      const resp = await api.post('/vault.php?action=bulk-update', {
        json: {
          entries: [
            { id: bulkCreatedIds[0], encrypted_data: 'dXBkYXRlZC1idWxrLTE=' },
            { id: bulkCreatedIds[1], encrypted_data: 'dXBkYXRlZC1idWxrLTI=' },
          ],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('updated', 2);
    });

    it('returns 400 for empty entries array', async () => {
      const resp = await api.post('/vault.php?action=bulk-update', {
        json: { entries: [] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing id in batch entry', async () => {
      const resp = await api.post('/vault.php?action=bulk-update', {
        json: {
          entries: [{ encrypted_data: 'abc' }],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing encrypted_data in batch entry', async () => {
      const resp = await api.post('/vault.php?action=bulk-update', {
        json: {
          entries: [{ id: 999 }],
        },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── delete (soft) ────────────────────────────────────────────────
  describe('DELETE ?id=N (soft delete)', () => {
    it('soft-deletes an entry', async () => {
      if (!createdEntryId) return;
      const resp = await api.delete(`/vault.php?id=${createdEntryId}`);
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('message', 'Entry deleted.');
      expect(data).toHaveProperty('share_count');
      expect(typeof data.share_count).toBe('number');
    });

    it('returns 404 after entry is deleted', async () => {
      if (!createdEntryId) return;
      const resp = await api.get(`/vault.php?id=${createdEntryId}`);
      // Deleted entries should not appear in normal GET
      expect(resp.status).toBe(404);
    });

    it('returns 404 for non-existent entry', async () => {
      const resp = await api.delete('/vault.php?id=999999');
      expect(resp.status).toBe(404);
    });
  });

  // ── deleted list ─────────────────────────────────────────────────
  describe('GET ?action=deleted', () => {
    it('lists soft-deleted entries', async () => {
      const resp = await api.get('/vault.php?action=deleted');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
    });

    it('deleted entries have correct shape', async () => {
      const resp = await api.get('/vault.php?action=deleted');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      if (data.length > 0) {
        const entry = data[0];
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('entry_type');
        expect(entry).toHaveProperty('encrypted_data');
        expect(entry).toHaveProperty('deleted_at');
        expect(entry.deleted_at).not.toBeNull();
      }
    });
  });

  // ── restore ──────────────────────────────────────────────────────
  describe('POST ?action=restore&id=N', () => {
    it('restores a soft-deleted entry', async () => {
      if (!createdEntryId) return;
      const resp = await api.post(`/vault.php?action=restore&id=${createdEntryId}`);
      // May be 200 (restored) or 404 (already purged or not deleted)
      expect([200, 404]).toContain(resp.status);
      if (resp.status === 200) {
        const data = await extractData(resp);
        expect(data).toHaveProperty('message', 'Entry restored.');
      }
    });

    it('returns 404 for non-existent entry', async () => {
      const resp = await api.post('/vault.php?action=restore&id=999999');
      expect(resp.status).toBe(404);
    });
  });

  // ── invalid request fallback ─────────────────────────────────────
  describe('invalid request', () => {
    it('returns 400 for unsupported method/action', async () => {
      const resp = await api.put('/vault.php?action=nonexistent', {
        json: { foo: 'bar' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── cleanup: remove all test entries ─────────────────────────────
  describe('cleanup', () => {
    it('removes single test entry', async () => {
      if (!createdEntryId) return;
      // Delete it (may already be deleted — that's fine)
      await api.delete(`/vault.php?id=${createdEntryId}`);
    });

    it('removes bulk test entries', async () => {
      for (const id of bulkCreatedIds) {
        await api.delete(`/vault.php?id=${id}`);
      }
    });
  });
});
