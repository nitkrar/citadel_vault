/**
 * Plaid API Integration Tests
 *
 * Tests gatekeeper enforcement, auth, and endpoint structure.
 * Actual Plaid API calls require sandbox credentials.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, unauthRequest } from '../helpers/apiClient.js';

describe('Plaid API', () => {
  // ── gatekeeper enforcement ──────────────────────────────────────
  describe('gatekeeper (plaid_enabled)', () => {
    /** Helper: returns true if Plaid is enabled in system settings. */
    async function isPlaidEnabled() {
      const settingsResp = await api.get('/settings.php');
      const settings = await extractData(settingsResp);
      return (settings?.plaid_enabled?.value ?? 'false') === 'true';
    }

    it('POST create-link-token returns 403 when disabled', async () => {
      if (await isPlaidEnabled()) return; // skip — cannot test block when enabled

      const resp = await api.post('/plaid.php?action=create-link-token', {
        json: { country_codes: ['US'] },
      });
      expect(resp.status).toBe(403);
      const body = await resp.json();
      expect(body.error.toLowerCase()).toContain('not enabled');
    });

    it('GET status returns 403 when disabled', async () => {
      if (await isPlaidEnabled()) return; // skip — cannot test block when enabled

      const resp = await api.get('/plaid.php', { params: { action: 'status' } });
      expect(resp.status).toBe(403);
    });

    it('POST refresh returns 403 when disabled', async () => {
      if (await isPlaidEnabled()) return; // skip — cannot test block when enabled

      const resp = await api.post('/plaid.php?action=refresh', {
        json: { item_ids: ['fake'] },
      });
      expect(resp.status).toBe(403);
    });
  });

  // ── auth enforcement ────────────────────────────────────────────
  describe('auth enforcement', () => {
    it('POST create-link-token returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/plaid.php?action=create-link-token', {
        json: {},
      });
      expect(resp.status).toBe(401);
    });

    it('POST exchange-token returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/plaid.php?action=exchange-token', {
        json: {},
      });
      expect(resp.status).toBe(401);
    });

    it('GET status returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/plaid.php', {
        params: { action: 'status' },
      });
      expect(resp.status).toBe(401);
    });
  });

  // ── input validation ────────────────────────────────────────────
  describe('input validation', () => {
    it('POST exchange-token without public_token returns 400, 403, or 500', async () => {
      const resp = await api.post('/plaid.php?action=exchange-token', { json: {} });
      expect([400, 403, 500]).toContain(resp.status);
    });

    it('POST refresh with empty item_ids returns 400 or 403', async () => {
      const resp = await api.post('/plaid.php?action=refresh', {
        json: { item_ids: [] },
      });
      expect([400, 403]).toContain(resp.status);
    });

    it('DELETE disconnect without item_id returns 400 or 403', async () => {
      const resp = await api.delete('/plaid.php?action=disconnect');
      expect([400, 403]).toContain(resp.status);
    });
  });
});
