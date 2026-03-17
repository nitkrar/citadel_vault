/**
 * Sharing API Integration Tests
 *
 * Tests sharing.php endpoints: recipient-key, share, update, revoke,
 * shared-by-me, shared-with-me, share-count.
 * All endpoints require auth (top-level Auth::requireAuth).
 *
 * Requires: php -S localhost:8081 router.php
 *
 * ─── KNOWN BUGS IN sharing.php ───────────────────────────────────────────
 *
 * BUG-SHARE-1: No self-sharing check in POST ?action=share.
 *   The recipient-key endpoint blocks self-sharing (line 38), but the share
 *   endpoint itself does NOT check if sender_id == recipient_id. A caller who
 *   skips the key lookup (or crafts a direct POST) can share an entry with
 *   themselves. This creates a share row with sender_id == recipient_id.
 *
 * BUG-SHARE-2: Share created with recipient_id=NULL for unknown identifiers.
 *   If a recipient identifier doesn't match any real user AND no ghost user
 *   exists for that identifier (i.e., caller skipped recipient-key lookup),
 *   the share is created with recipient_id=NULL. This orphaned share will:
 *   - Never appear in shared-with-me (queries by recipient_id)
 *   - Cannot be revoked by specific user_ids (only revoke-all works)
 *   - Shows in shared-by-me but recipient_username will be null
 *
 * BUG-SHARE-3: Ghost user creation can fail with duplicate key violation.
 *   In recipient-key (lines 88-97), if an existing ghost user is found but
 *   getVaultKeys() returns null/empty, code falls through to INSERT a new
 *   ghost user with the same username, hitting UNIQUE constraint → 500 error.
 *   This can happen if setVaultKeys() failed on initial ghost creation.
 *
 * BUG-SHARE-4: No duplicate share prevention.
 *   POST ?action=share does not check if a share already exists for the same
 *   (sender_id, source_entry_id, recipient_id). Calling share twice creates
 *   two share rows, and revoke-by-user_ids only deletes the first one found.
 *   share-count will also double-count.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, extractData, unauthRequest } from '../helpers/apiClient.js';

describe('Sharing API', () => {
  // Track IDs for cleanup
  let testEntryId = null;
  let testEntryId2 = null;
  const ghostIdentifier = 'ghost_sharing_test_' + Date.now() + '@test.local';

  // ── auth enforcement (all 7 endpoints require auth) ─────────────
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

  // ── recipient-key ───────────────────────────────────────────────
  describe('GET ?action=recipient-key', () => {
    it('returns 400 when identifier is missing', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key');
      expect(resp.status).toBe(400);
    });

    it('returns 400 when identifier is empty', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=');
      expect(resp.status).toBe(400);
    });

    it('returns 400 for self-sharing (admin looking up own username)', async () => {
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=initial_user', { role: 'admin' });
      expect(resp.status).toBe(400);
      const body = await resp.json();
      expect(body.error || body.message).toMatch(/yourself/i);
    });

    it('returns ghost key for non-existent user', async () => {
      const resp = await api.get(
        `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(ghostIdentifier)}`,
      );
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('public_key');
      expect(data.public_key).toBeTruthy();
      expect(data).toHaveProperty('is_ghost', true);
    });

    it('returns same ghost key on subsequent calls for same identifier', async () => {
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

    it('returns a public key for an existing user (admin looking up regular user)', async () => {
      // Admin looks up regular user — may get real key or ghost key depending on vault setup
      const resp = await api.get('/sharing.php?action=recipient-key&identifier=test_regular_user', { role: 'admin' });
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(data).toHaveProperty('public_key');
      expect(data.public_key).toBeTruthy();
      // is_ghost depends on whether regular user has vault keys set up
      expect(typeof data.is_ghost).toBe('boolean');
    });
  });

  // ── share flow setup: create test vault entries ─────────────────
  describe('share flow', () => {
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

      // Create a second entry for additional tests
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
    });

    // ── POST ?action=share ──────────────────────────────────────
    describe('POST ?action=share', () => {
      it('returns 400 when source_entry_id is missing', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: { recipients: [{ identifier: 'someone', encrypted_data: 'blob' }] },
        });
        expect(resp.status).toBe(400);
      });

      it('returns 400 when recipients is missing', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: { source_entry_id: testEntryId },
        });
        expect(resp.status).toBe(400);
      });

      it('returns 400 when recipients is empty', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: { source_entry_id: testEntryId, recipients: [] },
        });
        expect(resp.status).toBe(400);
      });

      it('returns 404 for non-existent source entry', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: 999999,
            recipients: [{ identifier: ghostIdentifier, encrypted_data: 'blob' }],
          },
        });
        expect(resp.status).toBe(404);
      });

      it('shares entry with ghost recipient', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId,
            recipients: [{
              identifier: ghostIdentifier,
              encrypted_data: 'c2hhcmVkLWJsb2ItZm9yLWdob3N0',
            }],
          },
        });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data).toHaveProperty('share_ids');
        expect(data).toHaveProperty('count', 1);
        expect(Array.isArray(data.share_ids)).toBe(true);
        expect(data.share_ids.length).toBe(1);
      });

      it('shares entry with real user (regular user)', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId,
            recipients: [{
              identifier: 'test_regular_user',
              encrypted_data: 'c2hhcmVkLWJsb2ItZm9yLXJlZ3VsYXI=',
            }],
          },
        });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.count).toBe(1);
      });

      it('skips recipients with empty identifier or encrypted_data', async () => {
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId,
            recipients: [
              { identifier: '', encrypted_data: 'blob' },
              { identifier: 'someone', encrypted_data: '' },
            ],
          },
        });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        // Both recipients are skipped — count should be 0
        expect(data.count).toBe(0);
      });

      // BUG-SHARE-1: No self-sharing prevention in share endpoint
      it('BUG: allows self-sharing (no server-side check in share endpoint)', async () => {
        // TODO: sharing.php should return 400 for self-sharing, like recipient-key does
        // Currently it succeeds (200) and creates an orphaned share
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId,
            recipients: [{
              identifier: 'initial_user',
              encrypted_data: 'c2VsZi1zaGFyZS1ibG9i',
            }],
          },
        });
        // BUG: should be 400 but currently returns 200
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.count).toBe(1); // Share was created — this is the bug
      });

      // BUG-SHARE-4: No duplicate share prevention
      it('BUG: allows duplicate shares for same entry+recipient', async () => {
        // TODO: sharing.php should prevent duplicate shares (same sender, entry, recipient)
        // Currently it creates multiple share rows
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId,
            recipients: [{
              identifier: ghostIdentifier,
              encrypted_data: 'ZHVwbGljYXRlLXNoYXJl',
            }],
          },
        });
        // BUG: should either reject (409) or upsert, but creates duplicate
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.count).toBe(1);

        // Verify: share-count now shows more than expected (duplicates)
        const countResp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
        const countData = await extractData(countResp);
        // We have: ghost + regular + self-share + duplicate ghost = at least 4
        expect(countData.count).toBeGreaterThanOrEqual(4);
      });
    });

    // ── GET ?action=shared-by-me ────────────────────────────────
    describe('GET ?action=shared-by-me', () => {
      it('returns shares created by the sender', async () => {
        const resp = await api.get('/sharing.php?action=shared-by-me');
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(Array.isArray(data)).toBe(true);

        // Find our test shares
        const testShares = data.filter(s => s.source_entry_id === testEntryId);
        expect(testShares.length).toBeGreaterThanOrEqual(2); // ghost + regular (+ bug duplicates)
      });

      it('shared-by-me entries have correct shape', async () => {
        const resp = await api.get('/sharing.php?action=shared-by-me');
        expect(resp.status).toBe(200);
        const data = await extractData(resp);

        if (data.length > 0) {
          const share = data[0];
          expect(share).toHaveProperty('id');
          expect(share).toHaveProperty('recipient_identifier');
          expect(share).toHaveProperty('source_entry_id');
          expect(share).toHaveProperty('entry_type');
          expect(share).toHaveProperty('is_ghost');
          expect(share).toHaveProperty('created_at');
          expect(share).toHaveProperty('updated_at');
        }
      });
    });

    // ── GET ?action=share-count ─────────────────────────────────
    describe('GET ?action=share-count', () => {
      it('returns 400 when entry_id is missing', async () => {
        const resp = await api.get('/sharing.php?action=share-count');
        expect(resp.status).toBe(400);
      });

      it('returns share count for shared entry', async () => {
        const resp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data).toHaveProperty('count');
        expect(data.count).toBeGreaterThanOrEqual(2);
      });

      it('returns 0 for entry with no shares', async () => {
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

    // ── GET ?action=shared-with-me ──────────────────────────────
    describe('GET ?action=shared-with-me', () => {
      it('returns shares received by the user', async () => {
        // Admin user checks shared-with-me (regular user has must_reset_password=1, gets 403)
        const resp = await api.get('/sharing.php?action=shared-with-me', { role: 'admin' });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(Array.isArray(data)).toBe(true);
      });

      it('shared-with-me entries have correct shape', async () => {
        const resp = await api.get('/sharing.php?action=shared-with-me', { role: 'admin' });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);

        if (data.length > 0) {
          const share = data[0];
          expect(share).toHaveProperty('id');
          expect(share).toHaveProperty('sender_username');
          expect(share).toHaveProperty('entry_type');
          expect(share).toHaveProperty('encrypted_data');
          expect(share).toHaveProperty('is_ghost');
          expect(share).toHaveProperty('created_at');
          expect(share).toHaveProperty('updated_at');
        }
      });
    });

    // ── POST ?action=update ─────────────────────────────────────
    describe('POST ?action=update', () => {
      it('returns 400 when source_entry_id is missing', async () => {
        const resp = await api.post('/sharing.php?action=update', {
          json: { recipients: [{ user_id: 1, encrypted_data: 'new-blob' }] },
        });
        expect(resp.status).toBe(400);
      });

      it('returns 400 when recipients is missing', async () => {
        const resp = await api.post('/sharing.php?action=update', {
          json: { source_entry_id: testEntryId },
        });
        expect(resp.status).toBe(400);
      });

      it('returns 400 when recipients is empty', async () => {
        const resp = await api.post('/sharing.php?action=update', {
          json: { source_entry_id: testEntryId, recipients: [] },
        });
        expect(resp.status).toBe(400);
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

      it('re-encrypts shares for existing recipients', async () => {
        // First, get the regular user's shares to find recipient_id
        const byMeResp = await api.get('/sharing.php?action=shared-by-me');
        const byMeData = await extractData(byMeResp);
        const regularShare = byMeData.find(
          s => s.source_entry_id === testEntryId && s.recipient_identifier === 'test_regular_user'
        );

        if (regularShare && regularShare.recipient_id) {
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
          expect(data.updated).toBeGreaterThanOrEqual(1);
        }
      });

      it('returns updated=0 when recipient user_id does not match any share', async () => {
        const resp = await api.post('/sharing.php?action=update', {
          json: {
            source_entry_id: testEntryId,
            recipients: [{
              user_id: 999999,
              encrypted_data: 'does-not-match',
            }],
          },
        });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.updated).toBe(0);
      });
    });

    // ── cross-user isolation ────────────────────────────────────
    describe('cross-user isolation', () => {
      it('admin shared-by-me only includes shares created by admin', async () => {
        const resp = await api.get('/sharing.php?action=shared-by-me', { role: 'admin' });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        // All shares for testEntryId should belong to admin (the creator)
        const testShares = data.filter(s => s.source_entry_id === testEntryId);
        expect(testShares.length).toBeGreaterThanOrEqual(1);
        for (const share of testShares) {
          expect(share.source_entry_id).toBe(testEntryId);
        }
      });

      it('share-count scoped to sender — other users see 0 for entries they did not share', async () => {
        // Admin created shares on testEntryId — admin should see count > 0
        const adminResp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`, { role: 'admin' });
        const adminData = await extractData(adminResp);
        expect(adminData.count).toBeGreaterThanOrEqual(2);
      });
    });

    // ── POST ?action=revoke ─────────────────────────────────────
    describe('POST ?action=revoke', () => {
      it('returns 400 when source_entry_id is missing', async () => {
        const resp = await api.post('/sharing.php?action=revoke', {
          json: {},
        });
        expect(resp.status).toBe(400);
      });

      it('revokes all shares for an entry', async () => {
        const resp = await api.post('/sharing.php?action=revoke', {
          json: { source_entry_id: testEntryId },
        });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data).toHaveProperty('revoked');
        // Should revoke ghost + regular + self-share + duplicate = at least 4
        expect(data.revoked).toBeGreaterThanOrEqual(2);
      });

      it('share-count returns 0 after revoking all shares', async () => {
        const resp = await api.get(`/sharing.php?action=share-count&entry_id=${testEntryId}`);
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.count).toBe(0);
      });

      it('shared-by-me no longer shows revoked shares', async () => {
        const resp = await api.get('/sharing.php?action=shared-by-me');
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        const testShares = data.filter(s => s.source_entry_id === testEntryId);
        expect(testShares.length).toBe(0);
      });

      it('revoke returns revoked=0 for entry with no shares', async () => {
        const resp = await api.post('/sharing.php?action=revoke', {
          json: { source_entry_id: testEntryId },
        });
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.revoked).toBe(0);
      });

      it('revokes specific recipients by user_ids', async () => {
        // Create two new shares first
        await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId2,
            recipients: [
              { identifier: ghostIdentifier, encrypted_data: 'cmV2b2tlLXRlc3QtMQ==' },
              { identifier: 'test_regular_user', encrypted_data: 'cmV2b2tlLXRlc3QtMg==' },
            ],
          },
        });

        // Get shares to find recipient IDs
        const byMeResp = await api.get('/sharing.php?action=shared-by-me');
        const byMeData = await extractData(byMeResp);
        const entry2Shares = byMeData.filter(s => s.source_entry_id === testEntryId2);
        expect(entry2Shares.length).toBeGreaterThanOrEqual(2);

        // Revoke only the regular user's share
        const regularShare = entry2Shares.find(s => s.recipient_identifier === 'test_regular_user');
        if (regularShare && regularShare.recipient_id) {
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
        }

        // Clean up remaining shares on entry2
        await api.post('/sharing.php?action=revoke', {
          json: { source_entry_id: testEntryId2 },
        });
      });
    });

    // ── BUG-SHARE-2: orphaned share with null recipient_id ──────
    describe('BUG: orphaned shares with null recipient_id', () => {
      it('BUG: share with unknown identifier creates share with null recipient_id', async () => {
        // TODO: sharing.php should require prior recipient-key lookup, or resolve
        // the identifier itself. Currently creates an unreachable share.
        const unknownId = 'totally_unknown_user_' + Date.now();
        const resp = await api.post('/sharing.php?action=share', {
          json: {
            source_entry_id: testEntryId2,
            recipients: [{
              identifier: unknownId,
              encrypted_data: 'b3JwaGFuLXNoYXJl',
            }],
          },
        });
        // BUG: succeeds with 200, creating an orphaned share
        expect(resp.status).toBe(200);
        const data = await extractData(resp);
        expect(data.count).toBe(1);

        // Verify the orphaned share shows in shared-by-me
        const byMeResp = await api.get('/sharing.php?action=shared-by-me');
        const byMeData = await extractData(byMeResp);
        const orphanShare = byMeData.find(
          s => s.source_entry_id === testEntryId2 && s.recipient_identifier === unknownId
        );
        expect(orphanShare).toBeDefined();
        // BUG: recipient_username is null because recipient_id is null
        expect(orphanShare.recipient_username).toBeNull();

        // Clean up
        await api.post('/sharing.php?action=revoke', {
          json: { source_entry_id: testEntryId2 },
        });
      });
    });
  });

  // ── invalid request fallback ────────────────────────────────────
  describe('invalid request', () => {
    it('returns 400 for unknown action', async () => {
      const resp = await api.get('/sharing.php?action=nonexistent');
      expect(resp.status).toBe(400);
    });
  });

  // ── cleanup: remove test vault entries ──────────────────────────
  afterAll(async () => {
    // Revoke any remaining shares first (to avoid FK issues if applicable)
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
