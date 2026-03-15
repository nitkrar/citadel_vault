"""
Prices API Tests

Tests the Yahoo Finance price proxy with server-side caching.
Endpoints: POST /prices.php, GET/DELETE /prices.php?action=cache
"""
import pytest


# ---------------------------------------------------------------------------
# POST — Fetch prices for tickers
# ---------------------------------------------------------------------------

class TestPricesFetch:
    """Tests for POST /prices.php — batch ticker price fetch."""

    def test_fetch_valid_ticker(self, api):
        """POST with a valid ticker should return price data."""
        resp = api.post('/prices.php', json={'tickers': ['AAPL']})
        assert resp.status_code == 200
        data = api.data(resp)
        assert 'prices' in data
        assert 'AAPL' in data['prices']
        price_data = data['prices']['AAPL']
        assert 'price' in price_data
        assert isinstance(price_data['price'], (int, float))
        assert price_data['price'] > 0
        assert 'currency' in price_data
        assert 'exchange' in price_data
        assert 'name' in price_data

    def test_fetch_multiple_tickers(self, api):
        """POST with multiple tickers should return all."""
        resp = api.post('/prices.php', json={'tickers': ['AAPL', 'MSFT']})
        assert resp.status_code == 200
        data = api.data(resp)
        assert len(data['prices']) == 2
        assert 'AAPL' in data['prices']
        assert 'MSFT' in data['prices']

    def test_fetch_invalid_ticker(self, api):
        """POST with a nonexistent ticker should return it in errors."""
        resp = api.post('/prices.php', json={'tickers': ['ZZZZZZINVALID99']})
        assert resp.status_code == 200
        data = api.data(resp)
        assert 'ZZZZZZINVALID99' in data['errors']

    def test_fetch_mixed_valid_invalid(self, api):
        """POST with mix of valid and invalid tickers should return both."""
        resp = api.post('/prices.php', json={'tickers': ['AAPL', 'ZZZZZZINVALID99']})
        assert resp.status_code == 200
        data = api.data(resp)
        total = len(data['prices']) + len(data['errors'])
        assert total == 2

    def test_fetch_empty_tickers_400(self, api):
        """POST with empty tickers array should return 400."""
        resp = api.post('/prices.php', json={'tickers': []})
        assert resp.status_code == 400

    def test_fetch_missing_tickers_400(self, api):
        """POST without tickers field should return 400."""
        resp = api.post('/prices.php', json={})
        assert resp.status_code == 400

    def test_cache_hit(self, api):
        """Second fetch of same ticker should return cached: true."""
        # First fetch to populate cache
        api.post('/prices.php', json={'tickers': ['AAPL']})
        # Second fetch should hit cache
        resp = api.post('/prices.php', json={'tickers': ['AAPL']})
        assert resp.status_code == 200
        data = api.data(resp)
        assert data['prices']['AAPL']['cached'] is True

    def test_crypto_ticker(self, api):
        """BTC-USD should return currency USD."""
        resp = api.post('/prices.php', json={'tickers': ['BTC-USD']})
        assert resp.status_code == 200
        data = api.data(resp)
        if 'BTC-USD' in data['prices']:
            assert data['prices']['BTC-USD']['currency'] == 'USD'
        else:
            pytest.skip('BTC-USD not available from Yahoo Finance')

    def test_uk_ticker_gbp_normalization(self, api):
        """BARC.L should return currency GBP (not GBp)."""
        resp = api.post('/prices.php', json={'tickers': ['BARC.L']})
        assert resp.status_code == 200
        data = api.data(resp)
        if 'BARC.L' in data['prices']:
            assert data['prices']['BARC.L']['currency'] == 'GBP', \
                'GBp should be normalized to GBP'
        else:
            pytest.skip('BARC.L not available from Yahoo Finance')

    def test_ticker_sanitization(self, api):
        """Tickers with special chars should be filtered out."""
        resp = api.post('/prices.php', json={'tickers': ['AAPL; DROP TABLE', '<script>']})
        assert resp.status_code == 400  # all filtered → no valid tickers

    def test_max_50_tickers(self, api):
        """Submitting >50 tickers should only process 50."""
        tickers = [f'FAKE{i}' for i in range(60)]
        resp = api.post('/prices.php', json={'tickers': tickers})
        assert resp.status_code == 200
        data = api.data(resp)
        # Total processed = prices + errors should be <= 50
        total = len(data['prices']) + len(data['errors'])
        assert total <= 50


# ---------------------------------------------------------------------------
# Admin cache management
# ---------------------------------------------------------------------------

class TestPricesCacheAdmin:
    """Tests for GET/DELETE /prices.php?action=cache — admin only."""

    def test_view_cache(self, api):
        """GET action=cache should return a list of cached prices."""
        # Ensure at least one cached entry
        api.post('/prices.php', json={'tickers': ['AAPL']})

        resp = api.get('/prices.php', params={'action': 'cache'})
        assert resp.status_code == 200
        data = api.data(resp)
        assert isinstance(data, list)
        assert len(data) > 0
        assert 'ticker' in data[0]
        assert 'price' in data[0]

    def test_clear_cache(self, api):
        """DELETE action=cache should clear all cached prices."""
        # Populate cache
        api.post('/prices.php', json={'tickers': ['AAPL']})

        # Clear it
        resp = api.delete('/prices.php?action=cache')
        assert resp.status_code == 200
        data = api.data(resp)
        assert data['cleared'] is True

        # Verify empty
        resp = api.get('/prices.php', params={'action': 'cache'})
        assert resp.status_code == 200
        assert len(api.data(resp)) == 0


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------

class TestPricesAuth:
    """Tests for unauthenticated access to prices endpoints."""

    def test_post_without_auth_401(self, unauthed_client):
        """POST without valid auth should return 401."""
        resp = unauthed_client.post('/prices.php', json={'tickers': ['AAPL']})
        assert resp.status_code == 401

    def test_cache_without_auth_401(self, unauthed_client):
        """GET cache without valid auth should return 401."""
        resp = unauthed_client.get('/prices.php', params={'action': 'cache'})
        assert resp.status_code == 401
