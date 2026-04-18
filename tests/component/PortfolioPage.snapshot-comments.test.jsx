/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const {
  mockApi,
  mockEncrypt,
  mockEncryptBatch,
  mockBuildSnapshotBlobs,
} = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  mockEncrypt: vi.fn(),
  mockEncryptBatch: vi.fn(),
  mockBuildSnapshotBlobs: vi.fn(),
}));

let mockEncryptionValue;
let mockPortfolioDataValue;
let mockRefreshPricesValue;
let mockLayoutModeValue;
let mockCountriesValue;
let mockAppConfigValue;
let mockHideAmountsValue;

vi.mock('../../src/client/contexts/EncryptionContext', () => ({
  useEncryption: () => mockEncryptionValue,
}));

vi.mock('../../src/client/components/Layout', () => ({
  useHideAmounts: () => mockHideAmountsValue,
}));

vi.mock('../../src/client/hooks/usePortfolioData', () => ({
  default: () => mockPortfolioDataValue,
}));

vi.mock('../../src/client/hooks/useRefreshPrices', () => ({
  default: () => mockRefreshPricesValue,
}));

vi.mock('../../src/client/hooks/useLayoutMode', () => ({
  default: () => mockLayoutModeValue,
}));

vi.mock('../../src/client/hooks/useCountries', () => ({
  default: () => mockCountriesValue,
}));

vi.mock('../../src/client/hooks/useAppConfig', () => ({
  default: () => mockAppConfigValue,
}));

vi.mock('../../src/client/api/client', () => ({
  default: mockApi,
}));

vi.mock('../../src/client/lib/workerDispatcher', () => ({
  encryptBatch: mockEncryptBatch,
  decryptBatch: vi.fn(),
}));

vi.mock('../../src/client/lib/portfolioAggregator', async () => {
  const actual = await vi.importActual('../../src/client/lib/portfolioAggregator');
  return {
    ...actual,
    buildSnapshotBlobs: mockBuildSnapshotBlobs,
  };
});

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Doughnut: () => <div data-testid="doughnut-chart" />,
  Line: () => <div data-testid="line-chart" />,
}));

vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  CategoryScale: {},
  LinearScale: {},
  PointElement: {},
  LineElement: {},
  BarElement: {},
  ArcElement: {},
  Filler: {},
  Title: {},
  Tooltip: {},
  Legend: {},
  TimeScale: {},
}));

vi.mock('chartjs-adapter-date-fns', () => ({}));

const iconStub = (name) => (props) => <span data-icon={name} {...props} />;
vi.mock('lucide-react', () => ({
  PieChart: iconStub('PieChart'),
  TrendingUp: iconStub('TrendingUp'),
  List: iconStub('List'),
  Plus: iconStub('Plus'),
  Camera: iconStub('Camera'),
  Lock: iconStub('Lock'),
  AlertTriangle: iconStub('AlertTriangle'),
  RefreshCw: iconStub('RefreshCw'),
  MoreVertical: iconStub('MoreVertical'),
  X: iconStub('X'),
}));

const { default: PortfolioPage } = await import('../../src/client/pages/PortfolioPage.jsx');

function makePortfolio() {
  return {
    summary: {
      asset_count: 1,
      total_assets: 1000,
      total_liabilities: 0,
      net_worth: 1000,
      total_gain_loss: 0,
    },
    assets: [
      {
        id: 101,
        name: 'AAPL Shares',
        currency: 'USD',
        current_value: 1000,
      },
    ],
    accounts: [],
    by_country: {},
    by_type: {},
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));

  mockEncryptionValue = {
    isUnlocked: true,
    encrypt: mockEncrypt,
    decryptWithFallback: vi.fn(),
  };
  mockPortfolioDataValue = {
    portfolio: makePortfolio(),
    loading: false,
    error: null,
    refetch: vi.fn(),
    displayCurrency: 'GBP',
    setDisplayCurrency: vi.fn(),
    baseCurrency: 'GBP',
    currencies: [
      { code: 'GBP', symbol: '£', exchange_rate_to_base: 1, is_active: 1 },
      { code: 'USD', symbol: '$', exchange_rate_to_base: 0.8, is_active: 1 },
    ],
    ratesLastUpdated: null,
  };
  mockRefreshPricesValue = {
    handleRefreshAll: vi.fn(),
    refreshing: false,
    refreshToast: null,
    clearRefreshToast: vi.fn(),
  };
  mockLayoutModeValue = { isMobile: false };
  mockCountriesValue = { countries: [] };
  mockAppConfigValue = { config: { plaid_enabled: 'false' } };
  mockHideAmountsValue = { hideAmounts: false };

  mockApi.get.mockResolvedValue({ data: { data: [] } });
  mockApi.post.mockResolvedValue({ data: { data: { message: 'Snapshot saved.' } } });
  mockApi.put.mockResolvedValue({ data: { data: {} } });
  mockEncrypt.mockResolvedValue('encrypted-meta-blob');
  mockEncryptBatch.mockResolvedValue(['encrypted-entry-blob']);
  mockBuildSnapshotBlobs.mockReturnValue([{ name: 'AAPL Shares' }]);

  sessionStorage.clear();
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PortfolioPage snapshot comments', () => {
  it('submits an encrypted snapshot comment and shows same-day replacement helper text', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { data: [{ id: 1, snapshot_date: '2026-04-18' }] } });

    render(<PortfolioPage />);

    fireEvent.click(screen.getByRole('button', { name: /snapshot/i }));

    expect(await screen.findByRole('heading', { name: 'Save Snapshot' })).toBeInTheDocument();
    expect(await screen.findByText("This will replace today's snapshot and any existing comment.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Comment (optional)'), {
      target: { value: 'Before annual rebalance' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Snapshot' }));

    await waitFor(() => {
      expect(mockEncrypt).toHaveBeenCalledWith(expect.objectContaining({
        base_currency: 'GBP',
        comment: 'Before annual rebalance',
      }), 'citadel.snapshot.meta.v1');
    });
    expect(mockEncrypt.mock.calls[0][0].date).toMatch(/^2026-04-18T12:00:00\.\d{3}Z$/);

    expect(mockApi.post).toHaveBeenCalledWith('/snapshots.php', {
      snapshot_date: '2026-04-18',
      encrypted_meta: 'encrypted-meta-blob',
      entries: [
        {
          entry_id: 101,
          encrypted_data: 'encrypted-entry-blob',
        },
      ],
    });
  });

  it('stores null in the encrypted meta blob when no comment is provided', async () => {
    render(<PortfolioPage />);

    fireEvent.click(screen.getByRole('button', { name: /snapshot/i }));
    expect(await screen.findByRole('heading', { name: 'Save Snapshot' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save Snapshot' }));

    await waitFor(() => {
      expect(mockEncrypt).toHaveBeenCalledWith(expect.objectContaining({
        base_currency: 'GBP',
        comment: null,
      }), 'citadel.snapshot.meta.v1');
    });
    expect(mockEncrypt.mock.calls[0][0].date).toMatch(/^2026-04-18T12:00:00\.\d{3}Z$/);
  });

  it('shows a live counter and clamps the comment at 500 characters', async () => {
    render(<PortfolioPage />);

    fireEvent.click(screen.getByRole('button', { name: /snapshot/i }));
    expect(await screen.findByRole('heading', { name: 'Save Snapshot' })).toBeInTheDocument();

    const textarea = screen.getByLabelText('Comment (optional)');
    fireEvent.change(textarea, { target: { value: 'x'.repeat(501) } });

    expect(textarea).toHaveValue('x'.repeat(500));
    expect(screen.getByText('500 / 500')).toBeInTheDocument();
    expect(screen.getByText('This comment will be encrypted alongside the snapshot metadata.')).toBeInTheDocument();
  });
});
