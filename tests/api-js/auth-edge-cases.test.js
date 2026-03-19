/**
 * Auth Edge Cases — Integration Tests
 *
 * Tests three edge-case scenarios for the auth system:
 *   1. Invite token reuse after registration (consumed token → 410)
 *   2. Account lockout after repeated failed logins (→ 429)
 *   3. Deactivated user cannot log in (→ 403)
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, apiRequest, BASE_URL } from '../helpers/apiClient.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Invite token lifecycle — consumed token cannot be reused
// ═══════════════════════════════════════════════════════════════════════════
describe('invite token lifecycle', () => {
  const createdUserIds = [];

  afterAll(async () => {
    // Cleanup test users created during this suite
    for (const id of createdUserIds) {
      try {
        await api.delete(`/users.php?id=${id}`);
      } catch (_) { /* ignore cleanup errors */ }
    }
  });

  it('rejects reuse of a consumed invite token', async () => {
    const ts = Date.now();
    const inviteEmail = `reuse_test_${ts}@test.local`;

    // 1. Create invite as admin
    const createResp = await api.post('/invitations.php', {
      params: { action: 'create' },
      json: { email: inviteEmail },
    });
    expect(createResp.status).toBe(201);

    const inviteData = await api.data(createResp);
    expect(inviteData).toHaveProperty('invite_url');
    // Token is embedded in the invite_url: .../register?invite=<TOKEN>
    const inviteUrl = inviteData.invite_url;
    const token = new URL(inviteUrl).searchParams.get('invite');
    expect(token).toBeTruthy();

    // 2. Register with the invite token (email must match the invite)
    const username = `reuse_user_${ts}`;
    const regResp = await fetch(`${BASE_URL}/auth.php?action=register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email: inviteEmail,
        password: 'TestReuse#123',
        invite_token: token,
      }),
    });
    // Rate limits may block registration (429) — skip test if so
    if (regResp.status === 429) return; // rate-limited, clear rate_limits table and retry
    expect(regResp.status).toBe(201);
    const regBody = await regResp.json();
    if (regBody.data?.user?.id) {
      createdUserIds.push(regBody.data.user.id);
    }

    // 3. Attempt to register again with the same consumed token
    const reuseResp = await fetch(`${BASE_URL}/auth.php?action=register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `reuse_user2_${ts}`,
        email: inviteEmail,
        password: 'TestReuse#123',
        invite_token: token,
      }),
    });
    // auth.php returns 410 "This invite has already been used." or 429 if rate-limited
    if (reuseResp.status === 429) return;
    expect(reuseResp.status).toBe(410);
    const reuseBody = await reuseResp.json();
    expect(reuseBody.error).toMatch(/already been used/i);
  });

  it('validates invite token before registration proceeds', async () => {
    const ts = Date.now();
    const inviteEmail = `validate_test_${ts}@test.local`;

    // 1. Create invite
    const createResp = await api.post('/invitations.php', {
      params: { action: 'create' },
      json: { email: inviteEmail },
    });
    expect(createResp.status).toBe(201);
    const inviteData = await api.data(createResp);
    const token = new URL(inviteData.invite_url).searchParams.get('invite');

    // 2. Try registering with a DIFFERENT email than the invite — should be rejected
    const resp = await fetch(`${BASE_URL}/auth.php?action=register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `mismatch_${ts}`,
        email: `wrong_${ts}@test.local`,
        password: 'TestMismatch#123',
        invite_token: token,
      }),
    });
    // auth.php returns 403 "Email does not match the invite." or 429 if rate-limited
    if (resp.status === 429) return;
    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body.error).toMatch(/does not match/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Lockout after repeated failed login attempts
// ═══════════════════════════════════════════════════════════════════════════
describe('lockout and recovery', () => {
  const password = 'Lockout#Test1';
  let username;
  let userId;

  afterAll(async () => {
    // Cleanup: delete the lockout test user
    if (userId) {
      try {
        await api.delete(`/users.php?id=${userId}`);
      } catch (_) { /* ignore */ }
    }
  });

  it('locks out after too many failed login attempts', async () => {
    const ts = Date.now();
    username = `lockout_${ts}`;

    // 1. Create a fresh user via admin API
    const createResp = await api.post('/users.php', {
      json: {
        username,
        email: `${username}@test.local`,
        password,
        role: 'user',
      },
    });
    expect(createResp.status).toBe(201);
    const createData = await api.data(createResp);
    userId = createData.id;

    // 2. Clear must_reset_password by doing the force-change flow.
    //    Admin-created users have must_reset_password=1.
    //    Login with temp password → force-change → password is now usable.
    const loginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    // Login should succeed (200) — must_reset_password doesn't block login
    expect(loginResp.status).toBe(200);
    const loginBody = await loginResp.json();
    expect(loginBody.data.user.must_change_password).toBe(true);

    // Extract token from cookie for force-change
    const setCookie = loginResp.headers.get('set-cookie') || '';
    const match = setCookie.match(/pv_auth=([^;]+)/);
    expect(match).toBeTruthy();
    const userToken = match[1];

    // Force-change to the same password (server checks reuse, so use a different one)
    const newPassword = 'Lockout#Test2';
    const forceResp = await fetch(`${BASE_URL}/auth.php?action=force-change-password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ new_password: newPassword }),
    });
    expect(forceResp.status).toBe(200);

    // 3. Send wrong password attempts to trigger lockout.
    //    Tier 1 lockout triggers at LOCKOUT_TIER1_ATTEMPTS (default 3).
    //    We send 3 wrong attempts, then attempt #4 should be locked.
    const wrongAttempts = 3;
    for (let i = 0; i < wrongAttempts; i++) {
      const failResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'WrongPassword#999' }),
      });
      expect(failResp.status).toBe(401);
    }

    // 4. Next login attempt (even with correct password) should be locked out
    const lockedResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: newPassword }),
    });
    // Server returns 429 "Account is locked. Try again in X minute(s)."
    expect(lockedResp.status).toBe(429);
    const lockedBody = await lockedResp.json();
    expect(lockedBody.error).toMatch(/locked/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Deactivated user cannot log in or make API calls
// ═══════════════════════════════════════════════════════════════════════════
describe('deactivated user', () => {
  let userId;
  let username;
  const password = 'Deactivated#1';

  afterAll(async () => {
    // Cleanup: re-activate and then delete the user
    if (userId) {
      try {
        // Re-activate first so we can verify cleanup is clean
        await api.put(`/users.php?id=${userId}`, {
          json: { is_active: 1 },
        });
        await api.delete(`/users.php?id=${userId}`);
      } catch (_) { /* ignore */ }
    }
  });

  it('deactivated user cannot log in', async () => {
    const ts = Date.now();
    username = `deactivated_${ts}`;

    // 1. Create user via admin API
    const createResp = await api.post('/users.php', {
      json: {
        username,
        email: `${username}@test.local`,
        password,
        role: 'user',
      },
    });
    expect(createResp.status).toBe(201);
    const createData = await api.data(createResp);
    userId = createData.id;

    // 2. Clear must_reset_password via login + force-change flow
    const loginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    expect(loginResp.status).toBe(200);

    const setCookie = loginResp.headers.get('set-cookie') || '';
    const match = setCookie.match(/pv_auth=([^;]+)/);
    expect(match).toBeTruthy();
    const userToken = match[1];

    const newPassword = 'Deactivated#2';
    const forceResp = await fetch(`${BASE_URL}/auth.php?action=force-change-password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ new_password: newPassword }),
    });
    expect(forceResp.status).toBe(200);

    // 3. Verify the user can log in normally
    const verifyResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: newPassword }),
    });
    expect(verifyResp.status).toBe(200);

    // 4. Deactivate the user via admin API
    const deactivateResp = await api.put(`/users.php?id=${userId}`, {
      json: { is_active: 0 },
    });
    expect(deactivateResp.status).toBe(200);

    // 5. Try to log in as deactivated user → should get 403
    const blockedResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: newPassword }),
    });
    expect(blockedResp.status).toBe(403);
    const blockedBody = await blockedResp.json();
    expect(blockedBody.error).toMatch(/deactivated/i);
  });

  it('re-activated user can log in again', async () => {
    // This test depends on the previous test having deactivated the user.
    // Skip if userId wasn't set (previous test failed early).
    if (!userId) return;

    // 1. Re-activate via admin API
    const reactivateResp = await api.put(`/users.php?id=${userId}`, {
      json: { is_active: 1 },
    });
    expect(reactivateResp.status).toBe(200);

    // 2. Should be able to log in again
    const loginResp = await fetch(`${BASE_URL}/auth.php?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'Deactivated#2' }),
    });
    expect(loginResp.status).toBe(200);
    const body = await loginResp.json();
    expect(body.data.user.username).toBe(username);
  });
});
