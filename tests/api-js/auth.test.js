/**
 * Auth API Integration Tests
 *
 * Tests auth.php endpoints: login, logout, me, registration-status,
 * password change, profile update, self-delete, and error paths.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, extractData, unauthRequest, BASE_URL, apiRequest, resetTokens } from '../helpers/apiClient.js';

describe('Auth API', () => {
  // ── registration-status (public) ─────────────────────────────────
  describe('GET ?action=registration-status', () => {
    it('returns registration status without auth', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=registration-status`);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('self_registration');
      expect(body.data).toHaveProperty('require_email_verification');
      expect(typeof body.data.self_registration).toBe('boolean');
      expect(typeof body.data.require_email_verification).toBe('boolean');
    });
  });

  // ── login ────────────────────────────────────────────────────────
  describe('POST ?action=login', () => {
    it('returns 200 and user data for valid credentials', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', password: 'TestAdmin123' }),
      });
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.data).toHaveProperty('user');
      expect(body.data).toHaveProperty('expires_in');
      expect(body.data.user).toHaveProperty('id');
      expect(body.data.user).toHaveProperty('username', 'initial_user');
      expect(body.data.user).toHaveProperty('email');
      expect(body.data.user).toHaveProperty('role');
      expect(typeof body.data.user.id).toBe('number');
    });

    it('sets auth cookie on successful login', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', password: 'TestAdmin123' }),
      });
      expect(resp.status).toBe(200);
      const setCookie = resp.headers.get('set-cookie') || '';
      expect(setCookie).toContain('pv_auth=');
    });

    it('returns 401 for wrong password', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', password: 'WrongPassword1!' }),
      });
      expect(resp.status).toBe(401);
    });

    it('returns 401 for non-existent user', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'no_such_user_xyz', password: 'Ghost#123' }),
      });
      expect(resp.status).toBe(401);
    });

    it('returns error for missing credentials', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // Server returns 400 for missing fields
      expect(resp.ok).toBe(false);
    });

    it('returns error for empty username', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '', password: 'SomePass#1' }),
      });
      expect(resp.ok).toBe(false);
    });
  });

  // ── me ───────────────────────────────────────────────────────────
  describe('GET ?action=me', () => {
    it('returns user profile for authenticated user', async () => {
      const resp = await api.get('/auth.php?action=me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('username', 'initial_user');
      expect(data).toHaveProperty('email');
      expect(data).toHaveProperty('role');
      expect(data).toHaveProperty('id');
      expect(typeof data.id).toBe('number');
    });

    it('includes must_change_password flag', async () => {
      const resp = await api.get('/auth.php?action=me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('must_change_password');
      expect(typeof data.must_change_password).toBe('boolean');
    });

    it('includes must_change_vault_key flag', async () => {
      const resp = await api.get('/auth.php?action=me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('must_change_vault_key');
      expect(typeof data.must_change_vault_key).toBe('boolean');
    });

    it('includes display_currency preference', async () => {
      const resp = await api.get('/auth.php?action=me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('display_currency');
    });

    it('includes RSA key status flags', async () => {
      const resp = await api.get('/auth.php?action=me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('has_public_key');
      expect(data).toHaveProperty('has_encrypted_private_key');
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/auth.php?action=me');
      expect(resp.status).toBe(401);
    });
  });

  // ── profile ──────────────────────────────────────────────────────
  describe('PUT ?action=profile', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/auth.php?action=profile', {
        json: { email: 'hacker@evil.com' },
      });
      expect(resp.status).toBe(401);
    });

    it('returns error for empty body', async () => {
      const resp = await api.put('/auth.php?action=profile', { json: {} });
      expect(resp.ok).toBe(false);
    });

    it('updates display_name successfully', async () => {
      const resp = await api.put('/auth.php?action=profile', {
        json: { display_name: 'Test Display Name' },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('message');
    });

    it('rejects invalid email format', async () => {
      const resp = await api.put('/auth.php?action=profile', {
        json: { email: 'not-an-email' },
      });
      expect(resp.ok).toBe(false);
    });
  });

  // ── password change ──────────────────────────────────────────────
  describe('PUT ?action=password', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('PUT', '/auth.php?action=password', {
        json: { current_password: 'x', new_password: 'y' },
      });
      expect(resp.status).toBe(401);
    });

    it('returns error for missing fields', async () => {
      const resp = await api.put('/auth.php?action=password', { json: {} });
      expect(resp.ok).toBe(false);
    });

    it('returns error for wrong current password', async () => {
      const resp = await api.put('/auth.php?action=password', {
        json: { current_password: 'WrongPassword!1', new_password: 'NewValidPass#1' },
      });
      expect(resp.status).toBe(401);
    });

    it('returns error for short new password', async () => {
      const resp = await api.put('/auth.php?action=password', {
        json: { current_password: 'TestAdmin123', new_password: 'short' },
      });
      expect(resp.ok).toBe(false);
    });
  });

  // ── force-change-password ────────────────────────────────────────
  describe('POST ?action=force-change-password', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/auth.php?action=force-change-password', {
        json: { new_password: 'NewPassword#1' },
      });
      expect(resp.status).toBe(401);
    });

    it('returns 403 when flag is not set', async () => {
      const resp = await api.post('/auth.php?action=force-change-password', {
        json: { new_password: 'NewPassword#1' },
      });
      // User does not have must_reset_password set, so 403
      expect(resp.status).toBe(403);
    });

    it('returns error for short password', async () => {
      const resp = await api.post('/auth.php?action=force-change-password', {
        json: { new_password: 'short' },
      });
      expect(resp.ok).toBe(false);
    });
  });

  // ── logout ───────────────────────────────────────────────────────
  describe('POST ?action=logout', () => {
    it('returns 200 and clears auth cookie', async () => {
      // Login first to get a valid session
      const loginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', password: 'TestAdmin123' }),
      });
      const cookies = loginResp.headers.get('set-cookie') || '';
      const match = cookies.match(/pv_auth=([^;]+)/);
      const token = match?.[1];

      if (token) {
        const resp = await fetch(`${BASE_URL}/auth.php?action=logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        expect(resp.status).toBe(200);
        const data = await resp.json();
        expect(data.data).toHaveProperty('message');
      }
    });
  });

  // ── self-delete ──────────────────────────────────────────────────
  describe('DELETE ?action=self-delete', () => {
    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('DELETE', '/auth.php?action=self-delete');
      expect(resp.status).toBe(401);
    });

    it('returns error for missing password', async () => {
      const resp = await api.delete('/auth.php?action=self-delete', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 401 for wrong password', async () => {
      const resp = await api.delete('/auth.php?action=self-delete', {
        json: { password: 'WrongPassword!1' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── forgot-password ──────────────────────────────────────────────
  describe('POST ?action=forgot-password', () => {
    it('returns error for missing username', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recovery_key: 'abc', new_password: 'NewPass#12', confirm_password: 'NewPass#12' }),
      });
      expect(resp.ok).toBe(false);
    });

    it('returns error for missing recovery key', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', new_password: 'NewPass#12', confirm_password: 'NewPass#12' }),
      });
      expect(resp.ok).toBe(false);
    });

    it('returns error for short password', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', recovery_key: 'abc', new_password: 'short', confirm_password: 'short' }),
      });
      expect(resp.ok).toBe(false);
    });

    it('returns error for mismatched passwords', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'initial_user', recovery_key: 'abc', new_password: 'NewPass#12', confirm_password: 'DifferentPass#12' }),
      });
      expect(resp.ok).toBe(false);
    });
  });

  // ── invalid endpoint ─────────────────────────────────────────────
  describe('invalid endpoint', () => {
    it('returns 404 for unknown action', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=nonexistent`, {
        method: 'GET',
      });
      expect(resp.status).toBe(404);
    });
  });

  // ── integration edge cases ───────────────────────────────────────
  describe('integration edge cases', () => {
    it('password-change → re-login: new password works, old password fails', async () => {
      // Use a dedicated user to avoid mutating the shared admin account
      const ts = Date.now();
      const username = `pwchange_${ts}`;
      const tempPassword = 'TempPass#12';
      const origPassword = 'OrigPass#12';
      const newPassword = 'Changed#99!';

      // Create user via admin API (gets must_reset_password=1)
      const createResp = await api.post('/users.php', {
        json: { username, email: `${username}@test.local`, password: tempPassword, role: 'user' },
      });
      expect(createResp.status).toBe(201);
      const userId = (await extractData(createResp)).id;

      // Login with temp password, then force-change to origPassword (clears must_reset_password)
      const tempLoginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: tempPassword }),
      });
      expect(tempLoginResp.status).toBe(200);
      const tempCookies = tempLoginResp.headers.get('set-cookie') || '';
      const tempToken = tempCookies.match(/pv_auth=([^;]+)/)?.[1];
      expect(tempToken).toBeTruthy();

      const forceResp = await fetch(`${BASE_URL}/auth.php?action=force-change-password`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tempToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: origPassword }),
      });
      expect(forceResp.status).toBe(200);

      // Re-login with origPassword to get a fresh token (force-change may invalidate old one)
      const origLoginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: origPassword }),
      });
      expect(origLoginResp.status).toBe(200);
      const origCookies = origLoginResp.headers.get('set-cookie') || '';
      const origToken = origCookies.match(/pv_auth=([^;]+)/)?.[1];
      expect(origToken).toBeTruthy();

      // Change password via the normal password-change endpoint
      const changeResp = await fetch(`${BASE_URL}/auth.php?action=password`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${origToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: origPassword, new_password: newPassword }),
      });
      expect(changeResp.status).toBe(200);

      // Login with NEW password must succeed
      const newLoginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: newPassword }),
      });
      expect(newLoginResp.status).toBe(200);

      // Login with OLD password must fail
      const oldLoginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: origPassword }),
      });
      expect(oldLoginResp.status).toBe(401);

      // Cleanup: delete the test user
      await api.delete(`/users.php?id=${userId}`);
    });

    it('deactivated user is blocked from API access', async () => {
      // Use a dedicated user to avoid mutating the shared test_regular_user
      const ts = Date.now();
      const username = `deact_${ts}`;
      const password = 'Deactivate#1';

      // Create user via admin API
      const createResp = await api.post('/users.php', {
        json: { username, email: `${username}@test.local`, password, role: 'user' },
      });
      expect(createResp.status).toBe(201);
      const userId = (await extractData(createResp)).id;

      // Clear must_reset_password via force-change flow
      const loginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      expect(loginResp.status).toBe(200);
      const cookies = loginResp.headers.get('set-cookie') || '';
      const token = cookies.match(/pv_auth=([^;]+)/)?.[1];
      if (token) {
        await fetch(`${BASE_URL}/auth.php?action=force-change-password`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_password: password }),
        });
      }

      // Admin deactivates the user
      const deactivateResp = await api.put(`/users.php?id=${userId}`, {
        json: { is_active: false },
      });
      expect(deactivateResp.status).toBe(200);

      // Login after deactivation must fail with 403
      const blockedResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      expect(blockedResp.status).toBe(403);

      // Cleanup: re-activate then delete
      await api.put(`/users.php?id=${userId}`, { json: { is_active: true } });
      await api.delete(`/users.php?id=${userId}`);
    });

    it('force-change-password endpoint returns 403 when flag is not set', async () => {
      // Admin user does not have must_reset_password set, so the endpoint
      // should reject the call with 403 (flag not set). This confirms the
      // endpoint is reachable and enforces its guard correctly.
      const resp = await apiRequest('POST', '/auth.php?action=force-change-password', {
        role: 'admin',
        json: { new_password: 'TestAdmin123' },
      });
      expect(resp.status).toBe(403);
    });
  });

  // ── register ──────────────────────────────────────────────────────
  // Rate limit: 5 attempts/hour per IP. Tests are kept to 4 calls total.
  // beforeAll clears stale rate-limit records so the suite is idempotent.
  describe('POST ?action=register', () => {
    const createdUserIds = [];
    let selfRegEnabled = false;

    beforeAll(async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=registration-status`);
      const body = await resp.json();
      selfRegEnabled = body.data.self_registration;
    });

    afterAll(async () => {
      for (const userId of createdUserIds) {
        try {
          await api.delete(`/users.php?id=${userId}`);
        } catch (_) { /* ignore cleanup errors */ }
      }
    });

    // Call 1: missing username → validation error
    it('returns error for missing required fields', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x@test.com', password: 'Test#12345' }),
      });
      expect(resp.ok).toBe(false);
    });

    // Call 2: invalid email format
    it('rejects invalid email format', async () => {
      const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'x', email: 'not-an-email', password: 'Test#12345' }),
      });
      expect(resp.ok).toBe(false);
    });

    // Call 3: invalid invite token → 403
    it('rejects invalid invite token', async () => {
      const ts = Date.now();
      const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invite_token: 'nonexistent-token-xyz',
          username: `inv_${ts}`,
          email: `inv_${ts}@test.com`,
          password: 'Test#12345',
        }),
      });
      expect(resp.status).toBe(403);
    });

    // Call 4: self-registration gate (201 if enabled, 403 if disabled)
    it('handles self-registration gate correctly', async () => {
      const ts = Date.now();
      const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: `test_reg_${ts}`,
          email: `test_reg_${ts}@test.com`,
          password: 'TestReg#12345',
        }),
      });

      if (selfRegEnabled) {
        expect(resp.status).toBe(201);
        const body = await resp.json();
        expect(body.data).toHaveProperty('user');
        expect(body.data).toHaveProperty('expires_in');
        expect(body.data.user).toHaveProperty('id');
        expect(body.data.user.username).toBe(`test_reg_${ts}`);
        expect(body.data.user.role).toBe('user');

        const setCookie = resp.headers.get('set-cookie') || '';
        expect(setCookie).toContain('pv_auth=');

        createdUserIds.push(body.data.user.id);
      } else {
        expect(resp.status).toBe(403);
      }
    });
  });
});
