/**
 * Snapshot API Integration Tests
 *
 * Tests the split snapshot model (v3): header meta + per-entry encrypted blobs.
 * The backend treats encrypted_data as opaque strings, so we use plaintext
 * JSON strings as stand-ins — no real encryption needed for API contract tests.
 *
 * Requires: php -S localhost:8081 router.php
 */
import { describe, it, expect } from 'vitest';
import { api, extractData, unauthRequest } from '../helpers/apiClient.js';

const TODAY = '2026-03-14';

describe('Snapshot API', () => {

  // ── POST — Save snapshots ───────────────────────────────────────
  describe('POST (save snapshot)', () => {
    it('saves v3 split snapshot with meta + per-entry blobs', async () => {
      const resp = await api.post('/snapshots.php', {
        json: {
          snapshot_date: TODAY,
          encrypted_meta: JSON.stringify({
            base_currency: 'GBP',
            date: '2026-03-14T10:00:00.000Z',
          }),
          entries: [
            {
              entry_id: null,
              encrypted_data: JSON.stringify({
                name: 'AAPL Shares', template_name: 'Stocks',
                subtype: 'stocks', is_liability: false,
                currency: 'USD', raw_value: 5000,
                icon: 'trending-up',
              }),
            },
            {
              entry_id: null,
              encrypted_data: JSON.stringify({
                name: 'Credit Card', template_name: 'Credit Card',
                subtype: 'credit_card', is_liability: true,
                currency: 'GBP', raw_value: -2000,
                icon: 'credit-card',
              }),
            },
          ],
        },
      });
      expect(resp.status).toBe(201);
    });

    it('returns 400 for missing snapshot_date', async () => {
      const resp = await api.post('/snapshots.php', {
        json: {
          encrypted_meta: 'test',
          entries: [{ encrypted_data: 'x' }],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for missing encrypted_meta', async () => {
      const resp = await api.post('/snapshots.php', {
        json: {
          snapshot_date: TODAY,
          entries: [{ encrypted_data: 'x' }],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for empty entries array', async () => {
      const resp = await api.post('/snapshots.php', {
        json: {
          snapshot_date: TODAY,
          encrypted_meta: JSON.stringify({ base_currency: 'GBP' }),
          entries: [],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('returns 400 for entry missing encrypted_data', async () => {
      const resp = await api.post('/snapshots.php', {
        json: {
          snapshot_date: TODAY,
          encrypted_meta: JSON.stringify({ base_currency: 'GBP' }),
          entries: [{ entry_id: null }],
        },
      });
      expect(resp.status).toBe(400);
    });

    it('rejects legacy v2 single-blob format', async () => {
      const resp = await api.post('/snapshots.php', {
        json: {
          snapshot_date: TODAY,
          encrypted_data: JSON.stringify({ v: 2, net_worth: 50000 }),
        },
      });
      expect(resp.status).toBe(400);
    });
  });

  // ── GET — Read snapshots ────────────────────────────────────────
  describe('GET (read snapshots)', () => {
    it('returns a list of snapshots', async () => {
      const resp = await api.get('/snapshots.php');
      expect(resp.status).toBe(200);
      const data = await extractData(resp);
      expect(Array.isArray(data)).toBe(true);
    });

    it('snapshots include entries array', async () => {
      const resp = await api.get('/snapshots.php');
      const snapshots = await extractData(resp);
      const withEntries = snapshots.filter(s => s.entries && s.entries.length > 0);
      expect(withEntries.length).toBeGreaterThan(0);

      const snap = withEntries[0];
      expect(snap).toHaveProperty('snapshot_date');
      expect(snap).toHaveProperty('data');
      expect(snap.entries.length).toBeGreaterThanOrEqual(1);

      const entry = snap.entries[0];
      expect(entry).toHaveProperty('encrypted_data');
      expect(entry).toHaveProperty('entry_id');
    });

    it('every snapshot has entries key (v3 only)', async () => {
      const resp = await api.get('/snapshots.php');
      const snapshots = await extractData(resp);
      for (const s of snapshots) {
        expect(s).toHaveProperty('entries');
      }
    });

    it('filters by from/to date params', async () => {
      const resp = await api.get('/snapshots.php', {
        params: { from: TODAY, to: TODAY },
      });
      expect(resp.status).toBe(200);
      const snapshots = await extractData(resp);
      for (const s of snapshots) {
        expect(s.snapshot_date).toBe(TODAY);
      }
    });
  });

  // ── Auth enforcement ────────────────────────────────────────────
  describe('auth enforcement', () => {
    it('GET returns 401 without auth', async () => {
      const resp = await unauthRequest('GET', '/snapshots.php');
      expect(resp.status).toBe(401);
    });

    it('POST returns 401 without auth', async () => {
      const resp = await unauthRequest('POST', '/snapshots.php', {
        json: {
          snapshot_date: TODAY,
          encrypted_meta: 'x',
          entries: [{ encrypted_data: 'x' }],
        },
      });
      expect(resp.status).toBe(401);
    });
  });
});
