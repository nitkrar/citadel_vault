/**
 * Lockout Tier Escalation — Integration Tests
 *
 * Tests the progressive account lockout system:
 *   Tier 1: 3 failed attempts  -> locked for 15 minutes (LOCKOUT_TIER1_DURATION=900)
 *   Tier 2: 6 failed attempts  -> locked for 1 hour     (LOCKOUT_TIER2_DURATION=3600)
 *   Tier 3: 9 failed attempts  -> locked for 90 days + must_reset_password
 *
 * Each test creates a dedicated user to avoid cross-test contamination.
 * Cleanup deletes the user in afterAll.
 *
 * NOTE: These tests use direct MySQL access (via `mysql` CLI) to:
 *   1. Clear IP rate limits between tests (all requests share 127.0.0.1)
 *   2. Clear locked_until without resetting the attempt counter (for tier 2/3)
 * If mysql CLI is unavailable, affected tests are skipped gracefully.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { api, BASE_URL } from '../helpers/apiClient.js';

// ---------------------------------------------------------------------------
// DB helpers (mysql CLI)
// ---------------------------------------------------------------------------

let dbAvailable = null;

/**
 * Run a SQL statement via mysql CLI. Returns true on success, false on failure.
 */
async function runSql(sql) {
  try {
    const { execSync } = await import('child_process');
    execSync(
      `mysql -u nitinkum citadel_vault_test_db -e "${sql}"`,
      { timeout: 5000, stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if mysql CLI is available for direct DB access.
 */
async function checkDbAccess() {
  if (dbAvailable !== null) return dbAvailable;
  dbAvailable = await runSql('SELECT 1');
  return dbAvailable;
}

/**
 * Clear the IP-based login rate limit entries so tests don't hit the
 * RATE_LIMIT_LOGIN_IP threshold (20 per 15 min from same IP).
 */
async function clearLoginRateLimits() {
  return runSql("DELETE FROM rate_limits WHERE action = 'login'");
}

/**
 * Clear the locked_until timestamp for a user WITHOUT resetting the
 * failed_login_attempts counter. This simulates the lock expiring so
 * further failed attempts can accumulate toward the next tier.
 */
async function clearLockedUntil(userId) {
  return runSql(`UPDATE users SET locked_until = NULL WHERE id = ${userId}`);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh test user via admin API, then clear the must_reset_password
 * flag via the force-change flow. Returns { userId, username, password }.
 */
async function createTestUser(label) {
  const ts = Date.now();
  const username = `lockout_${label}_${ts}`;
  const tempPassword = `Temp${label}#99`;
  const finalPassword = `Final${label}#1`;

  // 1. Create via admin
  const createResp = await api.post('/users.php', {
    json: {
      username,
      email: `${username}@test.local`,
      password: tempPassword,
      role: 'user',
    },
  });
  expect(createResp.status).toBe(201);
  const createData = await api.data(createResp);
  const userId = createData.id;

  // 2. Login with temp password (must_reset_password=1 doesn't block login)
  const loginResp = await login(username, tempPassword);
  expect(loginResp.status).toBe(200);

  const setCookie = loginResp.headers.get('set-cookie') || '';
  const match = setCookie.match(/pv_auth=([^;]+)/);
  expect(match).toBeTruthy();
  const userToken = match[1];

  // 3. Force-change to clear must_reset_password
  const forceResp = await fetch(`${BASE_URL}/auth.php?action=force-change-password`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ new_password: finalPassword }),
  });
  expect(forceResp.status).toBe(200);

  return { userId, username, password: finalPassword };
}

/**
 * Send a login request and return the Response.
 */
async function login(username, password) {
  return fetch(`${BASE_URL}/auth.php?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

/**
 * Send N failed login attempts with a wrong password.
 * Returns array of { status, body } for each attempt.
 */
async function sendFailedAttempts(username, count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const resp = await login(username, 'WrongPassword#999');
    results.push({ status: resp.status, body: await resp.json() });
  }
  return results;
}

/**
 * Delete a test user via admin API. Ignores errors.
 */
async function deleteUser(userId) {
  if (!userId) return;
  try { await api.delete(`/users.php?id=${userId}`); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════
describe('lockout tier escalation', () => {
  let hasDb;

  beforeAll(async () => {
    hasDb = await checkDbAccess();
    if (hasDb) await clearLoginRateLimits();
  });

  // Clear IP rate limits before each test to avoid hitting the 20-per-15-min
  // threshold when many login attempts accumulate from 127.0.0.1.
  beforeEach(async () => {
    if (hasDb) await clearLoginRateLimits();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Control — login succeeds before any failed attempts
  // ─────────────────────────────────────────────────────────────────────────
  describe('control: login with zero failed attempts', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('login succeeds with correct credentials and no prior failures', async () => {
      const user = await createTestUser('ctrl');
      userId = user.userId;

      const resp = await login(user.username, user.password);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.data.user.username).toBe(user.username);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Below tier1 threshold — login still works
  // ─────────────────────────────────────────────────────────────────────────
  describe('below tier1 threshold: login still works', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('login succeeds after fewer than 3 failed attempts', async () => {
      const user = await createTestUser('below');
      userId = user.userId;

      // 2 failed attempts (tier1 triggers at exactly 3)
      const failures = await sendFailedAttempts(user.username, 2);
      for (const f of failures) {
        expect(f.status).toBe(401);
        expect(f.body.error).toMatch(/invalid credentials/i);
      }

      // Correct password should still work — not locked
      const resp = await login(user.username, user.password);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.data.user.username).toBe(user.username);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Tier 1 lockout at 3 failed attempts
  // ─────────────────────────────────────────────────────────────────────────
  describe('tier 1 lockout (3 failures)', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('locks account after exactly 3 failed attempts', async () => {
      const user = await createTestUser('t1');
      userId = user.userId;

      // 3 wrong-password attempts trigger tier1
      const failures = await sendFailedAttempts(user.username, 3);
      for (const f of failures) {
        expect(f.status).toBe(401);
      }

      // Correct password now returns 429 (locked)
      const resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.error).toMatch(/locked/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Lockout error includes duration hint
  // ─────────────────────────────────────────────────────────────────────────
  describe('lockout error message format', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('includes "Try again in N minute(s)" in the lockout message', async () => {
      const user = await createTestUser('msg');
      userId = user.userId;

      await sendFailedAttempts(user.username, 3);

      const resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);
      const body = await resp.json();

      // Format: "Account is locked. Try again in X minute(s)."
      // Tier1 = 900s = 15 minutes, so X should be around 14-15
      expect(body.error).toMatch(/try again in \d+ minute/i);
      expect(body.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Tier 2 lockout at 6 cumulative failed attempts
  //    Requires DB access to clear locked_until between tier1 and tier2.
  // ─────────────────────────────────────────────────────────────────────────
  describe('tier 2 lockout (6 failures)', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('escalates to tier 2 with longer lockout duration after 6 failures', async () => {
      if (!hasDb) {
        console.warn('Skipping tier2 test: mysql CLI not available');
        return;
      }

      const user = await createTestUser('t2');
      userId = user.userId;

      // Phase 1: 3 failures -> tier1 lockout
      await sendFailedAttempts(user.username, 3);
      let resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);

      // Simulate tier1 lock expiry (clear locked_until, keep counter at 3)
      expect(await clearLockedUntil(user.userId)).toBe(true);

      // Phase 2: 3 more failures (total=6) -> tier2 lockout
      const phase2 = await sendFailedAttempts(user.username, 3);
      for (const f of phase2) {
        expect(f.status).toBe(401);
      }

      // Tier2 locked: duration = 3600s = 60 minutes
      resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.error).toMatch(/locked/i);
      expect(body.error).toMatch(/try again in \d+ minute/i);

      // Extract minute count — should be around 60 (tier2), not 15 (tier1)
      const minuteMatch = body.error.match(/in (\d+) minute/);
      expect(minuteMatch).toBeTruthy();
      const minutes = parseInt(minuteMatch[1], 10);
      expect(minutes).toBeGreaterThan(15);
      expect(minutes).toBeLessThanOrEqual(60);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Tier 3 lockout at 9 cumulative failed attempts
  //    Requires DB access to clear locked_until between tiers.
  // ─────────────────────────────────────────────────────────────────────────
  describe('tier 3 lockout (9 failures)', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('permanently locks account after 9 failures', async () => {
      if (!hasDb) {
        console.warn('Skipping tier3 test: mysql CLI not available');
        return;
      }

      const user = await createTestUser('t3');
      userId = user.userId;

      // Phase 1: 3 failures -> tier1
      await sendFailedAttempts(user.username, 3);
      let resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);

      // Clear tier1 lock
      expect(await clearLockedUntil(user.userId)).toBe(true);

      // Phase 2: 3 more failures (total=6) -> tier2
      await sendFailedAttempts(user.username, 3);
      resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);

      // Clear tier2 lock
      expect(await clearLockedUntil(user.userId)).toBe(true);

      // Phase 3: 3 more failures (total=9) -> tier3 (90-day lock)
      await sendFailedAttempts(user.username, 3);

      resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.error).toMatch(/locked/i);

      // Tier3 = 90 days = ~129,600 minutes, far exceeding tier2's 60 minutes
      const minuteMatch = body.error.match(/in (\d+) minute/);
      expect(minuteMatch).toBeTruthy();
      const minutes = parseInt(minuteMatch[1], 10);
      expect(minutes).toBeGreaterThan(1000); // 90 days ≈ 129,600 min, must be well above tier2

      // Tier 3 should also set must_reset_password — verify via login after clearing lock
      expect(await clearLockedUntil(user.userId)).toBe(true);
      const loginResp = await login(user.username, user.password);
      expect(loginResp.status).toBe(200);
      const loginBody = await loginResp.json();
      expect(loginBody.data?.user?.must_change_password).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Successful login resets the failed attempt counter
  // ─────────────────────────────────────────────────────────────────────────
  describe('successful login resets counter', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('resets failed_login_attempts so previous failures do not accumulate', async () => {
      const user = await createTestUser('reset');
      userId = user.userId;

      // 2 failed attempts (just below tier1 threshold of 3)
      await sendFailedAttempts(user.username, 2);

      // Successful login resets the counter
      const goodResp = await login(user.username, user.password);
      expect(goodResp.status).toBe(200);

      // 2 more failures — if counter was reset, total is 2 (not 4)
      // So tier1 (3) should NOT trigger
      await sendFailedAttempts(user.username, 2);

      // Login should still work (counter was reset to 0 before these 2)
      const resp = await login(user.username, user.password);
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.data.user.username).toBe(user.username);
    });
  });

  describe('counter reset then re-trigger tier1', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('tier1 requires 3 fresh failures after counter reset', async () => {
      const user = await createTestUser('retrig');
      userId = user.userId;

      // 2 failures, then success -> resets counter
      await sendFailedAttempts(user.username, 2);
      const goodResp = await login(user.username, user.password);
      expect(goodResp.status).toBe(200);

      // 3 fresh failures -> tier1 triggers
      await sendFailedAttempts(user.username, 3);

      const resp = await login(user.username, user.password);
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.error).toMatch(/locked/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Response detail tests
  // ─────────────────────────────────────────────────────────────────────────
  describe('failure response details', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('returns 401 "Invalid credentials" for wrong password (not locked)', async () => {
      const user = await createTestUser('detail');
      userId = user.userId;

      const resp = await login(user.username, 'WrongPassword#999');
      expect(resp.status).toBe(401);
      const body = await resp.json();
      expect(body.error).toMatch(/invalid credentials/i);
      expect(body.success).toBe(false);
    });
  });

  describe('lockout takes priority over credential check', () => {
    let userId;
    afterAll(async () => { await deleteUser(userId); });

    it('returns 429 even with wrong password once locked', async () => {
      const user = await createTestUser('priority');
      userId = user.userId;

      // Lock the account (3 failures -> tier1)
      await sendFailedAttempts(user.username, 3);

      // Wrong password while locked -> 429, not 401
      const resp = await login(user.username, 'WrongPassword#999');
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.error).toMatch(/locked/i);
    });
  });
});
