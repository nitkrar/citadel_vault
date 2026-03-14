"""
Snapshot API Tests

Tests the split snapshot model (v3): header meta + per-entry encrypted blobs.
Also verifies backward compatibility with legacy single-blob snapshots.

The backend treats encrypted_data as opaque strings, so we use plaintext
JSON strings as stand-ins — no real encryption needed for API contract tests.
"""
import json
import pytest

TODAY = '2026-03-14'


# ---------------------------------------------------------------------------
# POST — Save snapshots
# ---------------------------------------------------------------------------

class TestSnapshotSave:
    """Tests for POST /snapshots.php"""

    def test_legacy_single_blob(self, api, snapshot_cleanup):
        """Legacy v2 single-blob snapshot should still save."""
        snapshot_cleanup.track(TODAY)
        resp = api.post('/snapshots.php', json={
            'snapshot_date': TODAY,
            'encrypted_data': json.dumps({
                'v': 2, 'net_worth': 50000,
                'total_assets': 60000, 'total_liabilities': 10000,
                'asset_count': 5,
            }),
        })
        assert resp.status_code == 201
        assert api.data(resp)['message'] == 'Snapshot saved.'

    def test_split_model_v3(self, api, snapshot_cleanup):
        """v3 split snapshot with meta + per-entry blobs should save."""
        snapshot_cleanup.track(TODAY)
        resp = api.post('/snapshots.php', json={
            'snapshot_date': TODAY,
            'encrypted_meta': json.dumps({
                'base_currency': 'GBP',
                'date': '2026-03-14T10:00:00.000Z',
            }),
            'entries': [
                {
                    'entry_id': None,
                    'encrypted_data': json.dumps({
                        'name': 'AAPL Shares', 'template_name': 'Stocks',
                        'subtype': 'stocks', 'is_liability': False,
                        'currency': 'USD', 'raw_value': 5000,
                        'icon': 'trending-up',
                    }),
                },
                {
                    'entry_id': None,
                    'encrypted_data': json.dumps({
                        'name': 'Credit Card', 'template_name': 'Credit Card',
                        'subtype': 'credit_card', 'is_liability': True,
                        'currency': 'GBP', 'raw_value': -2000,
                        'icon': 'credit-card',
                    }),
                },
            ],
        })
        assert resp.status_code == 201

    def test_missing_date_rejected(self, api):
        """POST without snapshot_date should return 400."""
        resp = api.post('/snapshots.php', json={
            'encrypted_data': 'test',
        })
        assert resp.status_code == 400

    def test_empty_entries_rejected(self, api):
        """POST split model with empty entries array should return 400."""
        resp = api.post('/snapshots.php', json={
            'snapshot_date': TODAY,
            'encrypted_meta': json.dumps({'base_currency': 'GBP'}),
            'entries': [],
        })
        assert resp.status_code == 400

    def test_entry_missing_data_rejected(self, api):
        """POST split model with entry missing encrypted_data should return 400."""
        resp = api.post('/snapshots.php', json={
            'snapshot_date': TODAY,
            'encrypted_meta': json.dumps({'base_currency': 'GBP'}),
            'entries': [{'entry_id': None}],
        })
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET — Read snapshots
# ---------------------------------------------------------------------------

class TestSnapshotRead:
    """Tests for GET /snapshots.php — depends on saves above."""

    def test_returns_list(self, api):
        """GET should return a list of snapshots."""
        resp = api.get('/snapshots.php')
        assert resp.status_code == 200
        data = api.data(resp)
        assert isinstance(data, list)

    def test_v3_snapshot_has_entries(self, api):
        """v3 snapshots should include an entries array."""
        resp = api.get('/snapshots.php')
        snapshots = api.data(resp)
        v3 = [s for s in snapshots if s.get('entries')]
        assert len(v3) > 0, 'No v3 snapshots with entries found'

        snap = v3[0]
        assert 'snapshot_date' in snap
        assert 'data' in snap  # meta blob
        assert len(snap['entries']) == 2

        entry = snap['entries'][0]
        assert 'encrypted_data' in entry
        assert 'entry_id' in entry

    def test_legacy_snapshot_no_entries(self, api):
        """Legacy snapshots should not have entries key."""
        resp = api.get('/snapshots.php')
        snapshots = api.data(resp)
        legacy = [s for s in snapshots if 'entries' not in s]
        assert len(legacy) > 0, 'No legacy snapshots found'

    def test_date_filter(self, api):
        """GET with from/to params should filter by date."""
        resp = api.get('/snapshots.php', params={'from': TODAY, 'to': TODAY})
        assert resp.status_code == 200
        snapshots = api.data(resp)
        for s in snapshots:
            assert s['snapshot_date'] == TODAY


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------

class TestSnapshotAuth:
    """Verify auth is enforced on snapshot endpoints."""

    def test_get_without_auth(self):
        """GET without auth token should return 401."""
        import requests
        resp = requests.get('http://localhost:8081/src/api/snapshots.php')
        assert resp.status_code == 401

    def test_post_without_auth(self):
        """POST without auth token should return 401."""
        import requests
        resp = requests.post('http://localhost:8081/src/api/snapshots.php',
                             json={'snapshot_date': TODAY, 'encrypted_data': 'x'})
        assert resp.status_code == 401
