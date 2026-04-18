/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const {
  mockApi,
  mockDecryptBatch,
  mockEncrypt,
  mockDecryptWithFallback,
} = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  mockDecryptBatch: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecryptWithFallback: vi.fn(),
}));

vi.mock('../../src/client/api/client', () => ({
  default: mockApi,
}));

vi.mock('../../src/client/lib/workerDispatcher', () => ({
  encryptBatch: vi.fn(),
  decryptBatch: mockDecryptBatch,
}));

vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="line-chart" />,
  Bar: () => <div data-testid="bar-chart" />,
}));

vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
}));

vi.mock('chartjs-plugin-zoom', () => ({ default: {} }));
vi.mock('chartjs-adapter-date-fns', () => ({}));

const iconStub = (name) => (props) => <span data-icon={name} {...props} />;
vi.mock('lucide-react', () => ({
  ChevronDown: iconStub('ChevronDown'),
  ChevronRight: iconStub('ChevronRight'),
  Settings: iconStub('Settings'),
  Clock: iconStub('Clock'),
  MoreVertical: iconStub('MoreVertical'),
  X: iconStub('X'),
}));

const { default: PerformanceTab } = await import('../../src/client/components/portfolio/PerformanceTab.jsx');

function makeSnapshotResponse() {
  const longComment = 'This is a deliberately long snapshot comment for truncation checks in the table.';
  return [
    {
      id: 1,
      snapshot_date: '2026-04-17',
      data: JSON.stringify({
        base_currency: 'GBP',
        date: '2026-04-17T10:00:00.000Z',
      }),
      entries: [
        {
          entry_id: 11,
          encrypted_data: JSON.stringify({
            name: 'Cash ISA',
            template_name: 'Cash',
            subtype: 'cash',
            is_liability: false,
            currency: 'GBP',
            raw_value: 1500,
          }),
        },
      ],
    },
    {
      id: 2,
      snapshot_date: '2026-04-18',
      data: JSON.stringify({
        base_currency: 'GBP',
        date: '2026-04-18T10:00:00.000Z',
        comment: longComment,
      }),
      entries: [
        {
          entry_id: 22,
          encrypted_data: JSON.stringify({
            name: 'AAPL Shares',
            template_name: 'Stocks',
            subtype: 'stocks',
            is_liability: false,
            currency: 'USD',
            raw_value: 2000,
          }),
        },
      ],
    },
  ];
}

function renderPerformanceTab() {
  return render(
    <PerformanceTab
      encrypt={mockEncrypt}
      decryptWithFallback={mockDecryptWithFallback}
      fmtD={(value) => `£${Number(value).toFixed(2)}`}
      hideAmounts={false}
      currencies={[
        { code: 'GBP', symbol: '£', exchange_rate_to_base: 1 },
        { code: 'USD', symbol: '$', exchange_rate_to_base: 0.8 },
      ]}
      countries={[]}
      displayCurrency="GBP"
      isMobile={false}
    />
  );
}

beforeEach(() => {
  mockApi.get.mockImplementation(async (url) => {
    if (String(url).startsWith('/snapshots.php')) {
      return { data: { data: { snapshots: makeSnapshotResponse(), has_more: false, next_cursor: null } } };
    }
    if (String(url).startsWith('/reference.php')) {
      return { data: { data: { rates: { GBP: 1, USD: 0.8 } } } };
    }
    return { data: { data: {} } };
  });
  mockApi.put.mockResolvedValue({ data: { data: { message: 'Updated.' } } });
  mockDecryptBatch.mockImplementation(async (blobs) => blobs.map((blob) => JSON.parse(blob)));
  mockDecryptWithFallback.mockImplementation(async (blob) => JSON.parse(blob));
  mockEncrypt.mockResolvedValue('re-encrypted-meta');

  sessionStorage.clear();
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PerformanceTab snapshot comments', () => {
  it('renders a truncated comment with a tooltip and shows em dash for older snapshots without comments', async () => {
    const longComment = 'This is a deliberately long snapshot comment for truncation checks in the table.';
    const expectedTruncated = `${longComment.slice(0, 39)}…`;

    renderPerformanceTab();

    fireEvent.click(await screen.findByText('Snapshots (2)'));

    expect(screen.getByRole('columnheader', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getByTitle(longComment)).toHaveTextContent(expectedTruncated);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('loads, edits, saves, and rerenders the snapshot comment through the encrypted meta blob', async () => {
    const updatedComment = 'After rebalancing into bonds';

    renderPerformanceTab();

    fireEvent.click(await screen.findByText('Snapshots (2)'));
    fireEvent.click(screen.getByText('2026-04-18'));

    const textarea = await screen.findByLabelText('Comment');
    expect(textarea).toHaveValue('This is a deliberately long snapshot comment for truncation checks in the table.');

    fireEvent.change(textarea, { target: { value: updatedComment } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() => {
      expect(mockEncrypt).toHaveBeenCalledWith({
        base_currency: 'GBP',
        date: '2026-04-18T10:00:00.000Z',
        comment: updatedComment,
      }, 'citadel.snapshot.meta.v1');
    });

    expect(mockApi.put).toHaveBeenCalledWith('/snapshots.php', {
      snapshot_id: 2,
      encrypted_meta: 're-encrypted-meta',
    });

    await waitFor(() => {
      expect(screen.getByTitle(updatedComment)).toHaveTextContent(updatedComment);
    });
  });
});
