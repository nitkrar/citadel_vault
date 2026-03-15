"""
Settings API Tests

Tests for GET/PUT /settings.php — system settings CRUD.
"""
import pytest


class TestSettingsGet:
    """Tests for GET /settings.php"""

    def test_returns_settings(self, api):
        """Should return system settings as a key-value object."""
        resp = api.get('/settings.php')
        assert resp.status_code == 200
        data = api.data(resp)
        assert isinstance(data, dict)

    def test_includes_expected_keys(self, api):
        """Should include all expected setting keys."""
        resp = api.get('/settings.php')
        assert resp.status_code == 200
        data = api.data(resp)
        for key in ['auth_check_interval', 'self_registration', 'require_email_verification']:
            assert key in data, f'Missing setting: {key}'

    def test_unauthenticated_401(self, unauthed_client):
        """Should reject unauthenticated requests."""
        resp = unauthed_client.get('/settings.php')
        assert resp.status_code == 401


class TestSettingsPut:
    """Tests for PUT /settings.php"""

    def test_update_auth_check_interval(self, api):
        """Should update auth_check_interval and read it back."""
        # Save original
        original = api.data(api.get('/settings.php')).get('auth_check_interval')

        # Update to 900
        resp = api.put('/settings.php', json={'auth_check_interval': '900'})
        assert resp.status_code == 200

        # Verify
        data = api.data(api.get('/settings.php'))
        assert data['auth_check_interval'] == '900'

        # Restore original
        if original is not None:
            api.put('/settings.php', json={'auth_check_interval': original})

    def test_update_self_registration(self, api):
        """Should update self_registration and read it back."""
        original = api.data(api.get('/settings.php')).get('self_registration')

        resp = api.put('/settings.php', json={'self_registration': 'true'})
        assert resp.status_code == 200

        data = api.data(api.get('/settings.php'))
        assert data['self_registration'] == 'true'

        # Restore
        if original is not None:
            api.put('/settings.php', json={'self_registration': original})

    def test_update_require_email_verification(self, api):
        """Should update require_email_verification and read it back."""
        original = api.data(api.get('/settings.php')).get('require_email_verification')

        resp = api.put('/settings.php', json={'require_email_verification': 'false'})
        assert resp.status_code == 200

        data = api.data(api.get('/settings.php'))
        assert data['require_email_verification'] == 'false'

        # Restore
        if original is not None:
            api.put('/settings.php', json={'require_email_verification': original})

    def test_registration_status_reflects_settings(self, api):
        """registration-status endpoint should reflect system_settings values."""
        import requests
        # Read current settings
        settings = api.data(api.get('/settings.php'))

        # Check registration-status (unauthenticated endpoint)
        resp = requests.get(f'{api.base_url}/auth.php?action=registration-status')
        assert resp.status_code == 200
        status = resp.json().get('data', resp.json())

        # Values should match (system_settings stores strings, endpoint returns booleans)
        assert status['self_registration'] == (settings['self_registration'] == 'true')
        assert status['require_email_verification'] == (settings['require_email_verification'] == 'true')

    def test_rejects_unknown_keys(self, api):
        """Should ignore unknown setting keys."""
        resp = api.put('/settings.php', json={'not_a_real_key': 'value'})
        assert resp.status_code == 400
        assert 'No valid settings' in resp.json().get('error', '')

    def test_empty_body_400(self, api):
        """Should reject empty body."""
        resp = api.put('/settings.php', json={})
        assert resp.status_code == 400

    def test_unauthenticated_401(self, unauthed_client):
        """Should reject unauthenticated PUT."""
        resp = unauthed_client.put('/settings.php', json={'auth_check_interval': '60'})
        assert resp.status_code == 401
