import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client/api/client', () => ({
  default: {
    post: vi.fn(),
  },
}));

import api from '../../src/client/api/client';
import { fetchTickerPrice, fetchTickerPrices } from '../../src/client/lib/priceApi';

describe('priceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchTickerPrice returns canonicalTicker and afterHours alongside the trimmed ticker price', async () => {
    api.post.mockResolvedValue({
      data: {
        data: {
          ticker: {
            prices: {
              AAPL: {
                price: 123.45,
                currency: 'USD',
                canonical_ticker: 'AAPL',
                after_hours: true,
              },
            },
            errors: {},
          },
        },
      },
    });

    await expect(fetchTickerPrice('  AAPL  ')).resolves.toEqual({
      price: {
        price: 123.45,
        currency: 'USD',
        canonical_ticker: 'AAPL',
        after_hours: true,
      },
      error: null,
      canonicalTicker: 'AAPL',
      afterHours: true,
    });

    expect(api.post).toHaveBeenCalledWith('/prices.php?action=refresh', {
      type: 'ticker',
      tickers: ['AAPL'],
    });
  });

  it('fetchTickerPrice returns error data when the ticker is missing', async () => {
    api.post.mockResolvedValue({
      data: {
        ticker: {
          prices: {},
          errors: {
            BAD: 'Ticker not found',
          },
        },
      },
    });

    await expect(fetchTickerPrice('BAD')).resolves.toEqual({
      price: null,
      error: 'Ticker not found',
      canonicalTicker: null,
      afterHours: false,
    });
  });

  it('fetchTickerPrices trims, deduplicates, and returns batch results', async () => {
    api.post.mockResolvedValue({
      data: {
        data: {
          ticker: {
            prices: {
              AAPL: {
                price: 123.45,
                currency: 'USD',
                canonical_ticker: 'AAPL',
                after_hours: false,
              },
              MSFT: {
                price: 234.56,
                currency: 'USD',
                canonical_ticker: 'MSFT',
                after_hours: true,
              },
            },
            errors: {
              MISS: 'Ticker not found',
            },
          },
        },
      },
    });

    await expect(fetchTickerPrices(['  AAPL  ', 'MSFT', 'AAPL', 'MISS'])).resolves.toEqual({
      prices: {
        AAPL: {
          price: 123.45,
          currency: 'USD',
          canonical_ticker: 'AAPL',
          after_hours: false,
        },
        MSFT: {
          price: 234.56,
          currency: 'USD',
          canonical_ticker: 'MSFT',
          after_hours: true,
        },
      },
      errors: {
        MISS: 'Ticker not found',
      },
    });

    expect(api.post).toHaveBeenCalledWith('/prices.php?action=refresh', {
      type: 'ticker',
      tickers: ['AAPL', 'MSFT', 'MISS'],
    });
  });

  it('fetchTickerPrices returns empty results for an empty input list', async () => {
    await expect(fetchTickerPrices(['  ', ''])).resolves.toEqual({
      prices: {},
      errors: {},
    });

    expect(api.post).not.toHaveBeenCalled();
  });
});
