"""
Reference API Tests

Tests the historical-rates endpoint and verifies existing reference
endpoints still work (regression check).
"""
import pytest


# ---------------------------------------------------------------------------
# Historical Rates (new endpoint)
# ---------------------------------------------------------------------------

class TestHistoricalRates:
    """Tests for GET /reference.php?resource=historical-rates"""

    def test_valid_date(self, api):
        """Should return rates map for a date that has data, or 404 if none."""
        resp = api.get('/reference.php', params={
            'resource': 'historical-rates', 'date': '2026-03-14',
        })

        if resp.status_code == 404:
            # No rates for this date — acceptable if rates haven't been refreshed
            assert 'No rates found' in resp.json().get('error', '')
            pytest.skip('No rate history for this date')

        assert resp.status_code == 200
        data = api.data(resp)
        assert 'date' in data
        assert 'base_currency' in data
        assert 'rates' in data
        assert isinstance(data['rates'], dict)

        for code, rate in data['rates'].items():
            assert isinstance(rate, (int, float)), f'Rate for {code} not numeric'
            assert rate > 0, f'Rate for {code} should be positive'

    def test_missing_date_400(self, api):
        """Should return 400 when date param is missing."""
        resp = api.get('/reference.php', params={'resource': 'historical-rates'})
        assert resp.status_code == 400

    def test_invalid_date_400(self, api):
        """Should return 400 for garbage date string."""
        resp = api.get('/reference.php', params={
            'resource': 'historical-rates', 'date': 'not-a-date',
        })
        assert resp.status_code == 400

    def test_future_date_404(self, api):
        """Should return 404 for a far future date with no data."""
        resp = api.get('/reference.php', params={
            'resource': 'historical-rates', 'date': '2030-01-01',
        })
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Regression: existing endpoints still work
# ---------------------------------------------------------------------------

class TestReferenceRegression:
    """Verify existing reference endpoints weren't broken."""

    def test_currencies(self, api):
        """GET currencies should return a non-empty list with code field."""
        resp = api.get('/reference.php', params={'resource': 'currencies'})
        assert resp.status_code == 200
        data = api.data(resp)
        assert isinstance(data, list)
        assert len(data) > 0
        assert 'code' in data[0]

    def test_countries(self, api):
        """GET countries should return a list."""
        resp = api.get('/reference.php', params={'resource': 'countries'})
        assert resp.status_code == 200
        assert isinstance(api.data(resp), list)

    def test_config(self, api):
        """GET config should return base_currency."""
        resp = api.get('/reference.php', params={'resource': 'config'})
        assert resp.status_code == 200
        assert 'base_currency' in api.data(resp)

    def test_invalid_resource_404(self, api):
        """Unknown resource should return 404."""
        resp = api.get('/reference.php', params={'resource': 'nonexistent'})
        assert resp.status_code == 404
