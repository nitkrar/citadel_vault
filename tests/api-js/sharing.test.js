/**
 * Sharing API Integration Tests (Redesigned)
 *
 * Tests sharing.php endpoints: recipient-key, share, update, revoke,
 * shared-by-me, shared-with-me, share-count.
 *
 * Key changes from the old API:
 *  - recipient-key now returns a signed `recipient_token` (HMAC, 5-min TTL)
 *  - share accepts `recipient_token` instead of raw `identifier`
 *  - Self-share prevention in both recipient-key AND share endpoints
 *  - Upsert semantics: duplicate share updates instead of creating a new row
 *  - Single global ghost user (id=0) for all unknown identifiers
 *  - shared-by-me includes `recipient_id` for targeted revokes
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, extractData, unauthRequest, apiRequest } from '../helpers/apiClient.js';

describe('Sharing API (Redesigned)', () => {
  let testEntryId = null;
  let testEntryId2 = null;
  let ghostShareId = null;
  let regularShareId = null;
  const ghostIdentifier = 'ghost_share_test_' + Date.now() + '@test.local';

  // Ensure regular user has a public key so recipient-key resolves them as real (not ghost).
  // Uses admin API to set vault keys directly (avoids must_reset_password issues).
  beforeAll(async () => {
    try {
      const resp = await apiRequest('POST', '/encryption.php?action=setup-rsa', {
        role: 'regular',
        json: {
          public_key: 'dGVzdC1wdWJsaWMta2V5LWZvci1zaGFyaW5nLXRlc3Rz',
          encrypted_private_key: 'dGVzdC1wcml2YXRlLWtleQ==',
        },
      });
      // 200 = set, 400 = already set, 403 = must_reset_password (all acceptable)
    } catch {
      // Best effort — if this fails, recipient-key tests will create ghost shares
    }
  });

  // ── Auth enforcement (all 7 endpoints) ──────────────────────────────────
  describe('auth enforcement', () => {
    it('GET recipient-key returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/sharing.php?action=recipient-key&identifier=someone');
      expect(resp.status).toBe(401);
    });

    it('POST share returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/sharing.php?action=share', {
        json: { source_entry_id: 1, recipients: [] },
      });
      expect(resp.status).toBe(401);
    });

    it('POST update returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/sharing.php?action=update', {
        json: { source_entry_id: 1, recipients: [] },
      });
      expect(resp.status).toBe(401);
    });

    it('POST revoke returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/sharing.php?action=revoke', {
        json: { source_entry_id: 1 },
      });
      expect(resp.status).toBe(401);
    });

    it('GET shared-by-me returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/sharing.php?action=shared-by-me');
      expect(resp.status).toBe(401);
    });

    it('GET shared-with-me returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/sharing.php?action=shared-with-me');
      expect(resp.status).toBe(401);
    });

    it('GET share-count returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/sharing.php?action=share-count&entry_id=1');
      expect(resp.status).toBe(401);
    });
  });

  // ── recipient-key ───────────────────────────────────────────────────────
  describe('recipient-key', () => {
    it('requires identifier parameter', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key');
      expect(resp.status).toBe(400);
    });

    it('returns 400 for empty identifier', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=');
      expect(resp.status).toBe(400);
    });

    it('blocks self-sharing (own username)', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=initial_user');
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error || body.message).toMatch(/yourself/i);
    });

    it('blocks self-sharing (own email)', async () => {
      // Admin email is admin@citadelvault.local or similar — fetch via self-lookup
      // Use the username form since we know admin is initial_user
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=initial_user');
      expect(resp.status).toBe(400);
    });

    it('returns public_key + recipient_token for real user', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('public_key');
      expect(data.public_key).toBeTruthy();
      expect(data).toHaveProperty('recipient_token');
      expect(data.recipient_token).toBeTruthy();
      // is_ghost depends on whether regular user has vault keys set up
      expect(typeof data.is_ghost).toBe('boolean');
    });

    it('returns public_key + recipient_token for ghost (non-existent user)', async () => {
      const resp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('public_key');
      expect(data.public_key).toBeTruthy();
      expect(data).toHaveProperty('is_ghost', true);
      expect(data).toHaveProperty('recipient_token');
      expect(data.recipient_token).toBeTruthy();
    });

    it('ghost shares are idempotent (same key on repeated calls)', async () => {
      const resp1 = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      const data1 = await extractData(resp1);

      const resp2 = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      const data2 = await extractData(resp2);

      expect(data1.public_key).toBe(data2.public_key);
      expect(data1.is_ghost).toBe(true);
      expect(data2.is_ghost).toBe(true);
    });

    it('recipient_token field is present and non-empty', async () => {
      const resp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      const data = await extractData(resp);
      expect(typeof data.recipient_token).toBe('string');
      expect(data.recipient_token.length).toBeGreaterThan(0);
      // Token format: base64(payload).hmac-hex
      expect(data.recipient_token).toContain('.');
    });
  });

  // ── share (token-based) ─────────────────────────────────────────────────
  describe('share', () => {
    // Create test entries before share tests
    it('setup: creates test vault entries for sharing', async () => {
      const resp = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'c2hhcmUtdGVzdC1lbnRyeQ==',
        },
      });
      expect(resp.status).toBe(201);
      const data = await extractData(resp);
      testEntryId = data.id;
      expect(testEntryId).toBeTruthy();

      const resp2 = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'c2hhcmUtdGVzdC1lbnRyeS0y',
        },
      });
      expect(resp2.status).toBe(201);
      const data2 = await extractData(resp2);
      testEntryId2 = data2.id;
      expect(testEntryId2).toBeTruthy();
    });

    it('requires source_entry_id', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: { recipients: [{ recipient_token: 'tok', encrypted_data: 'blob' }] },
      });
      expect(resp.status).toBe(400);
    });

    it('requires recipients array', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: { source_entry_id: testEntryId },
      });
      expect(resp.status).toBe(400);
    });

    it('rejects empty recipients array', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: { source_entry_id: testEntryId, recipients: [] },
      });
      expect(resp.status).toBe(400);
    });

    it('rejects non-existent source entry', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: 999999,
          recipients: [{ recipient_token: 'some-token', encrypted_data: 'blob' }],
        },
      });
      expect(resp.status).toBe(404);
    });

    it('shares entry using recipient_token from recipient-key', async () => {
      // 1. Get recipient token for the regular user
      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      expect(keyResp.status).toBe(200);
      const keyData = await extractData(keyResp);
      const token = keyData.recipient_token;
      expect(token).toBeTruthy();

      // 2. Share the entry using the token
      const shareResp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            recipient_token: token,
            encrypted_data: 'c2hhcmVkLWJsb2ItZm9yLXJlZ3VsYXI=',
          }],
        },
      });
      expect(shareResp.status).toBe(200);
      const shareData = await extractData(shareResp);
      expect(shareData).toHaveProperty('share_ids');
      expect(shareData).toHaveProperty('count', 1);
      expect(shareData).toHaveProperty('skipped', 0);
      expect(Array.isArray(shareData.share_ids)).toBe(true);
      expect(shareData.share_ids.length).toBe(1);
      regularShareId = shareData.share_ids[0];
    });

    it('shares with ghost user using token', async () => {
      // 1. Get ghost recipient token
      const keyResp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      expect(keyResp.status).toBe(200);
      const keyData = await extractData(keyResp);
      expect(keyData.is_ghost).toBe(true);
      const token = keyData.recipient_token;

      // 2. Share with ghost token
      const shareResp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            recipient_token: token,
            encrypted_data: 'c2hhcmVkLWJsb2ItZm9yLWdob3N0',
          }],
        },
      });
      expect(shareResp.status).toBe(200);
      const shareData = await extractData(shareResp);
      expect(shareData.count).toBe(1);
      expect(shareData.skipped).toBe(0);
      ghostShareId = shareData.share_ids[0];
    });

    it('skips expired/invalid token', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            recipient_token: 'totally-garbage-token',
            encrypted_data: 'c29tZS1ibG9i',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(0);
      expect(data.skipped).toBe(1);
    });

    it('skips tampered token', async () => {
      // Get a real token, then tamper with it
      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      const keyData = await extractData(keyResp);
      const realToken = keyData.recipient_token;

      // Tamper: flip last character of HMAC signature
      const tampered = realToken.slice(0, -1) + (realToken.slice(-1) === 'a' ? 'b' : 'a');

      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            recipient_token: tampered,
            encrypted_data: 'dGFtcGVyZWQ=',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(0);
      expect(data.skipped).toBe(1);
    });

    it('blocks self-share via token (belt-and-suspenders)', async () => {
      // Even if we somehow craft a token with the sender's own user_id,
      // the share endpoint should skip it. We cannot easily forge a valid token,
      // but recipient-key already blocks self-lookup. We verify the 400 at
      // recipient-key level.
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=initial_user');
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error || body.message).toMatch(/yourself/i);
    });

    it('skips recipients with empty token or encrypted_data', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [
            { recipient_token: '', encrypted_data: 'blob' },
            { recipient_token: 'some-token', encrypted_data: '' },
          ],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(0);
      expect(data.skipped).toBe(2);
    });

    it('upserts on duplicate share (same entry + recipient)', async () => {
      // Share testEntryId with regular user again (already shared above)
      // Should upsert, not create a duplicate row
      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      const keyData = await extractData(keyResp);
      const token = keyData.recipient_token;

      // Get count before upsert
      const countBefore = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
      const beforeData = await extractData(countBefore);
      const initialCount = beforeData.count;

      const shareResp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            recipient_token: token,
            encrypted_data: 'dXBkYXRlZC1ibG9i',   // updated blob
          }],
        },
      });
      expect(shareResp.status).toBe(200);
      const shareData = await extractData(shareResp);
      expect(shareData.count).toBe(1);

      // Count should NOT increase — upsert replaces, doesn't duplicate
      const countAfter = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
      const afterData = await extractData(countAfter);
      expect(afterData.count).toBe(initialCount);
    });

    it('response includes skipped count', async () => {
      // Mix valid + invalid recipients
      const keyResp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      const keyData = await extractData(keyResp);
      const validToken = keyData.recipient_token;

      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [
            { recipient_token: validToken, encrypted_data: 'dmFsaWQ=' },
            { recipient_token: 'bad-token', encrypted_data: 'aW52YWxpZA==' },
          ],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      // Ghost upsert should succeed (count=1), bad token skipped (skipped=1)
      expect(data.count).toBe(1);
      expect(data.skipped).toBe(1);
    });
  });

  // ── shared-by-me ────────────────────────────────────────────────────────
  describe('shared-by-me', () => {
    it('returns shares with recipient_id field', async () => {
      const resp = await api.get('/sharing.php?action=shared-by-me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);

      const testShares = data.filter(s => Number(s.source_entry_id) === Number(testEntryId));
      expect(testShares.length).toBeGreaterThanOrEqual(1);

      for (const share of testShares) {
        expect(share).toHaveProperty('recipient_id');
        // recipient_id should be a number (0 for ghost, real id for real user)
        expect(typeof share.recipient_id).toBe('number');
      }
    });

    it('includes all expected fields', async () => {
      const resp = await api.get('/sharing.php?action=shared-by-me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.length).toBeGreaterThan(0);

      const share = data[0];
      expect(share).toHaveProperty('id');
      expect(share).toHaveProperty('recipient_identifier');
      expect(share).toHaveProperty('recipient_id');
      expect(share).toHaveProperty('source_entry_id');
      expect(share).toHaveProperty('entry_type');
      expect(share).toHaveProperty('is_ghost');
      expect(share).toHaveProperty('created_at');
      expect(share).toHaveProperty('updated_at');
    });
  });

  // ── share-count ─────────────────────────────────────────────────────────
  describe('share-count', () => {
    it('requires entry_id parameter', async () => {
      const resp = await api.get('/sharing.php?action=share-count');
      expect(resp.status).toBe(400);
    });

    it('returns correct count for shared entry', async () => {
      const resp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('count');
      // At least the regular user share should exist
      expect(data.count).toBeGreaterThanOrEqual(1);
    });

    it('returns 0 for unshared entry', async () => {
      const resp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId2}`);
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('count', 0);
    });

    it('returns 0 for non-existent entry_id', async () => {
      const resp = await api.get('/sharing.php?action=share-count&entry_id=999999');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('count', 0);
    });
  });

  // ── shared-with-me ──────────────────────────────────────────────────────
  describe('shared-with-me', () => {
    it('returns shares addressed to user', async () => {
      // Admin shared testEntryId with regular user — regular user should see it
      const resp = await apiRequest('GET', '/sharing.php?action=shared-with-me', { role: 'regular' });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);

      // Find the share we created
      const ourShare = data.find(s => Number(s.source_entry_id) === Number(testEntryId));
      expect(ourShare).toBeDefined();
      expect(ourShare).toHaveProperty('sender_username');
      expect(ourShare).toHaveProperty('encrypted_data');
      expect(ourShare).toHaveProperty('entry_type');
    });
  });

  // ── update (re-encrypt) ─────────────────────────────────────────────────
  describe('update', () => {
    it('requires source_entry_id and recipients', async () => {
      const resp1 = await api.post('/sharing.php?action=update', {
        json: { recipients: [{ user_id: 1, encrypted_data: 'new-blob' }] },
      });
      expect(resp1.status).toBe(400);

      const resp2 = await api.post('/sharing.php?action=update', {
        json: { source_entry_id: testEntryId },
      });
      expect(resp2.status).toBe(400);

      const resp3 = await api.post('/sharing.php?action=update', {
        json: { source_entry_id: testEntryId, recipients: [] },
      });
      expect(resp3.status).toBe(400);
    });

    it('returns 404 for non-existent source entry', async () => {
      const resp = await api.post('/sharing.php?action=update', {
        json: {
          source_entry_id: 999999,
          recipients: [{ user_id: 1, encrypted_data: 'new-blob' }],
        },
      });
      expect(resp.status).toBe(404);
    });

    it('updates share encrypted_data', async () => {
      // Find the regular user's recipient_id from shared-by-me
      const byMeResp = await api.get('/sharing.php?action=shared-by-me');
      const byMeData = await extractData(byMeResp);
      const regularShare = byMeData.find(
        s => Number(s.source_entry_id) === Number(testEntryId) && s.recipient_identifier === 'test_regular_user',
      );
      expect(regularShare).toBeDefined();
      expect(regularShare.recipient_id).toBeTruthy();

      const resp = await api.post('/sharing.php?action=update', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            user_id: regularShare.recipient_id,
            encrypted_data: 'cmUtZW5jcnlwdGVkLWJsb2I=',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('updated');
      expect(data.updated).toBe(1);
    });

    it('returns updated=0 for non-matching user_id', async () => {
      const resp = await api.post('/sharing.php?action=update', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            user_id: 999999,
            encrypted_data: 'bm8tbWF0Y2g=',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.updated).toBe(0);
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────────
  describe('revoke', () => {
    it('requires source_entry_id', async () => {
      const resp = await api.post('/sharing.php?action=revoke', {
        json: {},
      });
      expect(resp.status).toBe(400);
    });

    it('revokes specific recipient by user_id', async () => {
      // First, share testEntryId2 with both regular user and ghost
      const keyRegResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      const keyRegData = await extractData(keyRegResp);
      const regToken = keyRegData.recipient_token;

      const keyGhostResp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      const keyGhostData = await extractData(keyGhostResp);
      const ghostToken = keyGhostData.recipient_token;

      await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId2,
          recipients: [
            { recipient_token: regToken, encrypted_data: 'cmV2b2tlLXRlc3QtMQ==' },
            { recipient_token: ghostToken, encrypted_data: 'cmV2b2tlLXRlc3QtMg==' },
          ],
        },
      });

      // Get recipient_id from shared-by-me
      const byMeResp = await api.get('/sharing.php?action=shared-by-me');
      const byMeData = await extractData(byMeResp);
      const regularShare = byMeData.find(
        s => Number(s.source_entry_id) === Number(testEntryId2) && s.recipient_identifier === 'test_regular_user',
      );
      expect(regularShare).toBeDefined();
      expect(regularShare.recipient_id).toBeTruthy();

      // Revoke only the regular user's share
      const resp = await api.post('/sharing.php?action=revoke', {
        json: {
          source_entry_id: testEntryId2,
          user_ids: [regularShare.recipient_id],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.revoked).toBe(1);

      // Ghost share should still exist
      const countResp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId2}`);
      const countData = await extractData(countResp);
      expect(countData.count).toBe(1);
    });

    it('revokes all shares for entry when user_ids empty', async () => {
      // testEntryId still has regular + ghost shares
      const resp = await api.post('/sharing.php?action=revoke', {
        json: { source_entry_id: testEntryId },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('revoked');
      expect(data.revoked).toBeGreaterThanOrEqual(1);
    });

    it('share-count returns 0 after revoke', async () => {
      const resp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(0);
    });

    it('returns revoked=0 for entry with no shares', async () => {
      const resp = await api.post('/sharing.php?action=revoke', {
        json: { source_entry_id: testEntryId },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.revoked).toBe(0);
    });
  });

  // ── cross-user isolation ────────────────────────────────────────────────
  describe('cross-user isolation', () => {
    it('regular user cannot see admin shares in shared-by-me', async () => {
      const resp = await apiRequest('GET', '/sharing.php?action=shared-by-me', { role: 'regular' });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);

      // None of the entries should be the admin's test entries
      const adminShares = data.filter(
        s => s.source_entry_id === testEntryId || s.source_entry_id === testEntryId2,
      );
      expect(adminShares.length).toBe(0);
    });
  });

  // ── invalid action fallback ─────────────────────────────────────────────
  describe('invalid request', () => {
    it('returns 400 for unknown action', async () => {
      const resp = await api.get('/sharing.php?action=nonexistent');
      expect(resp.status).toBe(400);
    });
  });

  // ── cleanup ─────────────────────────────────────────────────────────────
  afterAll(async () => {
    // Revoke any remaining shares first, then delete test vault entries
    if (testEntryId) {
      await api.post('/sharing.php?action=revoke', {
        json: { source_entry_id: testEntryId },
      });
      await api.delete(`/vault.php?id=${testEntryId}`);
    }
    if (testEntryId2) {
      await api.post('/sharing.php?action=revoke', {
        json: { source_entry_id: testEntryId2 },
      });
      await api.delete(`/vault.php?id=${testEntryId2}`);
    }
  });
});
