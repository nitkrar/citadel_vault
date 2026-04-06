/**
 * Encryption API Integration Tests
 *
 * Tests encryption.php endpoints: key material retrieval, auth enforcement.
 * Note: Cannot test full setup/update flows without client-side crypto —
 * these test the API contract (status codes, response shape, auth).
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, unauthRequest } from '../helpers/apiClient.js';

describe('Encryption API', () => {
  // ── key material ─────────────────────────────────────────────────
  describe('GET ?action=key-material', () => {
    it('returns key material for authenticated user', async () => {
      const resp = await api.get('/encryption.php?action=key-material');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('has_vault_key');
      if (data.has_vault_key) {
        expect(data).toHaveProperty('vault_key_salt');
        expect(data).toHaveProperty('encrypted_dek');
      }
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/encryption.php?action=key-material');
      expect(resp.status).toBe(401);
    });
  });

  // ── recovery material ────────────────────────────────────────────
  describe('GET ?action=recovery-material', () => {
    it('returns recovery material or 404', async () => {
      const resp = await api.get('/encryption.php?action=recovery-material');
      expect([200, 404]).toContain(resp.status);
      if (resp.status === 200) {
        const data = await extractData(resp);
        expect(data).toHaveProperty('recovery_key_salt');
        expect(data).toHaveProperty('encrypted_dek_recovery');
      }
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/encryption.php?action=recovery-material');
      expect(resp.status).toBe(401);
    });
  });

  // ── recovery key encrypted ──────────────────────────────────────
  describe('GET ?action=recovery-key-encrypted', () => {
    it('returns encrypted recovery key or 404', async () => {
      const resp = await api.get('/encryption.php?action=recovery-key-encrypted');
      expect([200, 404]).toContain(resp.status);
      if (resp.status === 200) {
        const data = await extractData(resp);
        expect(data).toHaveProperty('recovery_key_encrypted');
      }
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/encryption.php?action=recovery-key-encrypted');
      expect(resp.status).toBe(401);
    });
  });

  // ── public key ───────────────────────────────────────────────────
  describe('GET ?action=public-key', () => {
    it('returns public key or 404', async () => {
      const resp = await api.get('/encryption.php?action=public-key');
      expect([200, 404]).toContain(resp.status);
      if (resp.status === 200) {
        const data = await extractData(resp);
        expect(data).toHaveProperty('public_key');
      }
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/encryption.php?action=public-key');
      expect(resp.status).toBe(401);
    });
  });

  // ── private key encrypted ───────────────────────────────────────
  describe('GET ?action=private-key-encrypted', () => {
    it('returns encrypted private key or 404', async () => {
      const resp = await api.get('/encryption.php?action=private-key-encrypted');
      expect([200, 404]).toContain(resp.status);
      if (resp.status === 200) {
        const data = await extractData(resp);
        expect(data).toHaveProperty('encrypted_private_key');
      }
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/encryption.php?action=private-key-encrypted');
      expect(resp.status).toBe(401);
    });
  });

  // ── setup (POST) ─────────────────────────────────────────────────
  describe('POST ?action=setup', () => {
    it('returns 400 for missing fields', async () => {
      const resp = await api.post('/encryption.php?action=setup', { json: {} });
      // 400 for missing fields, or 400 for already-set-up vault
      expect([400]).toContain(resp.status);
    });

    it('returns 400 for partial fields', async () => {
      const resp = await api.post('/encryption.php?action=setup', {
        json: { vault_key_salt: 'test-salt' },
      });
      expect([400]).toContain(resp.status);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/encryption.php?action=setup', { json: {} });
      expect(resp.status).toBe(401);
    });
  });

  // ── update vault key ─────────────────────────────────────────────
  describe('POST ?action=update-vault-key', () => {
    it('returns 400 for missing fields', async () => {
      const resp = await api.post('/encryption.php?action=update-vault-key', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 400 with only vault_key_salt', async () => {
      const resp = await api.post('/encryption.php?action=update-vault-key', {
        json: { vault_key_salt: 'test-salt' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/encryption.php?action=update-vault-key', { json: {} });
      expect(resp.status).toBe(401);
    });
  });

  // ── update recovery ──────────────────────────────────────────────
  describe('POST ?action=update-recovery', () => {
    it('returns 400 for missing fields', async () => {
      const resp = await api.post('/encryption.php?action=update-recovery', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for partial fields', async () => {
      const resp = await api.post('/encryption.php?action=update-recovery', {
        json: { recovery_key_salt: 'test-salt' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/encryption.php?action=update-recovery', { json: {} });
      expect(resp.status).toBe(401);
    });
  });

  // ── update all ───────────────────────────────────────────────────
  describe('POST ?action=update-all', () => {
    it('returns 400 for missing fields', async () => {
      const resp = await api.post('/encryption.php?action=update-all', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for partial fields', async () => {
      const resp = await api.post('/encryption.php?action=update-all', {
        json: { vault_key_salt: 'test', encrypted_dek: 'test' },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/encryption.php?action=update-all', { json: {} });
      expect(resp.status).toBe(401);
    });
  });

  // ── setup RSA ────────────────────────────────────────────────────
  describe('POST ?action=setup-rsa', () => {
    it('returns 400 for missing fields', async () => {
      const resp = await api.post('/encryption.php?action=setup-rsa', { json: {} });
      expect(resp.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/encryption.php?action=setup-rsa', { json: {} });
      expect(resp.status).toBe(401);
    });

    it('rejects invalid RSA public key format', async () => {
      const resp = await api.post('/encryption.php?action=setup-rsa', {
        json: {
          public_key: 'bm90LWEtdmFsaWQtcnNhLWtleQ==',
          encrypted_private_key: 'dGVzdC1wcml2YXRlLWtleQ==',
        },
      });
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error).toMatch(/Invalid RSA public key/i);
    });
  });

  // ── fallback ─────────────────────────────────────────────────────
  describe('invalid action', () => {
    it('returns 400 for unknown action', async () => {
      const resp = await api.get('/encryption.php?action=nonexistent');
      expect(resp.status).toBe(400);
    });
  });
});
