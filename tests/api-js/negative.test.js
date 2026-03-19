/**
 * Negative / Security Test Cases
 *
 * Tests for expected failures: admin-only enforcement (403), cross-user
 * isolation, password policy, lockout behavior, and input validation.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { api, apiRequest, extractData, unauthRequest, BASE_URL, getToken } from '../helpers/apiClient.js';

// ---------------------------------------------------------------------------
// Helper: make requests as regular (non-admin) user
// ---------------------------------------------------------------------------
const regularApi = {
  get: (path, opts = {}) => apiRequest('GET', path, { ...opts, role: 'regular' }),
  post: (path, opts = {}) => apiRequest('POST', path, { ...opts, role: 'regular' }),
  put: (path, opts = {}) => apiRequest('PUT', path, { ...opts, role: 'regular' }),
  delete: (path, opts = {}) => apiRequest('DELETE', path, { ...opts, role: 'regular' }),
};

// ---------------------------------------------------------------------------
// 1. Admin-Only Enforcement (403)
// ---------------------------------------------------------------------------
describe('Admin-only endpoint enforcement (403)', () => {
  // users.php — admin only
  describe('users.php — regular user gets 403', () => {
    it('GET user list returns 403 for non-admin', async () => {
      const resp = await regularApi.get('/users.php');
      expect(resp.status).toBe(403);
    });

    it('POST create user returns 403 for non-admin', async () => {
      const resp = await regularApi.post('/users.php', {
        json: { username: 'hacker', email: 'h@h.com', password: 'Hacker#123' },
      });
      expect(resp.status).toBe(403);
    });

    it('PUT force-reset-password blocked for non-admin', async () => {
      const resp = await regularApi.put('/users.php?action=force-reset-password', {
        json: { user_id: 1 },
      });
      // 400 (validation first) or 403 (admin check first) — either blocks non-admin
      expect([400, 403]).toContain(resp.status);
    });

    it('PUT force-change-password blocked for non-admin', async () => {
      const resp = await regularApi.put('/users.php?action=force-change-password', {
        json: { user_id: 1 },
      });
      expect([400, 403]).toContain(resp.status);
    });

    it('PUT force-reset-vault blocked for non-admin', async () => {
      const resp = await regularApi.put('/users.php?action=force-reset-vault', {
        json: { user_id: 1 },
      });
      expect([400, 403]).toContain(resp.status);
    });

    it('DELETE user returns 403 for non-admin', async () => {
      const resp = await regularApi.delete('/users.php?id=1');
      expect(resp.status).toBe(403);
    });
  });

  // settings.php — PUT is admin only
  describe('settings.php — regular user cannot write', () => {
    it('PUT setting returns 403 for non-admin', async () => {
      const resp = await regularApi.put('/settings.php', {
        json: { key: 'default_vault_tab', value: 'asset' },
      });
      expect(resp.status).toBe(403);
    });

    it('GET settings is allowed for regular user', async () => {
      const resp = await regularApi.get('/settings.php');
      expect(resp.status).toBe(200);
    });
  });

  // prices.php — admin cache endpoints
  describe('prices.php — admin cache management', () => {
    it('GET cache returns 403 for non-admin', async () => {
      const resp = await regularApi.get('/prices.php', {
        params: { action: 'cache' },
      });
      expect(resp.status).toBe(403);
    });

    it('DELETE cache returns 403 for non-admin', async () => {
      const resp = await regularApi.delete('/prices.php?action=cache');
      expect(resp.status).toBe(403);
    });
  });

  // templates.php — approve-promotion is admin only
  describe('templates.php — admin-only actions', () => {
    it('POST approve-promotion blocked for non-admin', async () => {
      const resp = await regularApi.post('/templates.php', {
        params: { action: 'approve-promotion' },
        json: { template_id: 1 },
      });
      // 400 (validation) or 403 (admin check) — either blocks non-admin
      expect([400, 403]).toContain(resp.status);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-User Isolation
// ---------------------------------------------------------------------------
describe('Cross-user isolation', () => {
  let adminEntryId = null;

  beforeAll(async () => {
    // Admin creates an entry
    const resp = await api.post('/vault.php', {
      json: {
        entry_type: 'password',
        template_id: 1,
        encrypted_data: 'YWRtaW4tc2VjcmV0LWRhdGE=',
      },
    });
    if (resp.status === 201) {
      const data = await extractData(resp);
      adminEntryId = data.id;
    }
  });

  it('regular user cannot see admin entries in list', async () => {
    const resp = await regularApi.get('/vault.php');
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    if (adminEntryId && Array.isArray(data)) {
      const found = data.find(e => e.id === adminEntryId);
      expect(found).toBeUndefined();
    }
  });

  it('regular user cannot read admin entry by ID', async () => {
    if (!adminEntryId) return;
    const resp = await regularApi.get('/vault.php', {
      params: { id: adminEntryId },
    });
    expect(resp.status).toBe(404);
  });

  it('regular user cannot update admin entry', async () => {
    if (!adminEntryId) return;
    const resp = await regularApi.put(`/vault.php?id=${adminEntryId}`, {
      json: {
        entry_type: 'password',
        template_id: 1,
        encrypted_data: 'aGFja2VkLWRhdGE=',
      },
    });
    // 400 (validation), 403 (forbidden), or 404 (not found) — all block the update
    expect([400, 403, 404]).toContain(resp.status);
  });

  it('regular user cannot delete admin entry', async () => {
    if (!adminEntryId) return;
    const resp = await regularApi.delete(`/vault.php?id=${adminEntryId}`);
    expect([403, 404]).toContain(resp.status);
  });

  // Cleanup
  it('cleanup: admin deletes test entry', async () => {
    if (!adminEntryId) return;
    await api.delete(`/vault.php?id=${adminEntryId}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Password Policy
// ---------------------------------------------------------------------------
describe('Password policy enforcement', () => {
  it('rejects password shorter than 8 characters', async () => {
    const resp = await api.put('/auth.php?action=password', {
      json: {
        current_password: 'Initial#12$',
        new_password: 'Short1!',
      },
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('rejects empty new password', async () => {
    const resp = await api.put('/auth.php?action=password', {
      json: {
        current_password: 'Initial#12$',
        new_password: '',
      },
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('rejects wrong current password', async () => {
    const resp = await api.put('/auth.php?action=password', {
      json: {
        current_password: 'WrongPassword!1',
        new_password: 'ValidNewPass#123',
      },
    });
    expect(resp.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 4. Login Error Paths
// ---------------------------------------------------------------------------
describe('Login error handling', () => {
  it('returns 401 for non-existent user', async () => {
    const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'totally_fake_user', password: 'Whatever#123' }),
    });
    expect(resp.status).toBe(401);
  });

  it('returns 401 for correct user wrong password', async () => {
    const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'initial_user', password: 'WrongPass#123' }),
    });
    expect(resp.status).toBe(401);
  });

  it('returns error for empty username', async () => {
    const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '', password: 'Test#123' }),
    });
    expect([400, 401]).toContain(resp.status);
  });

  it('returns error for empty password', async () => {
    const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'initial_user', password: '' }),
    });
    expect([400, 401]).toContain(resp.status);
  });

  it('returns error for missing body', async () => {
    const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect([400, 401]).toContain(resp.status);
  });
});

// ---------------------------------------------------------------------------
// 5. Vault Data Integrity
// ---------------------------------------------------------------------------
describe('Vault data integrity enforcement', () => {
  it('rejects entry creation without encrypted_data', async () => {
    const resp = await api.post('/vault.php', {
      json: { entry_type: 'password', template_id: 1 },
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('rejects entry creation with empty encrypted_data', async () => {
    const resp = await api.post('/vault.php', {
      json: { entry_type: 'password', template_id: 1, encrypted_data: '' },
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('rejects invalid entry_type', async () => {
    const resp = await api.post('/vault.php', {
      json: { entry_type: 'hackertype', template_id: 1, encrypted_data: 'dGVzdA==' },
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('rejects update without id', async () => {
    const resp = await api.put('/vault.php', {
      json: { entry_type: 'password', template_id: 1, encrypted_data: 'dGVzdA==' },
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('returns 404 for deleting non-existent entry', async () => {
    const resp = await api.delete('/vault.php?id=999999');
    expect(resp.status).toBe(404);
  });

  it('rejects restoring non-existent entry', async () => {
    const resp = await api.post('/vault.php?action=restore', {
      json: { id: 999999 },
    });
    // 400 (missing id param) or 404 (not found) — depends on how id is passed
    expect([400, 404]).toContain(resp.status);
  });
});

// ---------------------------------------------------------------------------
// 6. Encryption API Validation
// ---------------------------------------------------------------------------
describe('Encryption API validation', () => {
  it('rejects setup with missing fields', async () => {
    const resp = await api.post('/encryption.php?action=setup', {
      json: {},
    });
    expect([400, 409, 422]).toContain(resp.status);
  });

  it('rejects vault key update with missing fields', async () => {
    const resp = await api.post('/encryption.php?action=update-vault-key', {
      json: {},
    });
    expect([400, 422]).toContain(resp.status);
  });

  it('rejects setup-rsa with missing fields', async () => {
    const resp = await api.post('/encryption.php?action=setup-rsa', {
      json: {},
    });
    expect([400, 422]).toContain(resp.status);
  });
});

// ---------------------------------------------------------------------------
// 7. HTTP Method Enforcement
// ---------------------------------------------------------------------------
describe('HTTP method enforcement', () => {
  it('vault.php rejects PATCH method', async () => {
    const token = await getToken('admin');
    const resp = await fetch(`${BASE_URL}/vault.php`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 1 }),
    });
    // PHP routes unhandled methods to fallthrough — 400 or 404 or 405
    expect([400, 404, 405]).toContain(resp.status);
  });

  it('settings.php rejects DELETE method', async () => {
    const token = await getToken('admin');
    const resp = await fetch(`${BASE_URL}/settings.php`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect([404, 405]).toContain(resp.status);
  });
});

// ---------------------------------------------------------------------------
// 8. Admin Self-Protection
// ---------------------------------------------------------------------------
describe('Admin self-protection', () => {
  it('admin cannot delete themselves', async () => {
    const resp = await api.delete('/users.php?id=1');
    // Should reject — either 400 (self-delete guard) or 403
    expect([400, 403]).toContain(resp.status);
  });
});

// ---------------------------------------------------------------------------
// 9. Snapshot Cross-User Isolation
// ---------------------------------------------------------------------------
describe('snapshot cross-user isolation', () => {
  let adminSnapshotId = null;
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    // Admin creates a snapshot.
    // snapshots.php requires `encrypted_meta` (not `meta`) and each entry
    // must carry `encrypted_data` — plain-text meta/entry fields are rejected.
    const resp = await api.post('/snapshots.php', {
      json: {
        snapshot_date: today,
        encrypted_meta: 'dGVzdC1tZXRhLWVuY3J5cHRlZA==',
        entries: [
          { entry_id: 1, encrypted_data: 'dGVzdC1lbnRyeS1lbmNyeXB0ZWQ=' },
        ],
      },
    });
    if (resp.status === 200 || resp.status === 201) {
      const data = await extractData(resp);
      adminSnapshotId = data?.id ?? data?.snapshot_id ?? null;
    }
  });

  it('regular user cannot read admin snapshot by ID', async () => {
    if (!adminSnapshotId) return;
    const resp = await apiRequest('GET', `/snapshots.php`, {
      params: { id: adminSnapshotId },
      role: 'regular',
    });
    expect([403, 404]).toContain(resp.status);
  });

  // Cleanup
  it('cleanup: admin deletes test snapshot', async () => {
    if (!adminSnapshotId) return;
    await api.delete(`/snapshots.php?id=${adminSnapshotId}`);
  });
});

// ---------------------------------------------------------------------------
// 10. Update Soft-Deleted Entry
// ---------------------------------------------------------------------------
describe('update soft-deleted entry', () => {
  let deletedEntryId = null;

  beforeAll(async () => {
    // Admin creates a vault entry
    const createResp = await api.post('/vault.php', {
      json: {
        entry_type: 'password',
        template_id: 1,
        encrypted_data: 'dGVzdC1zb2Z0LWRlbA==',
      },
    });
    if (createResp.status === 201) {
      const data = await extractData(createResp);
      deletedEntryId = data.id;
      // Soft-delete it
      await api.delete(`/vault.php?id=${deletedEntryId}`);
    }
  });

  it('PUT update on a soft-deleted entry returns 404', async () => {
    if (!deletedEntryId) return;
    const resp = await api.put(`/vault.php?id=${deletedEntryId}`, {
      json: {
        entry_type: 'password',
        template_id: 1,
        encrypted_data: 'dXBkYXRlZC1kZWxldGVk',
      },
    });
    expect(resp.status).toBe(404);
  });

  // Cleanup: restore the soft-deleted entry so it becomes visible, then delete it again.
  // Without this the row accumulates across test runs (deleted_at is set, never cleared).
  it('cleanup: restore then delete soft-deleted test entry', async () => {
    if (!deletedEntryId) return;
    await api.post(`/vault.php?action=restore&id=${deletedEntryId}`, {});
    await api.delete(`/vault.php?id=${deletedEntryId}`);
  });
});

// ---------------------------------------------------------------------------
// 11. Cross-User Bulk-Update
// ---------------------------------------------------------------------------
describe('cross-user bulk-update', () => {
  let adminEntryIdForBulk = null;
  const originalEncryptedData = 'YWRtaW4tYnVsay10ZXN0';

  beforeAll(async () => {
    // Admin creates an entry to use as the bulk-update target
    const resp = await api.post('/vault.php', {
      json: {
        entry_type: 'password',
        template_id: 1,
        encrypted_data: originalEncryptedData,
      },
    });
    if (resp.status === 201) {
      const data = await extractData(resp);
      adminEntryIdForBulk = data.id;
    }
  });

  it('regular user bulk-update does not modify admin entry', async () => {
    if (!adminEntryIdForBulk) return;

    // Regular user attempts to bulk-update admin's entry
    await apiRequest('POST', '/vault.php', {
      params: { action: 'bulk-update' },
      json: {
        entries: [
          {
            id: adminEntryIdForBulk,
            entry_type: 'password',
            template_id: 1,
            encrypted_data: 'aGFja2VkLWJ1bGs=',
          },
        ],
      },
      role: 'regular',
    });

    // Verify admin's entry is unchanged by reading it as admin.
    // A 404 here would mean the bulk-update destroyed the entry — a security failure.
    const checkResp = await api.get('/vault.php', {
      params: { id: adminEntryIdForBulk },
    });
    expect(checkResp.status).toBe(200);
    const entry = await extractData(checkResp);
    expect(entry.encrypted_data).toBe(originalEncryptedData);
  });

  // Cleanup
  it('cleanup: admin deletes bulk-update test entry', async () => {
    if (!adminEntryIdForBulk) return;
    await api.delete(`/vault.php?id=${adminEntryIdForBulk}`);
  });
});
