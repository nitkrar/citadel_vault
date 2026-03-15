"""
Settings API Tests

Tests the enriched settings response and admin-only write access.
"""
import pytest


class TestSettingsGet:
    """Tests for GET /settings.php"""

    def test_returns_enriched_settings(self, api):
        """GET should return settings with metadata."""
        resp = api.get('/settings.php')
        assert resp.status_code == 200
        data = api.data(resp)
        assert isinstance(data, dict)
        # Check a known setting has enriched fields
        assert 'self_registration' in data
        setting = data['self_registration']
        assert 'value' in setting
        assert 'type' in setting
        assert 'category' in setting
        assert 'description' in setting

    def test_gatekeeper_has_type(self, api):
        """Gatekeeper settings should have type='gatekeeper'."""
        resp = api.get('/settings.php')
        data = api.data(resp)
        assert data['self_registration']['type'] == 'gatekeeper'
        assert data['worker_mode']['type'] == 'gatekeeper'

    def test_config_has_type(self, api):
        """Config settings should have type='config'."""
        resp = api.get('/settings.php')
        data = api.data(resp)
        assert data['ticker_price_ttl']['type'] == 'config'
        assert data['worker_threshold']['type'] == 'config'

    def test_options_is_list_or_null(self, api):
        """Options should be a list when present, null otherwise."""
        resp = api.get('/settings.php')
        data = api.data(resp)
        # With options
        assert isinstance(data['ticker_price_ttl']['options'], list)
        assert len(data['ticker_price_ttl']['options']) > 0
        # Without options
        assert data['worker_threshold']['options'] is None

    def test_all_settings_have_category(self, api):
        """Every setting should have a non-empty category."""
        resp = api.get('/settings.php')
        data = api.data(resp)
        for key, setting in data.items():
            assert setting['category'], f'{key} has empty category'

    def test_all_settings_have_description(self, api):
        """Every setting should have a description."""
        resp = api.get('/settings.php')
        data = api.data(resp)
        for key, setting in data.items():
            assert setting['description'], f'{key} has empty description'


class TestSettingsPut:
    """Tests for PUT /settings.php"""

    def test_update_existing_setting(self, api):
        """PUT should update a known setting."""
        # Save original
        resp = api.get('/settings.php')
        original = api.data(resp)['ticker_price_ttl']['value']
        try:
            resp = api.put('/settings.php', json={'ticker_price_ttl': '3600'})
            assert resp.status_code == 200
            # Verify
            resp = api.get('/settings.php')
            assert api.data(resp)['ticker_price_ttl']['value'] == '3600'
        finally:
            api.put('/settings.php', json={'ticker_price_ttl': original})

    def test_reject_unknown_key(self, api):
        """PUT with unknown key should return 400 (no valid settings)."""
        resp = api.put('/settings.php', json={'nonexistent_key': 'value'})
        assert resp.status_code == 400

    def test_empty_body_400(self, api):
        """PUT with empty body should return 400."""
        resp = api.put('/settings.php', json={})
        assert resp.status_code == 400


class TestSettingsAuth:
    """Tests for auth enforcement."""

    def test_get_without_auth_401(self, unauthed_client):
        """GET without auth should return 401."""
        resp = unauthed_client.get('/settings.php')
        assert resp.status_code == 401

    def test_put_without_auth_401(self, unauthed_client):
        """PUT without auth should return 401."""
        resp = unauthed_client.put('/settings.php', json={'ticker_price_ttl': '3600'})
        assert resp.status_code == 401
