/**
 * JWT Security Tests
 *
 * Tests that the server correctly rejects tampered, malformed, expired,
 * and missing JWT tokens while accepting valid ones.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, getToken, BASE_URL } from '../helpers/apiClient.js';

// ---------------------------------------------------------------------------
// Helper: build a fake JWT with the right structure but wrong signature
// ---------------------------------------------------------------------------
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildFakeJwt({ header, payload, signature } = {}) {
  const h = header ?? base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = payload ?? base64UrlEncode(JSON.stringify({
    sub: 1,
    user_id: 1,
    username: 'initial_user',
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const s = signature ?? base64UrlEncode('fake-signature-bytes');
  return `${h}.${p}.${s}`;
}

/**
 * Make a raw request with a specific Authorization header value.
 */
function rawRequest(method, path, authHeaderValue) {
  const headers = { 'Content-Type': 'application/json' };
  if (authHeaderValue !== undefined) {
    headers['Authorization'] = authHeaderValue;
  }
  return fetch(`${BASE_URL}${path}`, { method, headers });
}

// A protected endpoint that all test users can access
const PROTECTED_ENDPOINT = '/auth.php?action=me';

// ---------------------------------------------------------------------------
// 1. Tampered / Malformed Token Rejection
// ---------------------------------------------------------------------------
describe('JWT security — tampered and malformed tokens', () => {
  it('rejects a completely invalid token string', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, 'Bearer not-a-jwt-at-all');
    expect(resp.status).toBe(401);
  });

  it('rejects a token with only one segment (missing parts)', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, 'Bearer single-segment');
    expect(resp.status).toBe(401);
  });

  it('rejects a token with two segments (missing signature)', async () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64UrlEncode(JSON.stringify({ sub: 1, exp: Math.floor(Date.now() / 1000) + 3600 }));
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${header}.${payload}`);
    expect(resp.status).toBe(401);
  });

  it('rejects a token with tampered payload (signature mismatch)', async () => {
    // Get a real token first, then tamper with the payload
    const realToken = await getToken('admin');
    const [header, , signature] = realToken.split('.');

    // Replace the payload with a different one (e.g., elevated role)
    const tamperedPayload = base64UrlEncode(JSON.stringify({
      sub: 999,
      user_id: 999,
      username: 'hacker',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${tamperedToken}`);
    expect(resp.status).toBe(401);
  });

  it('rejects a token with tampered signature', async () => {
    const realToken = await getToken('admin');
    const [header, payload] = realToken.split('.');

    // Replace the signature with garbage
    const fakeSignature = base64UrlEncode('this-is-not-a-valid-hmac-signature');
    const tamperedToken = `${header}.${payload}.${fakeSignature}`;

    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${tamperedToken}`);
    expect(resp.status).toBe(401);
  });

  it('rejects a structurally valid JWT signed with the wrong secret', async () => {
    // Build a JWT that looks right but was signed with a different key
    const token = buildFakeJwt();
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${token}`);
    expect(resp.status).toBe(401);
  });

  it('rejects a fake-signed JWT with an expired exp (rejected at signature, not expiry)', async () => {
    // Server checks signature before expiry (Auth.php:93 vs :96). This test
    // verifies rejection but does NOT exercise the exp-checking code path.
    // True expiry testing requires a token signed with the real JWT_SECRET.
    const expiredPayload = base64UrlEncode(JSON.stringify({
      sub: 1,
      user_id: 1,
      username: 'initial_user',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    }));
    const token = buildFakeJwt({ payload: expiredPayload });
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${token}`);
    expect(resp.status).toBe(401);
  });

  it('rejects a fake-signed JWT with no exp claim (rejected at signature, not missing-exp)', async () => {
    // Same caveat — rejected at signature check, not at the missing-exp check.
    const noExpPayload = base64UrlEncode(JSON.stringify({
      sub: 1,
      user_id: 1,
      username: 'initial_user',
      role: 'admin',
    }));
    const token = buildFakeJwt({ payload: noExpPayload });
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${token}`);
    expect(resp.status).toBe(401);
  });

  it('rejects a JWT with empty string segments', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, 'Bearer ..');
    expect(resp.status).toBe(401);
  });

  it('rejects a JWT with non-base64 payload', async () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const token = `${header}.%%%not-base64%%%.${base64UrlEncode('sig')}`;
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Bearer ${token}`);
    expect(resp.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2. Missing / Empty Authorization
// ---------------------------------------------------------------------------
describe('JWT security — missing and empty authorization', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, undefined);
    expect(resp.status).toBe(401);
  });

  it('returns 401 for empty Authorization header', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, '');
    expect(resp.status).toBe(401);
  });

  it('returns 401 for Authorization header with only "Bearer" (no token)', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, 'Bearer ');
    expect(resp.status).toBe(401);
  });

  it('returns 401 for Authorization header with wrong scheme', async () => {
    const realToken = await getToken('admin');
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, `Basic ${realToken}`);
    expect(resp.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3. Valid Token — Control Tests
// ---------------------------------------------------------------------------
describe('JWT security — valid token acceptance', () => {
  it('accepts a valid token on a protected endpoint', async () => {
    const resp = await api.get('/auth.php?action=me');
    expect(resp.status).toBe(200);
    const data = await extractData(resp);
    expect(data).toHaveProperty('username');
    expect(data).toHaveProperty('id');
    expect(typeof data.id).toBe('number');
  });

  it('same token works across different endpoints (tokens are universal)', async () => {
    const token = await getToken('admin');

    // Use the same token on two different protected endpoints
    const meResp = await rawRequest('GET', '/auth.php?action=me', `Bearer ${token}`);
    expect(meResp.status).toBe(200);

    const vaultResp = await rawRequest('GET', '/vault.php', `Bearer ${token}`);
    expect(vaultResp.status).toBe(200);

    const settingsResp = await rawRequest('GET', '/settings.php', `Bearer ${token}`);
    expect(settingsResp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. Response Body Validation
// ---------------------------------------------------------------------------
describe('JWT security — 401 response body format', () => {
  it('returns a JSON error body for invalid tokens', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, 'Bearer invalid-token');
    expect(resp.status).toBe(401);

    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('returns a JSON error body when no token is provided', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, undefined);
    expect(resp.status).toBe(401);

    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body).toHaveProperty('error');
  });

  it('error message does not leak internal details (no stack trace, no secret)', async () => {
    const resp = await rawRequest('GET', PROTECTED_ENDPOINT, 'Bearer invalid-token');
    expect(resp.status).toBe(401);

    const text = await resp.text();
    const lower = text.toLowerCase();
    expect(lower).not.toContain('jwt_secret');
    expect(lower).not.toContain('stack trace');
    expect(lower).not.toContain('exception');
    expect(lower).not.toContain('.php on line');
  });
});
