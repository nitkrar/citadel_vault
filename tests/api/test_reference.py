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


# ---------------------------------------------------------------------------
# Countries: is_active filtering and inline editing
# ---------------------------------------------------------------------------

class TestCountriesActive:
    """Tests for countries is_active toggle and active-only filtering."""

    def _get_test_country(self, api):
        """Get a country to test with (pick last one to avoid disrupting common ones)."""
        resp = api.get('/reference.php', params={'resource': 'countries', 'all': '1'})
        assert resp.status_code == 200
        data = api.data(resp)
        assert len(data) > 0
        return data[-1]

    def test_countries_include_is_active_field(self, api):
        """GET countries should include is_active field."""
        resp = api.get('/reference.php', params={'resource': 'countries', 'all': '1'})
        assert resp.status_code == 200
        data = api.data(resp)
        assert len(data) > 0
        assert 'is_active' in data[0]

    def test_countries_default_returns_active_only(self, api):
        """GET countries without all=1 should return only active countries."""
        resp = api.get('/reference.php', params={'resource': 'countries'})
        assert resp.status_code == 200
        data = api.data(resp)
        for c in data:
            assert int(c['is_active']) == 1, f"Inactive country {c['name']} returned without all=1"

    def test_countries_all_returns_inactive_too(self, api):
        """GET countries with all=1 should include inactive countries."""
        country = self._get_test_country(api)
        # Deactivate
        api.put(f"/reference.php?resource=countries&id={country['id']}", json={'is_active': 0})
        try:
            # Default GET should exclude it
            resp = api.get('/reference.php', params={'resource': 'countries'})
            active_ids = [c['id'] for c in api.data(resp)]
            assert country['id'] not in active_ids

            # all=1 should include it
            resp = api.get('/reference.php', params={'resource': 'countries', 'all': '1'})
            all_ids = [c['id'] for c in api.data(resp)]
            assert country['id'] in all_ids
        finally:
            # Re-activate
            api.put(f"/reference.php?resource=countries&id={country['id']}", json={'is_active': 1})

    def test_toggle_country_active(self, api):
        """PUT is_active should toggle country active status."""
        country = self._get_test_country(api)
        original = int(country['is_active'])

        # Toggle off
        resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={'is_active': 0})
        assert resp.status_code == 200
        assert int(api.data(resp)['is_active']) == 0

        # Toggle back on
        resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={'is_active': 1})
        assert resp.status_code == 200
        assert int(api.data(resp)['is_active']) == 1


# ---------------------------------------------------------------------------
# Inline editing: countries and currencies
# ---------------------------------------------------------------------------

class TestInlineEditCountries:
    """Tests for inline editing country fields via PUT."""

    def _get_test_country(self, api):
        resp = api.get('/reference.php', params={'resource': 'countries', 'all': '1'})
        return api.data(resp)[-1]

    def test_edit_country_name(self, api):
        """PUT name should update country name."""
        country = self._get_test_country(api)
        original_name = country['name']
        new_name = original_name + ' (Test)'
        try:
            resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={'name': new_name})
            assert resp.status_code == 200
            assert api.data(resp)['name'] == new_name
        finally:
            api.put(f"/reference.php?resource=countries&id={country['id']}", json={'name': original_name})

    def test_edit_country_code(self, api):
        """PUT code should update country code."""
        country = self._get_test_country(api)
        original_code = country['code']
        new_code = 'ZZ'
        try:
            resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={'code': new_code})
            assert resp.status_code == 200
            assert api.data(resp)['code'] == new_code
        finally:
            api.put(f"/reference.php?resource=countries&id={country['id']}", json={'code': original_code})

    def test_edit_country_flag(self, api):
        """PUT flag_emoji should update country flag."""
        country = self._get_test_country(api)
        original_flag = country['flag_emoji']
        try:
            resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={'flag_emoji': '🏳️'})
            assert resp.status_code == 200
            assert api.data(resp)['flag_emoji'] is not None
        finally:
            api.put(f"/reference.php?resource=countries&id={country['id']}", json={'flag_emoji': original_flag})

    def test_edit_country_default_currency(self, api):
        """PUT default_currency_id should update default currency."""
        country = self._get_test_country(api)
        original_currency = country['default_currency_id']
        # Use currency id=1 as test value
        try:
            resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={'default_currency_id': 1})
            assert resp.status_code == 200
            assert int(api.data(resp)['default_currency_id']) == 1
        finally:
            api.put(f"/reference.php?resource=countries&id={country['id']}",
                    json={'default_currency_id': original_currency})

    def test_edit_country_empty_body_400(self, api):
        """PUT with empty body should return 400."""
        country = self._get_test_country(api)
        resp = api.put(f"/reference.php?resource=countries&id={country['id']}", json={})
        assert resp.status_code == 400
        assert 'No fields' in resp.json().get('error', '')

    def test_edit_nonexistent_country_404(self, api):
        """PUT on non-existent country should return 404."""
        resp = api.put('/reference.php?resource=countries&id=999999', json={'name': 'Test'})
        assert resp.status_code == 404


class TestInlineEditCurrencies:
    """Tests for inline editing currency fields via PUT."""

    def _get_test_currency(self, api):
        resp = api.get('/reference.php', params={'resource': 'currencies', 'all': '1'})
        return api.data(resp)[-1]

    def test_edit_currency_code(self, api):
        """PUT code should update currency code."""
        currency = self._get_test_currency(api)
        original_code = currency['code']
        new_code = original_code + 'X'
        try:
            resp = api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={'code': new_code})
            assert resp.status_code == 200
            assert api.data(resp)['code'] == new_code
        finally:
            api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={'code': original_code})

    def test_edit_currency_name(self, api):
        """PUT name should update currency name."""
        currency = self._get_test_currency(api)
        original_name = currency['name']
        new_name = original_name + ' (Test)'
        try:
            resp = api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={'name': new_name})
            assert resp.status_code == 200
            assert api.data(resp)['name'] == new_name
        finally:
            api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={'name': original_name})

    def test_edit_currency_symbol(self, api):
        """PUT symbol should update currency symbol."""
        currency = self._get_test_currency(api)
        original_symbol = currency['symbol']
        try:
            resp = api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={'symbol': '¤'})
            assert resp.status_code == 200
            assert api.data(resp)['symbol'] == '¤'
        finally:
            api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={'symbol': original_symbol})

    def test_edit_currency_empty_body_400(self, api):
        """PUT with empty body should return 400."""
        currency = self._get_test_currency(api)
        resp = api.put(f"/reference.php?resource=currencies&id={currency['id']}", json={})
        assert resp.status_code == 400

    def test_edit_nonexistent_currency_404(self, api):
        """PUT on non-existent currency should return 404."""
        resp = api.put('/reference.php?resource=currencies&id=999999', json={'name': 'Test'})
        assert resp.status_code == 404
