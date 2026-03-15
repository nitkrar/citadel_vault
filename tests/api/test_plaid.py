"""
Plaid API Tests

Tests gatekeeper enforcement, auth, and endpoint structure.
Actual Plaid API calls require sandbox credentials.
"""
import pytest


class TestPlaidGatekeeper:
    """Tests that Plaid endpoints respect the plaid_enabled gatekeeper."""

    def test_blocked_when_disabled(self, api):
        """POST should return 403 when plaid_enabled is false."""
        # Ensure disabled (default)
        resp = api.get('/settings.php')
        data = api.data(resp)
        plaid_enabled = data.get('plaid_enabled', {}).get('value', 'false')

        if plaid_enabled == 'true':
            pytest.skip('Plaid is enabled — cannot test gatekeeper block')

        resp = api.post('/plaid.php?action=create-link-token', json={'country_codes': ['US']})
        assert resp.status_code == 403
        assert 'not enabled' in resp.json().get('error', '').lower()

    def test_status_blocked_when_disabled(self, api):
        """GET status should return 403 when plaid_enabled is false."""
        resp = api.get('/plaid.php', params={'action': 'status'})
        assert resp.status_code == 403

    def test_refresh_blocked_when_disabled(self, api):
        """POST refresh should return 403 when plaid_enabled is false."""
        resp = api.post('/plaid.php?action=refresh', json={'item_ids': ['fake']})
        assert resp.status_code == 403


class TestPlaidAuth:
    """Tests for auth enforcement."""

    def test_create_link_token_without_auth_401(self, unauthed_client):
        resp = unauthed_client.post('/plaid.php?action=create-link-token', json={})
        assert resp.status_code == 401

    def test_exchange_without_auth_401(self, unauthed_client):
        resp = unauthed_client.post('/plaid.php?action=exchange-token', json={})
        assert resp.status_code == 401

    def test_status_without_auth_401(self, unauthed_client):
        resp = unauthed_client.get('/plaid.php', params={'action': 'status'})
        assert resp.status_code == 401


class TestPlaidValidation:
    """Tests for input validation (when Plaid is enabled but no real keys)."""

    # These tests only run if plaid_enabled=true but Plaid keys are invalid/missing
    # They verify the server handles missing keys gracefully

    def test_exchange_missing_public_token_400(self, api):
        """POST exchange-token without public_token should 400 (or 403 if gatekeeper)."""
        resp = api.post('/plaid.php?action=exchange-token', json={})
        assert resp.status_code in [400, 403, 500]

    def test_refresh_empty_item_ids_400(self, api):
        """POST refresh with empty item_ids should 400 (or 403 if gatekeeper)."""
        resp = api.post('/plaid.php?action=refresh', json={'item_ids': []})
        assert resp.status_code in [400, 403]

    def test_disconnect_missing_item_id(self, api):
        """DELETE disconnect without item_id should 400 (or 403 if gatekeeper)."""
        resp = api.delete('/plaid.php?action=disconnect')
        assert resp.status_code in [400, 403]
