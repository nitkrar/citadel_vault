import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, unauthRequest } from '../helpers/apiClient.js';

describe('Templates API — /templates.php', () => {
  // Track template IDs created during tests for afterAll cleanup
  let _updateTemplateId;
  let _requestPromoTemplateId;
  let _approvePromoTemplateId;
  let _approvePromoTemplateKey;

  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('GET returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/templates.php');
      expect(resp.status).toBe(401);
    });

    it('POST create returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/templates.php', {
        params: { action: 'create' },
        json: { template_key: 'test', name: 'Test', fields: [{ key: 'f', label: 'F', type: 'text' }] },
      });
      expect(resp.status).toBe(401);
    });

    it('PUT update returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/templates.php', {
        params: { action: 'update', id: '1' },
        json: { name: 'Updated' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET — list templates
  // -----------------------------------------------------------------------
  describe('GET (list templates)', () => {
    it('returns an array of templates', async () => {
      const resp = await api.get('/templates.php');
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('each template has required fields', async () => {
      const resp = await api.get('/templates.php');
      const data = await api.data(resp);

      const first = data[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('template_key');
      expect(first).toHaveProperty('fields');
    });

    it('includes global templates (owner_id is null)', async () => {
      const resp = await api.get('/templates.php');
      const data = await api.data(resp);

      // At least some templates should be global (no owner_id or owner_id = null)
      const global = data.filter((t) => !t.owner_id);
      expect(global.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // POST ?action=create — create custom template
  // -----------------------------------------------------------------------
  describe('POST ?action=create', () => {
    const testTemplate = {
      template_key: 'test_custom_' + Date.now(),
      name: 'Test Custom Template',
      icon: 'test-icon',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'notes', label: 'Notes', type: 'textarea', required: false },
      ],
    };

    it('creates a custom template with valid data', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: testTemplate,
      });
      expect(resp.status).toBe(201);

      const data = await api.data(resp);
      expect(data).toHaveProperty('id');
      expect(typeof data.id).toBe('number');
    });

    it('returns 400 when template_key is missing', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: { name: 'No Key', fields: [{ key: 'f', label: 'F', type: 'text' }] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when name is missing', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: { template_key: 'noname', fields: [{ key: 'f', label: 'F', type: 'text' }] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when fields is missing', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: { template_key: 'nofields', name: 'No Fields' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when fields is empty array', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: { template_key: 'emptyfields', name: 'Empty Fields', fields: [] },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when fields is not an array', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: { template_key: 'badfields', name: 'Bad Fields', fields: 'not-array' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // PUT ?action=update — update a custom template
  // -----------------------------------------------------------------------
  describe('PUT ?action=update', () => {
    let customTemplateId;

    beforeAll(async () => {
      // Create a template to update
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: {
          template_key: 'update_test_' + Date.now(),
          name: 'To Be Updated',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      });
      const data = await api.data(resp);
      customTemplateId = data.id;
      _updateTemplateId = data.id;
    });

    it('updates name of own custom template', async () => {
      const resp = await api.put('/templates.php', {
        params: { action: 'update', id: String(customTemplateId) },
        json: { name: 'Updated Name' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.message).toBe('Template updated.');
    });

    it('updates icon of own custom template', async () => {
      const resp = await api.put('/templates.php', {
        params: { action: 'update', id: String(customTemplateId) },
        json: { icon: 'new-icon' },
      });
      expect(resp.status).toBe(200);
    });

    it('updates fields of own custom template', async () => {
      const resp = await api.put('/templates.php', {
        params: { action: 'update', id: String(customTemplateId) },
        json: {
          fields: [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'url', label: 'URL', type: 'url' },
          ],
        },
      });
      expect(resp.status).toBe(200);
    });

    it('returns 400 when no update fields provided', async () => {
      const resp = await api.put('/templates.php', {
        params: { action: 'update', id: String(customTemplateId) },
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 404 for non-existent template', async () => {
      const resp = await api.put('/templates.php', {
        params: { action: 'update', id: '999999' },
        json: { name: 'Ghost' },
      });
      expect(resp.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST ?action=relink — move entries between templates
  // -----------------------------------------------------------------------
  describe('POST ?action=relink', () => {
    it('returns 400 when old_template_id is missing', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'relink' },
        json: { new_template_id: 1 },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 when new_template_id is missing', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'relink' },
        json: { old_template_id: 1 },
      });
      expect(resp.status).toBe(400);
    });

    it('succeeds with valid template IDs (may update 0 rows)', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'relink' },
        json: { old_template_id: 999998, new_template_id: 999999 },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data).toHaveProperty('updated');
      expect(typeof data.updated).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // POST ?action=request-promotion — request template promotion
  // -----------------------------------------------------------------------
  describe('POST ?action=request-promotion', () => {
    let promotionTemplateId;

    beforeAll(async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: {
          template_key: 'promote_test_' + Date.now(),
          name: 'Promotion Candidate',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      });
      const data = await api.data(resp);
      promotionTemplateId = data.id;
      _requestPromoTemplateId = data.id;
    });

    it('requests promotion for own template', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'request-promotion', id: String(promotionTemplateId) },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.message).toBe('Promotion requested.');
    });

    it('returns 404 for non-existent template', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'request-promotion', id: '999999' },
      });
      expect(resp.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST ?action=approve-promotion — admin approves promotion
  // -----------------------------------------------------------------------
  describe('POST ?action=approve-promotion', () => {
    let promotionTemplateId;

    beforeAll(async () => {
      // Create and request promotion
      _approvePromoTemplateKey = 'approve_test_' + Date.now();
      const createResp = await api.post('/templates.php', {
        params: { action: 'create' },
        json: {
          template_key: _approvePromoTemplateKey,
          name: 'Approval Candidate',
          fields: [{ key: 'title', label: 'Title', type: 'text' }],
        },
      });
      const createData = await api.data(createResp);
      promotionTemplateId = createData.id;
      _approvePromoTemplateId = createData.id;

      // Request promotion
      await api.post('/templates.php', {
        params: { action: 'request-promotion', id: String(promotionTemplateId) },
      });
    });

    it('admin approves a pending promotion', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'approve-promotion', id: String(promotionTemplateId) },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data).toHaveProperty('global_template_id');
      expect(typeof data.global_template_id).toBe('number');
      expect(data.message).toBe('Template promoted to global.');
    });

    it('returns 404 for template not pending promotion', async () => {
      // The same template was already approved, so it should not be pending
      const resp = await api.post('/templates.php', {
        params: { action: 'approve-promotion', id: String(promotionTemplateId) },
      });
      expect(resp.status).toBe(404);
    });

    it('returns 404 for non-existent template', async () => {
      const resp = await api.post('/templates.php', {
        params: { action: 'approve-promotion', id: '999999' },
      });
      expect(resp.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid action
  // -----------------------------------------------------------------------
  describe('invalid action', () => {
    it('returns 400 for unknown action', async () => {
      const resp = await api.get('/templates.php', {
        params: { action: 'nonexistent' },
      });
      expect(resp.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup — delete templates created during tests
  // -----------------------------------------------------------------------
  afterAll(async () => {
    const ids = [_updateTemplateId, _requestPromoTemplateId, _approvePromoTemplateId].filter(Boolean);
    for (const id of ids) {
      try {
        await api.delete(`/templates.php?id=${id}`);
      } catch (_) {
        // ignore
      }
    }

    // Delete the global copy created by approve-promotion (owner_id = NULL)
    if (_approvePromoTemplateKey) {
      try {
        const listResp = await api.get('/templates.php');
        if (listResp.ok) {
          const templates = await api.data(listResp);
          const globalCopy = Array.isArray(templates)
            ? templates.find((t) => t.template_key === _approvePromoTemplateKey && !t.owner_id)
            : null;
          if (globalCopy) {
            await api.delete(`/templates.php?id=${globalCopy.id}`);
          }
        }
      } catch (_) {
        // ignore
      }
    }
  });
});
