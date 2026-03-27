/**
 * WebAuthn API Integration Tests
 *
 * Tests webauthn.php endpoints: auth enforcement, input validation,
 * register/auth options, passkey list/rename/delete.
 *
 * Note: Full WebAuthn registration/authentication flows require real
 * CBOR/attestation/assertion crypto — only input validation is tested
 * for register-verify and auth-verify.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, unauthRequest, BASE_URL } from '../helpers/apiClient.js';

describe('WebAuthn API', () => {

  // ── auth enforcement ────────────────────────────────────────────
  describe('auth enforcement', () => {
    it('register-options returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/webauthn.php?action=register-options');
      expect(resp.status).toBe(401);
    });

    it('register-verify returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/webauthn.php?action=register-verify');
      expect(resp.status).toBe(401);
    });

    it('list returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/webauthn.php?action=list');
      expect(resp.status).toBe(401);
    });

    it('rename returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/webauthn.php?action=rename');
      expect(resp.status).toBe(401);
    });

    it('delete returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/webauthn.php?action=delete');
      expect(resp.status).toBe(401);
    });
  });

  // ── auth-options (no auth required) ─────────────────────────────
  describe('POST ?action=auth-options', () => {
    it('returns 200 without authentication', async () => {
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-options`, {
        method: 'POST',
      });
      expect(resp.status).toBe(200);
    });

    it('returns challenge structure', async () => {
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-options`, {
        method: 'POST',
      });
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('challengeId');
      expect(data.data).toHaveProperty('publicKey');
      expect(data.data.publicKey).toHaveProperty('challenge');
      expect(data.data.publicKey).toHaveProperty('rpId');
    });
  });

  // ── register-options (auth required) ────────────────────────────
  describe('POST ?action=register-options', () => {
    it('returns 200 with registration challenge', async () => {
      const resp = await api.post('/webauthn.php?action=register-options');
      expect(resp.status).toBe(200);
    });

    it('returns challenge and user/relying party info', async () => {
      const resp = await api.post('/webauthn.php?action=register-options');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('challengeId');
      expect(data).toHaveProperty('publicKey');
      expect(data.publicKey).toHaveProperty('challenge');
      expect(data.publicKey).toHaveProperty('rp');
      expect(data.publicKey).toHaveProperty('user');
    });
  });

  // ── register-verify validation ──────────────────────────────────
  describe('POST ?action=register-verify validation', () => {
    it('returns 400 for empty body', async () => {
      const resp = await api.post('/webauthn.php?action=register-verify', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing clientDataJSON', async () => {
      const resp = await api.post('/webauthn.php?action=register-verify', {
        json: {
          attestationObject: 'fake-attestation',
          challengeId: 1,
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing attestationObject', async () => {
      const resp = await api.post('/webauthn.php?action=register-verify', {
        json: {
          clientDataJSON: 'fake-client-data',
          challengeId: 1,
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing challengeId', async () => {
      const resp = await api.post('/webauthn.php?action=register-verify', {
        json: {
          clientDataJSON: 'fake-client-data',
          attestationObject: 'fake-attestation',
        },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── auth-verify validation ──────────────────────────────────────
  describe('POST ?action=auth-verify validation', () => {
    it('returns 400 for empty body', async () => {
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing required fields', async () => {
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientDataJSON: 'fake',
          // missing authenticatorData, signature, challengeId, credentialId
        }),
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for partial fields', async () => {
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientDataJSON: 'fake',
          authenticatorData: 'fake',
          signature: 'fake',
          // missing challengeId and credentialId
        }),
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── list (empty — no passkeys registered) ───────────────────────
  describe('GET ?action=list', () => {
    it('returns 200 with array', async () => {
      const resp = await api.get('/webauthn.php?action=list');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // ── rename — validation and non-existent passkey ────────────────
  describe('POST ?action=rename', () => {
    it('returns 400 for missing params', async () => {
      const resp = await api.post('/webauthn.php?action=rename', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing name', async () => {
      const resp = await api.post('/webauthn.php?action=rename', {
        json: { id: 99999 },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing id', async () => {
      const resp = await api.post('/webauthn.php?action=rename', {
        json: { name: 'New Name' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 404 for non-existent passkey', async () => {
      const resp = await api.post('/webauthn.php?action=rename', {
        json: { id: 99999, name: 'New Name' },
      });
      expect(resp.status).toBe(404);
    });
  });

  // ── delete — validation and non-existent passkey ────────────────
  describe('POST ?action=delete', () => {
    it('returns 400 for missing params', async () => {
      const resp = await api.post('/webauthn.php?action=delete', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('returns 404 for non-existent passkey', async () => {
      const resp = await api.post('/webauthn.php?action=delete', {
        json: { id: 99999 },
      });
      expect(resp.status).toBe(404);
    });
  });

  // ── rate limiting (shared login bucket) ────────────────────────
  describe('rate limiting', () => {
    it('auth-options does not crash under rate limit check', async () => {
      // auth-options shares the login rate limit bucket — verify it still
      // returns 200 (not 500) when the rate limit check runs
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-options`, {
        method: 'POST',
      });
      // 200 = normal, 429 = rate limited (both valid — depends on prior test runs)
      expect([200, 429]).toContain(resp.status);
    });

    it('auth-verify with all fields returns 401 not 500 (rate limit + lockout path)', async () => {
      // Provide all required fields so we pass validation (400) and hit the
      // actual auth verification path, which should fail gracefully (401)
      // after recording a rate limit attempt
      const resp = await fetch(`${BASE_URL}/webauthn.php?action=auth-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientDataJSON: 'ZmFrZQ==',
          authenticatorData: 'ZmFrZQ==',
          signature: 'ZmFrZQ==',
          challengeId: 999999,
          credentialId: 'nonexistent-credential',
        }),
      });
      // 401 = auth failed (expected), 429 = rate limited (also valid)
      expect([401, 429]).toContain(resp.status);
    });
  });

  // ── invalid endpoint ───────────────────────────────────────────
  describe('invalid endpoint', () => {
    it('returns 404 for unknown action', async () => {
      const resp = await api.get('/webauthn.php?action=invalid');
      expect(resp.status).toBe(404);
    });
  });
});
