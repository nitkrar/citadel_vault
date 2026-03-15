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
        for key in ['auth_check_interval', 'self_registration', 'require_email_verification',
                    'invite_expiry_days', 'lockout_tier3_duration']:
            assert key in data, f'Missing setting: {key}'

    def test_unauthenticated_401(self, unauthed_client):
        """Should reject unauthenticated requests."""
        resp = unauthed_client.get('/settings.php')
        assert resp.status_code == 401


class TestSettingsPut:
    """Tests for PUT /settings.php"""

    @pytest.mark.parametrize('key,test_value', [
        ('auth_check_interval', '900'),
        ('self_registration', 'true'),
        ('require_email_verification', 'false'),
        ('invite_expiry_days', '14'),
        ('lockout_tier3_duration', '2592000'),
    ])
    def test_update_setting_roundtrip(self, api, key, test_value):
        """Should update a setting and read it back."""
        original = api.data(api.get('/settings.php')).get(key)

        resp = api.put('/settings.php', json={key: test_value})
        assert resp.status_code == 200

        data = api.data(api.get('/settings.php'))
        assert data[key] == test_value

        # Restore
        if original is not None:
            api.put('/settings.php', json={key: original})

    def test_registration_status_reflects_settings(self, api):
        """registration-status endpoint should reflect system_settings values."""
        import requests
        settings = api.data(api.get('/settings.php'))

        resp = requests.get(f'{api.base_url}/auth.php?action=registration-status')
        assert resp.status_code == 200
        status = resp.json().get('data', resp.json())

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
