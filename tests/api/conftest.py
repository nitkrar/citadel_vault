"""
Citadel API Test Fixtures

Session-scoped fixtures for authentication, API helpers, and test data cleanup.
Run with: pytest tests/api/ -v
Requires: php -S localhost:8081 router.php
"""
import pytest
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = 'http://localhost:8081/src/api'

# Test credentials — must exist in local DB
TEST_USERS = {
    'admin': {'username': 'initial_user', 'password': 'Initial#12$'},
    # Add more user types here as needed:
    # 'regular': {'username': 'test_regular', 'password': 'Test#Regular1'},
}


# ---------------------------------------------------------------------------
# API helper class — passed to tests as a fixture
# ---------------------------------------------------------------------------

class ApiClient:
    """Thin wrapper around requests for authenticated API calls."""

    def __init__(self, base_url, token):
        self.base_url = base_url
        self.token = token
        self.headers = {'Authorization': f'Bearer {token}'}

    def get(self, path, params=None):
        return requests.get(f'{self.base_url}{path}', headers=self.headers, params=params)

    def post(self, path, json=None):
        return requests.post(f'{self.base_url}{path}', headers=self.headers, json=json)

    def put(self, path, json=None):
        return requests.put(f'{self.base_url}{path}', headers=self.headers, json=json)

    def delete(self, path):
        return requests.delete(f'{self.base_url}{path}', headers=self.headers)

    @staticmethod
    def data(resp):
        """Extract 'data' from standard API response envelope."""
        body = resp.json()
        return body.get('data', body)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='session')
def base_url():
    """Base URL for the API. Checks server is reachable and returning JSON."""
    try:
        resp = requests.get(f'{BASE_URL}/auth.php?action=registration-status', timeout=3)
    except requests.ConnectionError:
        pytest.skip(f'Dev server not running at {BASE_URL}. Start with: php -S localhost:8081 router.php')

    # Check the server is returning JSON, not PHP errors
    content_type = resp.headers.get('Content-Type', '')
    if 'json' not in content_type:
        pytest.skip(
            f'Dev server returning non-JSON ({content_type}). '
            f'Restart from project root: cd citadel && php -S localhost:8081 router.php'
        )

    assert resp.status_code == 200, f'Server health check failed: {resp.status_code}'
    return BASE_URL


@pytest.fixture(scope='session')
def admin_token(base_url):
    """Login as admin user, return JWT token. Session-scoped = one login per run."""
    creds = TEST_USERS['admin']
    resp = requests.post(f'{base_url}/auth.php?action=login', json={
        'username': creds['username'],
        'password': creds['password'],
    })
    assert resp.status_code == 200, f'Admin login failed: {resp.status_code} {resp.text}'

    try:
        data = resp.json()
    except requests.exceptions.JSONDecodeError:
        pytest.fail(f'Login returned non-JSON. Server may need restart from project root. Body: {resp.text[:200]}')

    token = data.get('data', {}).get('token') or data.get('token')
    assert token, f'No token in login response: {data}'
    return token


@pytest.fixture(scope='session')
def api(base_url, admin_token):
    """Authenticated API client for the admin user."""
    return ApiClient(base_url, admin_token)


@pytest.fixture(scope='session')
def snapshot_cleanup(api):
    """
    Track snapshot dates created during tests, clean up after session.

    Usage in tests:
        def test_something(api, snapshot_cleanup):
            snapshot_cleanup.track('2026-03-14')
            api.post('/snapshots.php', json={...})

    Cleanup deletes by re-fetching and noting — but since snapshots API
    has no DELETE endpoint, we just accept accumulation for now.
    This fixture exists so we can add proper cleanup when a DELETE endpoint is added.
    """
    class SnapshotTracker:
        def __init__(self):
            self.dates = set()

        def track(self, date):
            self.dates.add(date)

    tracker = SnapshotTracker()
    yield tracker
    # Future: delete tracked snapshots when API supports it


@pytest.fixture
def unauthed_client(base_url):
    """An API client with no auth token — for testing auth enforcement."""
    return ApiClient(base_url, token='invalid-token-for-testing')
