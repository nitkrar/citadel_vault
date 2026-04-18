/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

let mockHideAmounts = false;

vi.mock('../../src/client/components/Layout', () => ({
  useHideAmounts: () => ({ hideAmounts: mockHideAmounts }),
}));

import AssetsTab from '../../src/client/components/portfolio/AssetsTab.jsx';

afterEach(() => {
  cleanup();
  mockHideAmounts = false;
});

function buildPortfolio() {
  return {
    assets: [],
    by_country: {},
    by_account: {},
    by_type: {},
    by_currency: {},
    by_ticker: {
      AAPL: {
        label: 'AAPL',
        total: 1200,
        count: 2,
        totalShares: 7,
        totalCost: 1260,
        costCount: 7,
        items: [
          {
            id: 1,
            name: 'Apple Growth',
            shares: 5,
            pricePerShare: 200,
            costPrice: 180,
            currency: 'USD',
            displayValue: 900,
            gainLoss: 100,
            gainLossPercent: 11.1,
            change_1d_pct: 1.25,
            change_1w_pct: -2.5,
          },
          {
            id: 2,
            name: 'Apple Income',
            shares: 2,
            pricePerShare: 150,
            costPrice: 170,
            currency: 'USD',
            displayValue: 300,
            gainLoss: -40,
            gainLossPercent: -11.8,
            change_1d_pct: null,
            change_1w_pct: null,
          },
        ],
      },
    },
  };
}

function renderTickerView() {
  return render(
    <AssetsTab
      portfolio={buildPortfolio()}
      fmtD={(value) => `£${Number(value).toFixed(2)}`}
      groupBy="ticker"
      setGroupBy={() => {}}
      expandedGroups={{ AAPL: true }}
      toggleGroup={() => {}}
    />
  );
}

describe('AssetsTab ticker change columns', () => {
  it('renders 1D and 1W columns with colored percentage cells and null fallback', () => {
    renderTickerView();

    expect(screen.getByText('1D %')).toBeInTheDocument();
    expect(screen.getByText('1W %')).toBeInTheDocument();

    const positiveCell = screen.getByText('+1.25%').closest('td');
    const negativeCell = screen.getByText('-2.50%').closest('td');

    expect(positiveCell).toHaveStyle('color: var(--color-success, #16a34a)');
    expect(negativeCell).toHaveStyle('color: var(--color-danger, #dc2626)');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('masks percentage columns when hideAmounts is enabled', () => {
    mockHideAmounts = true;
    renderTickerView();

    expect(screen.getAllByText('***').length).toBeGreaterThanOrEqual(2);
  });
});
