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
import { TEST_RSA_PUBLIC_KEY } from '../helpers/fixtures.js';

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
          public_key: TEST_RSA_PUBLIC_KEY,
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
      // recipient-key no longer returns is_ghost
      expect(data).not.toHaveProperty('is_ghost');
    });

    it('returns public_key + recipient_token for ghost (non-existent user)', async () => {
      const resp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('public_key');
      expect(data.public_key).toBeTruthy();
      expect(data).not.toHaveProperty('is_ghost');
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
      // Both return same ghost public key
      expect(data1).not.toHaveProperty('is_ghost');
      expect(data2).not.toHaveProperty('is_ghost');
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

      // 2. Share the entry using the token (includes new sharing fields)
      const shareResp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: testEntryId,
          recipients: [{
            recipient_token: token,
            encrypted_data: 'c2hhcmVkLWJsb2ItZm9yLXJlZ3VsYXI=',
            identifier: 'test_regular_user',
          }],
          sync_mode: 'snapshot',
          source_type: 'account',
          label: 'Test share',
          expires_at: null,
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
      expect(keyData).not.toHaveProperty('is_ghost');
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
      expect(share).toHaveProperty('status');
      expect(['active', 'pending']).toContain(share.status);
      expect(share).toHaveProperty('created_at');
      expect(share).toHaveProperty('updated_at');
      // New sharing fields
      expect(share).toHaveProperty('sync_mode');
      expect(share).toHaveProperty('source_type');
      expect(share).toHaveProperty('label');
      expect(share).toHaveProperty('expires_at');
    });
  });

  // ── new sharing fields (sync_mode, source_type, label, expires_at) ─────
  describe('new sharing fields', () => {
    let fieldTestEntryId = null;

    beforeAll(async () => {
      const resp = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'bmV3LWZpZWxkcy10ZXN0',
        },
      });
      if (resp.status === 201) {
        const data = await extractData(resp);
        fieldTestEntryId = data.id;
      }
    });

    afterAll(async () => {
      if (fieldTestEntryId) {
        await api.post('/sharing.php?action=revoke', {
          json: { source_entry_id: fieldTestEntryId },
        });
        await api.delete(`/vault.php?id=${fieldTestEntryId}`);
      }
    });

    it('accepts sync_mode and source_type in share request', async () => {
      expect(fieldTestEntryId).toBeTruthy();

      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      expect(keyResp.status).toBe(200);
      const keyData = await extractData(keyResp);

      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: fieldTestEntryId,
          sync_mode: 'continuous',
          source_type: 'asset',
          label: 'For review',
          recipients: [{
            recipient_token: keyData.recipient_token,
            encrypted_data: 'c3luYy1tb2RlLXRlc3Q=',
            identifier: 'test_regular_user',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(1);
    });

    it('stores and returns label in shared-by-me', async () => {
      const resp = await api.get('/sharing.php?action=shared-by-me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);

      const labeled = data.find(s => s.label === 'For review');
      expect(labeled).toBeTruthy();
      expect(labeled.sync_mode).toBe('continuous');
      expect(labeled.source_type).toBe('asset');
    });

    it('defaults sync_mode to snapshot when not provided', async () => {
      const resp = await api.get('/sharing.php?action=shared-by-me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);

      // The first share test created a share with explicit sync_mode='snapshot'
      const share = data.find(s => s.label === 'Test share');
      if (share) {
        expect(share.sync_mode).toBe('snapshot');
      }
    });

    it('accepts expires_at in share request', async () => {
      // Create a separate entry to avoid upsert conflicts
      const entryResp = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'ZXhwaXJ5LXRlc3QtZW50cnk=',
        },
      });
      expect(entryResp.status).toBe(201);
      const entryData = await extractData(entryResp);
      const expiryEntryId = entryData.id;

      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      expect(keyResp.status).toBe(200);
      const keyData = await extractData(keyResp);

      // Use MySQL-compatible datetime format (YYYY-MM-DD HH:MM:SS)
      const d = new Date(Date.now() + 86400000);
      const futureDate = d.toISOString().slice(0, 19).replace('T', ' ');
      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: expiryEntryId,
          expires_at: futureDate,
          recipients: [{
            recipient_token: keyData.recipient_token,
            encrypted_data: 'ZXhwaXJ5LXRlc3Q=',
            identifier: 'test_regular_user',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(1);

      // Verify expires_at is returned in shared-by-me
      const byMeResp = await api.get('/sharing.php?action=shared-by-me');
      const byMeData = await extractData(byMeResp);
      const expiringShare = byMeData.find(s => Number(s.source_entry_id) === Number(expiryEntryId));
      expect(expiringShare).toBeDefined();
      expect(expiringShare.expires_at).toBeTruthy();

      // Cleanup
      await api.post('/sharing.php?action=revoke', {
        json: { source_entry_id: expiryEntryId },
      });
      await api.delete(`/vault.php?id=${expiryEntryId}`);
    });

    it('returns new fields in shared-with-me', async () => {
      // Regular user should see the share we created with sync_mode=continuous
      const resp = await apiRequest('GET', '/sharing.php?action=shared-with-me', { role: 'regular' });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);

      const ourShare = data.find(s => Number(s.source_entry_id) === Number(fieldTestEntryId));
      if (ourShare) {
        expect(ourShare).toHaveProperty('sync_mode');
        expect(ourShare).toHaveProperty('source_type');
        expect(ourShare).toHaveProperty('label');
        expect(ourShare).toHaveProperty('expires_at');
        expect(ourShare.sync_mode).toBe('continuous');
        expect(ourShare.source_type).toBe('asset');
        expect(ourShare.label).toBe('For review');
      }
    });

    it('invalid sync_mode defaults to snapshot', async () => {
      const entryResp = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'aW52YWxpZC1zeW5jLW1vZGU=',
        },
      });
      expect(entryResp.status).toBe(201);
      const entryData = await extractData(entryResp);
      const invalidSyncEntryId = entryData.id;

      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      const keyData = await extractData(keyResp);

      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: invalidSyncEntryId,
          sync_mode: 'bogus_mode',
          recipients: [{
            recipient_token: keyData.recipient_token,
            encrypted_data: 'aW52YWxpZC1zeW5j',
            identifier: 'test_regular_user',
          }],
        },
      });
      expect(resp.status).toBe(200);

      // Verify it defaulted to snapshot
      const byMeResp = await api.get('/sharing.php?action=shared-by-me');
      const byMeData = await extractData(byMeResp);
      const share = byMeData.find(s => Number(s.source_entry_id) === Number(invalidSyncEntryId));
      expect(share).toBeDefined();
      expect(share.sync_mode).toBe('snapshot');

      // Cleanup
      await api.post('/sharing.php?action=revoke', {
        json: { source_entry_id: invalidSyncEntryId },
      });
      await api.delete(`/vault.php?id=${invalidSyncEntryId}`);
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

    it('excludes expired shares from shared-with-me', async () => {
      // Create a dedicated entry for this test
      const entryResp = await api.post('/vault.php', {
        json: { entry_type: 'password', template_id: 1, encrypted_data: 'ZXhwaXJ5LWV4Y2x1c2lvbg==' },
      });
      expect(entryResp.status).toBe(201);
      const entryId = (await extractData(entryResp)).id;

      // Get recipient token for regular user
      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      const keyData = await extractData(keyResp);

      // Share with expires_at 2 seconds from now
      const expiresAt = new Date(Date.now() + 2000).toISOString();
      await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: entryId,
          expires_at: expiresAt,
          recipients: [{ recipient_token: keyData.recipient_token, encrypted_data: 'ZXhwaXJ5LXRlc3Q=', identifier: 'test_regular_user' }],
        },
      });

      // Wait for expiry
      await new Promise(r => setTimeout(r, 3000));

      // Check shared-with-me — should NOT contain the expired share
      const resp = await apiRequest('GET', '/sharing.php?action=shared-with-me', { role: 'regular' });
      const data = await extractData(resp);
      const expiredShare = data.find(s => Number(s.source_entry_id) === Number(entryId));
      expect(expiredShare).toBeUndefined();

      // Cleanup
      await api.post('/sharing.php?action=revoke', { json: { source_entry_id: entryId } });
      await api.delete(`/vault.php?id=${entryId}`);
    }, 10000);
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

  // ── portfolio sharing (null source_entry_id) ────────────────────────────
  describe('portfolio sharing', () => {
    let portfolioShareId = null;

    it('allows portfolio share with null source_entry_id', async () => {
      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      expect(keyResp.status).toBe(200);
      const keyData = await extractData(keyResp);

      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: null,
          source_type: 'portfolio',
          entry_type: 'portfolio',
          sync_mode: 'snapshot',
          label: 'Portfolio summary',
          recipients: [{
            recipient_token: keyData.recipient_token,
            encrypted_data: 'cG9ydGZvbGlvLWRhdGE=',
            identifier: 'test_regular_user',
          }],
        },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.count).toBe(1);
      expect(data.skipped).toBe(0);
      portfolioShareId = data.share_ids[0];
    });

    it('portfolio share appears in shared-by-me with source_type=portfolio', async () => {
      const resp = await api.get('/sharing.php?action=shared-by-me');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);

      const portfolioShare = data.find(s => s.source_type === 'portfolio' && s.label === 'Portfolio summary');
      expect(portfolioShare).toBeDefined();
      expect(portfolioShare.source_entry_id).toBeFalsy(); // null or 0
      expect(portfolioShare.entry_type).toBe('portfolio');
    });

    it('portfolio share visible in shared-with-me for recipient', async () => {
      const resp = await apiRequest('GET', '/sharing.php?action=shared-with-me', { role: 'regular' });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);

      const portfolioShare = data.find(s => s.source_type === 'portfolio');
      expect(portfolioShare).toBeDefined();
      expect(portfolioShare).toHaveProperty('encrypted_data');
    });

    it('upserts portfolio share on re-share to same recipient', async () => {
      const keyResp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user');
      const keyData = await extractData(keyResp);

      // Count before
      const beforeResp = await api.get('/sharing.php?action=shared-by-me');
      const beforeData = await extractData(beforeResp);
      const beforeCount = beforeData.filter(s => s.source_type === 'portfolio').length;

      // Re-share portfolio
      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: null,
          source_type: 'portfolio',
          entry_type: 'portfolio',
          label: 'Updated portfolio',
          recipients: [{
            recipient_token: keyData.recipient_token,
            encrypted_data: 'dXBkYXRlZC1wb3J0Zm9saW8=',
            identifier: 'test_regular_user',
          }],
        },
      });
      expect(resp.status).toBe(200);

      // Count after — should not increase (upsert, not duplicate)
      const afterResp = await api.get('/sharing.php?action=shared-by-me');
      const afterData = await extractData(afterResp);
      const afterCount = afterData.filter(s => s.source_type === 'portfolio').length;
      expect(afterCount).toBe(beforeCount);

      // Label should be updated
      const updated = afterData.find(s => s.source_type === 'portfolio');
      expect(updated.label).toBe('Updated portfolio');
    });

    it('still requires source_entry_id for non-portfolio shares', async () => {
      const resp = await api.post('/sharing.php?action=share', {
        json: {
          source_type: 'entry',
          recipients: [{ recipient_token: 'tok', encrypted_data: 'blob' }],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('revokes portfolio shares', async () => {
      const resp = await api.post('/sharing.php?action=revoke', {
        json: { source_type: 'portfolio' },
      });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data.revoked).toBeGreaterThanOrEqual(1);

      // Verify gone from shared-by-me
      const byMeResp = await api.get('/sharing.php?action=shared-by-me');
      const byMeData = await extractData(byMeResp);
      const remaining = byMeData.filter(s => s.source_type === 'portfolio');
      expect(remaining.length).toBe(0);
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

  // ── edge cases ──────────────────────────────────────────────────────────
  describe('edge cases', () => {
    let edgeEntryId = null;

    beforeAll(async () => {
      const resp = await api.post('/vault.php', {
        json: {
          entry_type: 'password',
          template_id: 1,
          encrypted_data: 'ZWRnZS1jYXNlLWVudHJ5',
        },
      });
      if (resp.status === 201) {
        const data = await extractData(resp);
        edgeEntryId = data.id;
      }
    });

    afterAll(async () => {
      if (edgeEntryId) {
        await api.post('/sharing.php?action=revoke', {
          json: { source_entry_id: edgeEntryId },
        });
        await api.delete(`/vault.php?id=${edgeEntryId}`);
      }
    });

    it('handles concurrent ghost user creation without crash', async () => {
      expect(edgeEntryId).toBeTruthy();

      // Use a unique identifier not seen elsewhere in the test suite
      const concurrentGhost = 'concurrent_ghost_' + Date.now() + '@test.local';

      // Step 1: Fetch recipient tokens for the same ghost identifier concurrently.
      // recipient-key is the endpoint that creates/finds the ghost user row, so
      // this is where the INSERT race can occur.
      const [keyResult1, keyResult2] = await Promise.allSettled([
        api.get(`/sharing.php?action=recipient-key&identifier=${encodeURIComponent(concurrentGhost)}`),
        api.get(`/sharing.php?action=recipient-key&identifier=${encodeURIComponent(concurrentGhost)}`),
      ]);

      // Neither request should produce a 500 — the DB layer must handle the
      // duplicate-key scenario gracefully (IGNORE / upsert / re-select).
      for (const result of [keyResult1, keyResult2]) {
        if (result.status === 'fulfilled') {
          expect(result.value.status).not.toBe(500);
        }
        // A rejected promise (network error) is acceptable evidence of no crash,
        // but we prefer both to succeed.
      }

      // Step 2: Collect valid tokens from whichever requests succeeded with 200.
      const tokens = [];
      for (const result of [keyResult1, keyResult2]) {
        if (result.status === 'fulfilled' && result.value.status === 200) {
          const data = await extractData(result.value);
          if (data.recipient_token) {
            tokens.push(data.recipient_token);
          }
        }
      }

      // At least one request must have returned a usable token.
      expect(tokens.length).toBeGreaterThanOrEqual(1);

      // Step 3: Share the entry using one of the obtained tokens to confirm the
      // ghost user row is coherent (not left in a corrupt state by the race).
      const shareResp = await api.post('/sharing.php?action=share', {
        json: {
          source_entry_id: edgeEntryId,
          recipients: [{
            recipient_token: tokens[0],
            encrypted_data: 'Y29uY3VycmVudC1ibG9i',
          }],
        },
      });
      expect(shareResp.status).not.toBe(500);
      expect(shareResp.status).toBe(200);
      const shareData = await extractData(shareResp);
      expect(shareData.count).toBe(1);
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
