/**
 * Account Detail Templates API Integration Tests
 *
 * Tests account-detail-templates.php: CRUD for per-user and global
 * account detail field templates.
 *
 * Endpoints:
 *   GET    — returns user's personal templates + all global templates
 *   POST   — upserts a template (personal or global scope)
 *   DELETE  — deletes a template by ID (ownership / admin check)
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, apiRequest, extractData, unauthRequest } from '../helpers/apiClient.js';

const ENDPOINT = '/account-detail-templates.php';

// Helper: make requests as regular (non-admin) user
const regularApi = {
  get: (path, opts = {}) => apiRequest('GET', path, { ...opts, role: 'regular' }),
  post: (path, opts = {}) => apiRequest('POST', path, { ...opts, role: 'regular' }),
  delete: (path, opts = {}) => apiRequest('DELETE', path, { ...opts, role: 'regular' }),
};

describe('Account Detail Templates API', () => {
  // Track IDs created during tests for cleanup
  const createdIds = [];
  let personalTemplateId = null;
  let globalTemplateId = null;

  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', ENDPOINT);
      expect(resp.status).toBe(401);
    });

    it('POST returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', ENDPOINT, {
        json: { account_type_id: 1, country_id: 1, field_keys: ['sort_code'] },
      });
      expect(resp.status).toBe(401);
    });

    it('DELETE returns 401 without auth', async () => {
      const resp = await unauthRequest('DELETE', `${ENDPOINT}?id=1`);
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET — list templates
  // -----------------------------------------------------------------------
  describe('GET templates', () => {
    it('returns array of templates', async () => {
      const resp = await api.get(ENDPOINT);
      expect(resp.status).toBe(200);

      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
    });

    it('does not expose user_id in response', async () => {
      // Create a template so there's at least one result
      const createResp = await api.post(ENDPOINT, {
        json: { account_type_id: 1, country_id: 1, field_keys: ['sort_code'] },
      });
      const createData = await extractData(createResp);
      if (createData?.id) createdIds.push(createData.id);

      const resp = await api.get(ENDPOINT);
      expect(resp.status).toBe(200);

      const data = await extractData(resp);
      expect(data.length).toBeGreaterThan(0);
      for (const tpl of data) {
        expect(tpl).not.toHaveProperty('user_id');
      }
    });

    it('each template has expected fields', async () => {
      const resp = await api.get(ENDPOINT);
      const data = await extractData(resp);

      if (data.length > 0) {
        const tpl = data[0];
        expect(tpl).toHaveProperty('id');
        expect(tpl).toHaveProperty('account_type_id');
        expect(tpl).toHaveProperty('country_id');
        expect(tpl).toHaveProperty('is_global');
        expect(tpl).toHaveProperty('field_keys');
        expect(Array.isArray(tpl.field_keys)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // POST — create personal template
  // -----------------------------------------------------------------------
  describe('POST create template (personal)', () => {
    it('creates personal template with valid data', async () => {
      const resp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 2,
          country_id: 1,
          field_keys: ['account_number', 'routing_number'],
        },
      });
      expect(resp.status).toBe(201);

      const data = await extractData(resp);
      expect(data).toHaveProperty('id');
      expect(typeof data.id).toBe('number');
      personalTemplateId = data.id;
      createdIds.push(data.id);
    });

    it('returns 400 when account_type_id missing', async () => {
      const resp = await api.post(ENDPOINT, {
        json: { country_id: 1, field_keys: ['sort_code'] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when country_id missing', async () => {
      const resp = await api.post(ENDPOINT, {
        json: { account_type_id: 1, field_keys: ['sort_code'] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when field_keys empty', async () => {
      const resp = await api.post(ENDPOINT, {
        json: { account_type_id: 1, country_id: 1, field_keys: [] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when field_keys not an array', async () => {
      const resp = await api.post(ENDPOINT, {
        json: { account_type_id: 1, country_id: 1, field_keys: 'sort_code' },
      });
      expect(resp.status).toBe(400);
    });

    it('standardizes field keys (camelCase to snake_case)', async () => {
      const resp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 3,
          country_id: 1,
          field_keys: ['sortCode', 'Account Number', 'swift-code'],
        },
      });
      expect(resp.status).toBe(201);

      const data = await extractData(resp);
      createdIds.push(data.id);

      // Verify the keys were standardized by fetching back
      const getResp = await api.get(ENDPOINT);
      const templates = await extractData(getResp);
      const created = templates.find((t) => t.id === data.id);
      expect(created).toBeDefined();
      expect(created.field_keys).toContain('sort_code');
      expect(created.field_keys).toContain('account_number');
      expect(created.field_keys).toContain('swift_code');
    });

    it('deduplicates field_keys', async () => {
      const resp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 4,
          country_id: 1,
          field_keys: ['sort_code', 'sortCode', 'Sort Code', 'sort-code'],
        },
      });
      expect(resp.status).toBe(201);

      const data = await extractData(resp);
      createdIds.push(data.id);

      // All variants normalize to "sort_code" — should deduplicate to 1
      const getResp = await api.get(ENDPOINT);
      const templates = await extractData(getResp);
      const created = templates.find((t) => t.id === data.id);
      expect(created).toBeDefined();
      expect(created.field_keys).toEqual(['sort_code']);
    });

    it('upserts on same (account_type_id, subtype, country_id)', async () => {
      // Create initial template
      const resp1 = await api.post(ENDPOINT, {
        json: {
          account_type_id: 5,
          country_id: 1,
          field_keys: ['iban'],
        },
      });
      expect(resp1.status).toBe(201);
      const data1 = await extractData(resp1);
      createdIds.push(data1.id);

      // Upsert with same key combo but different field_keys
      const resp2 = await api.post(ENDPOINT, {
        json: {
          account_type_id: 5,
          country_id: 1,
          field_keys: ['iban', 'bic'],
        },
      });
      expect(resp2.status).toBe(201);
      const data2 = await extractData(resp2);
      // ON DUPLICATE KEY UPDATE: the id may be 0 or the original id depending on MySQL behavior
      // but we should have only one row for this combo
      if (data2.id && data2.id !== data1.id) createdIds.push(data2.id);

      // Verify only one template exists for this combo
      const getResp = await api.get(ENDPOINT);
      const templates = await extractData(getResp);
      const matching = templates.filter(
        (t) => t.account_type_id === 5 && t.country_id === 1 && t.is_global === 0
      );
      expect(matching.length).toBe(1);
      expect(matching[0].field_keys).toContain('iban');
      expect(matching[0].field_keys).toContain('bic');
    });
  });

  // -----------------------------------------------------------------------
  // POST — create global template (admin only)
  // -----------------------------------------------------------------------
  describe('POST create template (global — admin only)', () => {
    it('admin can create global template', async () => {
      const resp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 6,
          country_id: 1,
          field_keys: ['sort_code', 'account_number'],
          scope: 'global',
        },
      });
      expect(resp.status).toBe(201);

      const data = await extractData(resp);
      expect(data).toHaveProperty('id');
      expect(typeof data.id).toBe('number');
      globalTemplateId = data.id;
      createdIds.push(data.id);

      // Verify it is marked as global
      const getResp = await api.get(ENDPOINT);
      const templates = await extractData(getResp);
      const created = templates.find((t) => t.id === globalTemplateId);
      expect(created).toBeDefined();
      expect(created.is_global).toBe(1);
    });

    it('non-admin gets 403 for global scope', async () => {
      const resp = await regularApi.post(ENDPOINT, {
        json: {
          account_type_id: 7,
          country_id: 1,
          field_keys: ['sort_code'],
          scope: 'global',
        },
      });
      expect(resp.status).toBe(403);
    });
  });

  // -----------------------------------------------------------------------
  // DELETE — remove a template
  // -----------------------------------------------------------------------
  describe('DELETE template', () => {
    let deletePersonalId = null;
    let deleteGlobalId = null;

    it('returns 400 when id missing', async () => {
      const resp = await api.delete(ENDPOINT);
      expect(resp.status).toBe(400);
    });

    it('returns 404 for non-existent template', async () => {
      const resp = await api.delete(ENDPOINT, { params: { id: '999999' } });
      expect(resp.status).toBe(404);
    });

    it('deletes own personal template', async () => {
      // Create a template specifically for deletion
      const createResp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 8,
          country_id: 1,
          field_keys: ['to_delete'],
        },
      });
      expect(createResp.status).toBe(201);
      const createData = await extractData(createResp);
      deletePersonalId = createData.id;

      // Delete it
      const resp = await api.delete(ENDPOINT, { params: { id: String(deletePersonalId) } });
      expect(resp.status).toBe(200);

      const data = await extractData(resp);
      expect(data.id).toBe(deletePersonalId);

      // Verify it no longer appears in GET
      const getResp = await api.get(ENDPOINT);
      const templates = await extractData(getResp);
      const found = templates.find((t) => t.id === deletePersonalId);
      expect(found).toBeUndefined();
    });

    it('admin can delete global template', async () => {
      // Create a global template for deletion
      const createResp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 9,
          country_id: 1,
          field_keys: ['global_delete_test'],
          scope: 'global',
        },
      });
      expect(createResp.status).toBe(201);
      const createData = await extractData(createResp);
      deleteGlobalId = createData.id;

      // Admin deletes it
      const resp = await api.delete(ENDPOINT, { params: { id: String(deleteGlobalId) } });
      expect(resp.status).toBe(200);

      const data = await extractData(resp);
      expect(data.id).toBe(deleteGlobalId);
    });

    it('non-admin gets 403 for global template delete', async () => {
      // Create a global template that the regular user should not be able to delete
      const createResp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 10,
          country_id: 1,
          field_keys: ['no_regular_delete'],
          scope: 'global',
        },
      });
      expect(createResp.status).toBe(201);
      const createData = await extractData(createResp);
      const protectedId = createData.id;
      createdIds.push(protectedId);

      // Regular user tries to delete it — should get 403
      const resp = await regularApi.delete(ENDPOINT, { params: { id: String(protectedId) } });
      expect(resp.status).toBe(403);
    });

    it('non-admin cannot delete another user personal template (returns 404)', async () => {
      // Admin creates a personal template
      const createResp = await api.post(ENDPOINT, {
        json: {
          account_type_id: 11,
          country_id: 1,
          field_keys: ['admin_personal'],
        },
      });
      expect(createResp.status).toBe(201);
      const createData = await extractData(createResp);
      const adminPersonalId = createData.id;
      createdIds.push(adminPersonalId);

      // Regular user tries to delete it — should get 404 (prevents enumeration)
      const resp = await regularApi.delete(ENDPOINT, { params: { id: String(adminPersonalId) } });
      expect(resp.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup: delete all templates created during tests
  // -----------------------------------------------------------------------
  afterAll(async () => {
    for (const id of createdIds) {
      try {
        await api.delete(ENDPOINT, { params: { id: String(id) } });
      } catch {
        // Ignore errors — template may have been deleted during test
      }
    }
  });
});
