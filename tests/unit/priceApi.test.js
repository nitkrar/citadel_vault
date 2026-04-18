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

  it('fetchTickerPrice returns the trimmed ticker price and error shape', async () => {
    api.post.mockResolvedValue({
      data: {
        data: {
          ticker: {
            prices: {
              AAPL: { price: 123.45, currency: 'USD' },
            },
            errors: {},
          },
        },
      },
    });

    await expect(fetchTickerPrice('  AAPL  ')).resolves.toEqual({
      price: { price: 123.45, currency: 'USD' },
      error: null,
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
    });
  });

  it('fetchTickerPrices trims, deduplicates, and returns batch results', async () => {
    api.post.mockResolvedValue({
      data: {
        data: {
          ticker: {
            prices: {
              AAPL: { price: 123.45, currency: 'USD' },
              MSFT: { price: 234.56, currency: 'USD' },
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
        AAPL: { price: 123.45, currency: 'USD' },
        MSFT: { price: 234.56, currency: 'USD' },
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
