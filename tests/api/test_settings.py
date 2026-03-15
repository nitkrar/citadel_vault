"""
System Settings API Tests

Tests for GET/PUT /settings.php — system-wide KV store.
GET is available to any authenticated user.
PUT is admin-only with an allowlisted set of keys.
"""
import pytest


class TestGetSettings:
    """GET /settings.php — read all system settings."""

    def test_returns_settings(self, api):
        resp = api.get('/settings.php')
        assert resp.status_code == 200
        data = api.data(resp)
        assert isinstance(data, dict)
        assert 'ticker_price_ttl' in data

    def test_returns_default_vault_tab(self, api):
        resp = api.get('/settings.php')
        data = api.data(resp)
        assert 'default_vault_tab' in data
        assert data['default_vault_tab'] in ('all', 'account', 'asset', 'password', 'license', 'insurance', 'custom')

    def test_unauthenticated_rejected(self, unauthed_client):
        resp = unauthed_client.get('/settings.php')
        assert resp.status_code == 401


class TestPutSettings:
    """PUT /settings.php — upsert system settings (admin only)."""

    def test_update_ticker_price_ttl(self, api):
        # Save original
        original = api.data(api.get('/settings.php')).get('ticker_price_ttl', '86400')

        # Update
        resp = api.put('/settings.php', json={'ticker_price_ttl': '3600'})
        assert resp.status_code == 200

        # Verify
        data = api.data(api.get('/settings.php'))
        assert data['ticker_price_ttl'] == '3600'

        # Restore
        api.put('/settings.php', json={'ticker_price_ttl': original})

    def test_update_default_vault_tab(self, api):
        original = api.data(api.get('/settings.php')).get('default_vault_tab', 'account')

        resp = api.put('/settings.php', json={'default_vault_tab': 'asset'})
        assert resp.status_code == 200

        data = api.data(api.get('/settings.php'))
        assert data['default_vault_tab'] == 'asset'

        # Restore
        api.put('/settings.php', json={'default_vault_tab': original})

    def test_unknown_keys_ignored(self, api):
        resp = api.put('/settings.php', json={'bogus_key': 'value'})
        assert resp.status_code == 400
        assert 'No valid settings' in resp.json().get('error', '')

    def test_empty_body_rejected(self, api):
        resp = api.put('/settings.php', json={})
        assert resp.status_code == 400

    def test_unauthenticated_rejected(self, unauthed_client):
        resp = unauthed_client.put('/settings.php', json={'ticker_price_ttl': '3600'})
        assert resp.status_code == 401


class TestSettingsInConfig:
    """System settings should be included in /reference.php?resource=config."""

    def test_config_includes_system_settings(self, api):
        resp = api.get('/reference.php?resource=config')
        assert resp.status_code == 200
        data = api.data(resp)
        assert 'base_currency' in data
        assert 'ticker_price_ttl' in data
        assert 'default_vault_tab' in data
