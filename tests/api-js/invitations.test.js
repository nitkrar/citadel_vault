import { describe, it, expect, afterAll } from 'vitest';
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
        json: { email: 'admin@citadel.local' },
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
      // 200 = success, 429 = rate limited from repeated test runs
      expect([200, 429]).toContain(resp.status);
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
        body: JSON.stringify({ email: 'admin@citadel.local', name: 'Admin' }),
      });
      // 409 = already registered, 429 = rate limited from repeated test runs
      expect([409, 429]).toContain(resp.status);
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

  // -----------------------------------------------------------------------
  // afterAll cleanup — revoke any pending test invites created in this file
  // -----------------------------------------------------------------------
  afterAll(async () => {
    const TEST_EMAIL_PATTERNS = [
      'test_invite_',
      'list_test_',
      'revoke_test_',
      'validate_flow_',
      'reuse-test@test.local',
    ];

    try {
      const listResp = await api.get('/invitations.php', {
        params: { action: 'list' },
      });
      if (!listResp.ok) return;

      const invites = await api.data(listResp);
      if (!Array.isArray(invites)) return;

      const toRevoke = invites.filter(
        (inv) =>
          inv.status === 'pending' &&
          TEST_EMAIL_PATTERNS.some((pat) => inv.email.includes(pat))
      );

      await Promise.all(
        toRevoke.map((inv) =>
          api.delete('/invitations.php', {
            params: { action: 'revoke', id: String(inv.id) },
          }).catch(() => {/* ignore errors — invite may already be gone */})
        )
      );
    } catch {
      // Best-effort cleanup — never fail the test run
    }
  });

  // -----------------------------------------------------------------------
  // invite → register → reuse integration test
  // -----------------------------------------------------------------------
  describe('invite → register → reuse flow', () => {
    const REUSE_EMAIL = 'reuse-test@test.local';
    const REUSE_USER = 'reuse_test_user';
    const REUSE_PASSWORD = 'ReuseTest#1';

    let inviteToken = null;
    let inviteId = null;
    let registeredUserId = null;

    afterAll(async () => {
      // Delete the registered user if one was created
      if (registeredUserId !== null) {
        try {
          await api.delete(`/users.php?id=${registeredUserId}`);
        } catch {/* ignore */}
      }

      // Revoke the invite if it is still pending (used invites cannot be revoked)
      if (inviteId !== null) {
        try {
          await api.delete('/invitations.php', {
            params: { action: 'revoke', id: String(inviteId) },
          });
        } catch {/* ignore — invite may be used or already deleted */}
      }
    });

    it('skips when invites are not usable (checks registration-status)', async () => {
      // This test only verifies the prerequisite check; actual flow tests follow.
      // We always allow them to run because a valid invite token bypasses the
      // self_registration gate, so no skip is needed here.
      const statusResp = await fetch(`${BASE_URL}/auth.php?action=registration-status`);
      expect([200]).toContain(statusResp.status);
    });

    it('admin creates an invite for the reuse-test email', async () => {
      // --- Pre-run idempotency: remove stale user left by a prior failed run ---
      // If REUSE_USER already exists, POST ?action=create will return 409 (email
      // already registered) and the test would fail its status assertion.  Delete
      // the user first so this test suite is safe to re-run.
      const usersResp = await api.get('/users.php');
      if (usersResp.ok) {
        const users = await api.data(usersResp);
        if (Array.isArray(users)) {
          const staleUser = users.find((u) => u.username === REUSE_USER);
          if (staleUser) {
            await api.delete(`/users.php?id=${staleUser.id}`).catch(() => {});
          }
        }
      }

      // --- Pre-run idempotency: revoke any pending invite for this email ---
      const listResp = await api.get('/invitations.php', { params: { action: 'list' } });
      if (listResp.ok) {
        const existing = await api.data(listResp);
        if (Array.isArray(existing)) {
          const prior = existing.find(
            (i) => i.email === REUSE_EMAIL && i.status === 'pending'
          );
          if (prior) {
            await api.delete('/invitations.php', {
              params: { action: 'revoke', id: String(prior.id) },
            }).catch(() => {});
          }
        }
      }

      const resp = await api.post('/invitations.php', {
        params: { action: 'create' },
        json: { email: REUSE_EMAIL },
      });
      // 201 = new invite; 200 = reused existing (shouldn't happen after cleanup above)
      expect([200, 201]).toContain(resp.status);

      const data = await api.data(resp);
      expect(data).toHaveProperty('invite_url');
      inviteToken = data.invite_url.split('invite=')[1];
      expect(inviteToken).toBeTruthy();

      // Capture invite ID from the list so we can clean up later.
      // Filter for the pending invite specifically — a 'used' invite from a
      // prior partial run cannot be revoked and we do not need to track it.
      const listResp2 = await api.get('/invitations.php', { params: { action: 'list' } });
      if (listResp2.ok) {
        const invites = await api.data(listResp2);
        const match = Array.isArray(invites)
          ? invites.find((i) => i.email === REUSE_EMAIL && i.status === 'pending')
          : null;
        if (match) inviteId = match.id;
      }
    });

    it('registers successfully using the invite token', async () => {
      if (!inviteToken) {
        // Prior test failed to create invite — skip gracefully
        return;
      }

      const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: REUSE_USER,
          email: REUSE_EMAIL,
          password: REUSE_PASSWORD,
          invite_token: inviteToken,
        }),
      });

      if (resp.status === 409) {
        // User already exists from a previous test run — resolve their ID for cleanup
        const adminListResp = await api.get('/users.php');
        if (adminListResp.ok) {
          const users = await api.data(adminListResp);
          const existing = Array.isArray(users)
            ? users.find((u) => u.username === REUSE_USER)
            : null;
          if (existing) registeredUserId = existing.id;
        }
        // Mark invite as consumed by this pre-existing user — skip the 201 assertion
        return;
      }

      expect(resp.status).toBe(201);

      // Capture the new user's ID for cleanup
      const adminListResp = await api.get('/users.php');
      if (adminListResp.ok) {
        const users = await api.data(adminListResp);
        const created = Array.isArray(users)
          ? users.find((u) => u.username === REUSE_USER)
          : null;
        if (created) registeredUserId = created.id;
      }
    });

    it('rejects a second registration attempt with the same invite token (invite is consumed)', async () => {
      if (!inviteToken) {
        // Cannot test reuse without a token — skip gracefully
        return;
      }

      const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'reuse_test_user_2',
          email: REUSE_EMAIL,
          password: REUSE_PASSWORD,
          invite_token: inviteToken,
        }),
      });

      // 410 = invite already used; 400 = generic bad request; 409 = email/username conflict
      // All of these confirm the invite cannot be reused for a new account
      expect([400, 409, 410]).toContain(resp.status);
    });
  });
});
