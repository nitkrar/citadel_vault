import { describe, it, expect } from 'vitest';
import { api, unauthRequest, BASE_URL } from '../helpers/apiClient.js';

describe('Invitations API — /invitations.php', () => {
  // -----------------------------------------------------------------------
  // Auth enforcement
  // -----------------------------------------------------------------------
  describe('auth enforcement', () => {
    it('POST ?action=create returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/invitations.php', {
        params: { action: 'create' },
        json: { email: 'test@example.com' },
      });
      expect(resp.status).toBe(401);
    });

    it('GET ?action=list returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/invitations.php', {
        params: { action: 'list' },
      });
      expect(resp.status).toBe(401);
    });

    it('DELETE ?action=revoke returns 401 without auth', async () => {
      const resp = await unauthRequest('DELETE', '/invitations.php', {
        params: { action: 'revoke', id: '1' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // GET ?action=validate — public endpoint (no auth required)
  // -----------------------------------------------------------------------
  describe('GET ?action=validate (public)', () => {
    it('returns 400 when token is missing', async () => {
      const resp = await fetch(`${BASE_URL}/invitations.php?action=validate`);
      expect(resp.status).toBe(400);
    });

    it('returns 404 for invalid token', async () => {
      const resp = await fetch(
        `${BASE_URL}/invitations.php?action=validate&token=nonexistent_token_abc123`
      );
      expect(resp.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST ?action=create — create invite
  // -----------------------------------------------------------------------
  describe('POST ?action=create', () => {
    const uniqueEmail = `test_invite_${Date.now()}@example.com`;

    it('creates an invite with valid email', async () => {
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: uniqueEmail },
      });
      expect(resp.status).toBe(201);

      const data = await api.data(resp);
      expect(data).toHaveProperty('invite_url');
      expect(data).toHaveProperty('email', uniqueEmail);
      expect(data).toHaveProperty('expires_at');
      expect(data).toHaveProperty('reused');
      expect(data.reused).toBe(false);
      expect(data.invite_url).toContain('register?invite=');
    });

    it('returns existing invite for duplicate email (reused=true)', async () => {
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: uniqueEmail },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.reused).toBe(true);
      expect(data.email).toBe(uniqueEmail);
    });

    it('returns 400 for missing email', async () => {
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for empty email', async () => {
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: '' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid email format', async () => {
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: 'not-an-email' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 409 for already-registered email', async () => {
      // The admin user email should already exist
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: 'admin@example.com' },
      });
      expect(resp.status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // GET ?action=list — list invites
  // -----------------------------------------------------------------------
  describe('GET ?action=list', () => {
    it('returns an array of invites', async () => {
      const resp = await api.get('/invitations.php', {
        params: { action: 'list' },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(Array.isArray(data)).toBe(true);
    });

    it('each invite has required fields', async () => {
      // Ensure at least one invite exists
      await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: `list_test_${Date.now()}@example.com` },
      });

      const resp = await api.get('/invitations.php', {
        params: { action: 'list' },
      });
      const data = await api.data(resp);
      expect(data.length).toBeGreaterThan(0);

      const invite = data[0];
      expect(invite).toHaveProperty('id');
      expect(invite).toHaveProperty('email');
      expect(invite).toHaveProperty('expires_at');
      expect(invite).toHaveProperty('created_at');
      expect(invite).toHaveProperty('status');
    });

    it('invite status is one of pending, used, expired', async () => {
      const resp = await api.get('/invitations.php', {
        params: { action: 'list' },
      });
      const data = await api.data(resp);

      for (const invite of data) {
        expect(['pending', 'used', 'expired']).toContain(invite.status);
      }
    });

    it('admin sees invited_by_username field', async () => {
      const resp = await api.get('/invitations.php', {
        params: { action: 'list' },
      });
      const data = await api.data(resp);

      if (data.length > 0) {
        // Admin list includes invited_by_username
        expect(data[0]).toHaveProperty('invited_by_username');
      }
    });
  });

  // -----------------------------------------------------------------------
  // DELETE ?action=revoke — revoke an invite
  // -----------------------------------------------------------------------
  describe('DELETE ?action=revoke', () => {
    let revokeInviteId;

    it('creates an invite to revoke', async () => {
      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: `revoke_test_${Date.now()}@example.com` },
      });
      expect(resp.status).toBeGreaterThanOrEqual(200);
      expect(resp.status).toBeLessThan(300);

      // Get the invite ID from the list
      const listResp = await api.get('/invitations.php', {
        params: { action: 'list' },
      });
      const invites = await api.data(listResp);
      const latest = invites.find((i) => i.status === 'pending');
      expect(latest).toBeDefined();
      revokeInviteId = latest.id;
    });

    it('revokes a pending invite', async () => {
      const resp = await api.delete('/invitations.php', {
        params: { action: 'revoke', id: String(revokeInviteId) },
      });
      expect(resp.status).toBe(200);

      const data = await api.data(resp);
      expect(data.message).toBe('Invite revoked.');
    });

    it('returns 400 when id is missing', async () => {
      const resp = await api.delete('/invitations.php', {
        params: { action: 'revoke' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 404 for non-existent invite', async () => {
      const resp = await api.delete('/invitations.php', {
        params: { action: 'revoke', id: '999999' },
      });
      expect(resp.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // POST ?action=request — public invite request (no auth)
  // -----------------------------------------------------------------------
  describe('POST ?action=request (public)', () => {
    it('submits an invite request with valid email', async () => {
      const resp = await fetch(`${BASE_URL}/invitations.php?action=request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `request_test_${Date.now()}@example.com`,
          name: 'Test Requester',
        }),
      });
      expect(resp.status).toBe(200);

      const body = await resp.json();
      const data = body?.data ?? body;
      expect(data).toHaveProperty('message');
    });

    it('returns 400 for missing email', async () => {
      const resp = await fetch(`${BASE_URL}/invitations.php?action=request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Email' }),
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for invalid email', async () => {
      const resp = await fetch(`${BASE_URL}/invitations.php?action=request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bad-email', name: 'Bad' }),
      });
      expect(resp.status).toBe(400);
    });

    it('returns 409 for already-registered email', async () => {
      const resp = await fetch(`${BASE_URL}/invitations.php?action=request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', name: 'Admin' }),
      });
      expect(resp.status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // Validate created invite token
  // -----------------------------------------------------------------------
  describe('validate flow — create then validate', () => {
    it('validates a freshly created invite token', async () => {
      const email = `validate_flow_${Date.now()}@example.com`;

      // Create
      const createResp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email },
      });
      const createData = await api.data(createResp);
      const token = createData.invite_url.split('invite=')[1];
      expect(token).toBeTruthy();

      // Validate (public, no auth)
      const validateResp = await fetch(
        `${BASE_URL}/invitations.php?action=validate&token=${token}`
      );
      expect(validateResp.status).toBe(200);

      const validateBody = await validateResp.json();
      const validateData = validateBody?.data ?? validateBody;
      expect(validateData.email).toBe(email);
      expect(validateData).toHaveProperty('invited_by');
      expect(validateData).toHaveProperty('expires_at');
    });
  });

  // -----------------------------------------------------------------------
  // Invalid action
  // -----------------------------------------------------------------------
  describe('invalid action', () => {
    it('returns 400 for unknown action', async () => {
      const resp = await api.get('/invitations.php', {
        params: { action: 'nonexistent' },
      });
      expect(resp.status).toBe(400);
    });
  });
});
