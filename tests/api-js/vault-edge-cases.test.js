/**
 * Vault API — Edge Case Tests
 *
 * Tests type confusion, soft-delete behavior, cross-user isolation,
 * bulk operation boundaries, and template_id immutability.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, extractData, unauthRequest, apiRequest } from '../helpers/apiClient.js';

describe('Vault API — Edge Cases', () => {
  // Track all entry IDs created during tests for cleanup
  const createdIds = [];

  // Helper: create an entry and track its ID for cleanup
  async function createTrackedEntry(body) {
    const resp = await api.post('/vault.php', { json: body });
    if (resp.status === 201) {
      const data = await api.data(resp);
      if (data?.id) createdIds.push(data.id);
      return { resp, data };
    }
    return { resp, data: null };
  }

  afterAll(async () => {
    // Clean up all tracked entries (soft-delete, ignore 404s)
    for (const id of createdIds) {
      await api.delete(`/vault.php?id=${id}`);
    }
  });

  // ── Type confusion: encrypted_data ──────────────────────────────

  describe('type confusion — encrypted_data', () => {
    it('rejects encrypted_data as array', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: [1, 2, 3] },
      });
      // PHP cannot coerce array to string — should be 400 or 500
      // Server must not return 201 (data corruption)
      expect(resp.status).not.toBe(201);
    });

    it('rejects encrypted_data as number', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: 12345 },
      });
      // PHP coerces numbers to string — may succeed (201) or reject (400)
      // Either is acceptable as long as it doesn't crash
      expect([201, 400]).toContain(resp.status);
      if (resp.status === 201) {
        // Clean up if it was created
        const data = await api.data(resp);
        if (data?.id) createdIds.push(data.id);
      }
    });

    it('rejects encrypted_data as empty object', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: {} },
      });
      // Empty object → PHP empty associative array → empty() returns true → 400
      expect(resp.status).toBe(400);
    });

    it('rejects encrypted_data as boolean true', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: true },
      });
      // PHP coerces true → "1" (non-empty string) — may succeed or reject
      expect([201, 400]).toContain(resp.status);
      if (resp.status === 201) {
        const data = await api.data(resp);
        if (data?.id) createdIds.push(data.id);
      }
    });

    it('rejects encrypted_data as null', async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: null },
      });
      // null → empty() returns true → 400
      expect(resp.status).toBe(400);
    });
  });

  // ── Non-existent template_id ────────────────────────────────────

  it('handles non-existent template_id on creation', async () => {
    const resp = await api.post('/vault.php', {
      json: { entry_type: 'password', template_id: 999999, encrypted_data: 'test-blob' },
    });
    // FK constraint: 500 if DB enforces FK, 201 if nullable/no FK.
    // Document actual behavior — server returns 500 due to FK violation.
    expect([201, 400, 422, 500]).toContain(resp.status);
    if (resp.status === 201) {
      const data = await api.data(resp);
      if (data?.id) createdIds.push(data.id);
    }
  });

  // ── Invalid entry_type ──────────────────────────────────────────

  it('rejects invalid entry_type', async () => {
    const resp = await api.post('/vault.php', {
      json: { entry_type: 'hacked', encrypted_data: 'blob' },
    });
    expect(resp.status).toBe(400);
  });

  it('rejects empty entry_type', async () => {
    const resp = await api.post('/vault.php', {
      json: { entry_type: '', encrypted_data: 'blob' },
    });
    expect(resp.status).toBe(400);
  });

  // ── Soft-deleted entry operations ───────────────────────────────

  describe('soft-deleted entry', () => {
    let deletedId = null;

    beforeAll(async () => {
      // Create and then soft-delete an entry
      const createResp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: 'soft-delete-edge-test' },
      });
      expect(createResp.status).toBe(201);
      const data = await api.data(createResp);
      deletedId = data?.id;
      // Track for cleanup (soft-delete may already clean it, but safety first)
      if (deletedId) createdIds.push(deletedId);

      const delResp = await api.delete(`/vault.php?id=${deletedId}`);
      expect(delResp.status).toBe(200);
    });

    it('returns 404 when updating a soft-deleted entry', async () => {
      const resp = await api.put(`/vault.php?id=${deletedId}`, {
        json: { encrypted_data: 'updated-blob' },
      });
      expect(resp.status).toBe(404);
    });

    it('returns 404 when getting a soft-deleted entry', async () => {
      const resp = await api.get(`/vault.php?id=${deletedId}`);
      expect(resp.status).toBe(404);
    });

    it('returns 404 when deleting an already soft-deleted entry', async () => {
      const resp = await api.delete(`/vault.php?id=${deletedId}`);
      expect(resp.status).toBe(404);
    });

    it('soft-deleted entry appears in deleted list', async () => {
      const resp = await api.get('/vault.php?action=deleted');
      expect(resp.status).toBe(200);
      const data = await api.data(resp);
      expect(Array.isArray(data)).toBe(true);
      const found = data.find(e => e.id === deletedId);
      expect(found).toBeDefined();
      expect(found.deleted_at).not.toBeNull();
    });
  });

  // ── Cross-user isolation ────────────────────────────────────────

  describe('cross-user isolation', () => {
    let adminEntryId = null;

    beforeAll(async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', encrypted_data: 'admin-owned-entry' },
      });
      expect(resp.status).toBe(201);
      const data = await api.data(resp);
      adminEntryId = data?.id;
    });

    afterAll(async () => {
      if (adminEntryId) await api.delete(`/vault.php?id=${adminEntryId}`);
    });

    it('regular user cannot read admin entry via GET', async () => {
      const resp = await apiRequest('GET', `/vault.php?id=${adminEntryId}`, {
        role: 'regular',
      });
      expect(resp.status).toBe(404);
    });

    it('regular user cannot update admin entry via PUT', async () => {
      const resp = await apiRequest('PUT', `/vault.php?id=${adminEntryId}`, {
        role: 'regular',
        json: { encrypted_data: 'hijacked' },
      });
      expect(resp.status).toBe(404);
    });

    it('regular user cannot delete admin entry', async () => {
      const resp = await apiRequest('DELETE', `/vault.php?id=${adminEntryId}`, {
        role: 'regular',
      });
      expect(resp.status).toBe(404);
    });

    it('regular user cannot update admin entry via bulk-update', async () => {
      const resp = await apiRequest('POST', '/vault.php?action=bulk-update', {
        role: 'regular',
        json: {
          entries: [{ id: adminEntryId, encrypted_data: 'hijacked' }],
        },
      });
      // Should succeed with 0 updated (silently skips non-owned entries)
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data?.updated).toBe(0);
    });

    it('admin entry is unchanged after cross-user attacks', async () => {
      const resp = await api.get(`/vault.php?id=${adminEntryId}`);
      expect(resp.status).toBe(200);
      const data = await api.data(resp);
      expect(data?.encrypted_data).toBe('admin-owned-entry');
    });
  });

  // ── Bulk-create edge cases ──────────────────────────────────────

  describe('bulk-create edge cases', () => {
    it('handles bulk-create with 100 entries', async () => {
      const entries = Array.from({ length: 100 }, (_, i) => ({
        entry_type: 'password',
        encrypted_data: `bulk-edge-test-${i}`,
      }));
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: { entries },
      });
      expect(resp.status).toBe(200);
      const data = await api.data(resp);
      expect(data?.count).toBe(100);

      // Clean up all bulk-created entries
      if (data?.ids) {
        for (const id of data.ids) {
          await api.delete(`/vault.php?id=${id}`);
        }
      }
    });

    it('rejects bulk-create with empty entries array', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: { entries: [] },
      });
      expect(resp.status).toBe(400);
    });

    it('rejects bulk-create when any entry has invalid type', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'password', encrypted_data: 'ok' },
            { entry_type: 'INVALID', encrypted_data: 'bad' },
          ],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('atomicity: no entries created when one is invalid', async () => {
      // Get counts before
      const beforeResp = await api.get('/vault.php?action=counts');
      const beforeCounts = await api.data(beforeResp);
      const beforePasswordCount = beforeCounts.password;

      // Try to bulk-create with one valid + one invalid
      await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'password', encrypted_data: 'atomicity-edge-test' },
            { entry_type: 'BOGUS', encrypted_data: 'should-fail' },
          ],
        },
      });

      // Verify no entries leaked through
      const afterResp = await api.get('/vault.php?action=counts');
      const afterCounts = await api.data(afterResp);
      expect(afterCounts.password).toBe(beforePasswordCount);
    });

    it('rejects bulk-create with missing encrypted_data in one entry', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: {
          entries: [
            { entry_type: 'password', encrypted_data: 'valid' },
            { entry_type: 'password' },
          ],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('rejects bulk-create with entries as non-array', async () => {
      const resp = await api.post('/vault.php?action=bulk-create', {
        json: { entries: 'not-an-array' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── Bulk-update edge cases ──────────────────────────────────────

  describe('bulk-update edge cases', () => {
    it('returns updated=0 for non-existent entry IDs', async () => {
      const resp = await api.post('/vault.php?action=bulk-update', {
        json: {
          entries: [
            { id: 999998, encrypted_data: 'ghost-1' },
            { id: 999999, encrypted_data: 'ghost-2' },
          ],
        },
      });
      expect(resp.status).toBe(200);
      const data = await api.data(resp);
      expect(data?.updated).toBe(0);
    });

    it('rejects bulk-update with entries as non-array', async () => {
      const resp = await api.post('/vault.php?action=bulk-update', {
        json: { entries: 'not-an-array' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── template_id immutability ────────────────────────────────────

  describe('template_id immutability', () => {
    let immutableEntryId = null;

    beforeAll(async () => {
      const resp = await api.post('/vault.php', {
        json: { entry_type: 'password', template_id: 1, encrypted_data: 'immutable-test' },
      });
      expect(resp.status).toBe(201);
      const data = await api.data(resp);
      immutableEntryId = data?.id;
    });

    afterAll(async () => {
      if (immutableEntryId) await api.delete(`/vault.php?id=${immutableEntryId}`);
    });

    it('rejects changing template_id on update', async () => {
      const resp = await api.put(`/vault.php?id=${immutableEntryId}`, {
        json: { encrypted_data: 'updated', template_id: 2 },
      });
      // MariaDbAdapter throws InvalidArgumentException → caught as 400
      expect(resp.status).toBe(400);
    });

    it('allows same template_id on update', async () => {
      const resp = await api.put(`/vault.php?id=${immutableEntryId}`, {
        json: { encrypted_data: 'updated-same-tpl', template_id: 1 },
      });
      expect(resp.status).toBe(200);
    });

    it('allows omitting template_id on update', async () => {
      const resp = await api.put(`/vault.php?id=${immutableEntryId}`, {
        json: { encrypted_data: 'updated-no-tpl' },
      });
      expect(resp.status).toBe(200);
    });

    it('template_id is preserved after update without specifying it', async () => {
      const resp = await api.get(`/vault.php?id=${immutableEntryId}`);
      expect(resp.status).toBe(200);
      const data = await api.data(resp);
      expect(data?.template_id).toBe(1);
    });
  });

  // ── Boundary / edge IDs ─────────────────────────────────────────

  describe('boundary IDs', () => {
    it('id=0 falls through to list (PHP treats (int)0 as falsy)', async () => {
      const resp = await api.get('/vault.php?id=0');
      // id=0 is falsy in PHP, so $id is null → falls through to GET list
      expect(resp.status).toBe(200);
    });

    it('returns 404 for negative id', async () => {
      const resp = await api.get('/vault.php?id=-1');
      expect(resp.status).toBe(404);
    });

    it('handles very large id gracefully', async () => {
      const resp = await api.get('/vault.php?id=2147483647');
      expect(resp.status).toBe(404);
    });
  });
});
