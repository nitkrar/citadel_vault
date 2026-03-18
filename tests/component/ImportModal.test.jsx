/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/client/contexts/EncryptionContext', () => ({
  useEncryption: () => ({
    isUnlocked: true,
    encrypt: vi.fn((data) => Promise.resolve('encrypted_' + JSON.stringify(data))),
  }),
}));

vi.mock('../../src/client/api/client', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { data: { count: 2 } } })),
  },
}));

vi.mock('../../src/client/lib/entryStore', () => ({
  entryStore: {
    getAllTemplates: vi.fn(() => Promise.resolve([
      { id: 1, template_key: 'password', fields: JSON.stringify([
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'url', label: 'URL', type: 'url', required: false },
        { key: 'username', label: 'Username', type: 'text', required: false },
        { key: 'password', label: 'Password', type: 'secret', required: false },
      ]) },
    ])),
  },
}));

vi.mock('../../src/client/lib/checks', () => ({
  apiData: (resp) => resp.data,
}));

vi.mock('../../src/client/lib/defaults', () => ({
  VALID_ENTRY_TYPES: ['password', 'account', 'asset', 'license', 'insurance', 'custom'],
}));

vi.mock('../../src/client/lib/importUtils', () => ({
  parseCsv: vi.fn((text) => ({
    headers: ['title', 'url', 'username'],
    rows: [['My Site', 'https://example.com', 'user1'], ['Other', 'https://other.com', 'user2']],
  })),
  parseXlsx: vi.fn(),
  autoMapColumns: vi.fn((headers, fields) => {
    const map = {};
    headers.forEach((h, i) => {
      const f = fields.find(f => f.key === h.toLowerCase());
      if (f) map[i] = f.key;
    });
    return map;
  }),
  detectEntryType: vi.fn(() => ({ type: 'password', templateId: 1 })),
  matchSheetToType: vi.fn(() => null),
  generateCsvTemplate: vi.fn(() => 'title,url\n'),
  generateXlsxTemplate: vi.fn(),
}));

vi.mock('../../src/client/components/Modal', () => ({
  default: ({ children, title, isOpen, onClose }) =>
    isOpen ? <div data-testid="modal"><h2>{title}</h2><button data-testid="close" onClick={onClose}>X</button>{children}</div> : null,
}));

// Mock lucide-react icons — list every icon imported by ImportModal
const makeIcon = (name) => (props) => <span data-icon={name} {...props} />;
vi.mock('lucide-react', () => ({
  Upload: makeIcon('Upload'),
  AlertTriangle: makeIcon('AlertTriangle'),
  CheckCircle: makeIcon('CheckCircle'),
  XCircle: makeIcon('XCircle'),
  Download: makeIcon('Download'),
  Link2: makeIcon('Link2'),
  FileSpreadsheet: makeIcon('FileSpreadsheet'),
  ArrowRight: makeIcon('ArrowRight'),
  Loader: makeIcon('Loader'),
  X: makeIcon('X'),
}));

const { default: ImportModal } = await import('../../src/client/components/ImportModal.jsx');
const { parseCsv } = await import('../../src/client/lib/importUtils');

// ── Helpers ──────────────────────────────────────────────────────────

/** Simulate uploading a CSV file via the hidden file input. */
async function uploadCsvFile(container, content = 'title,url\nTest,https://test.com', filename = 'test.csv') {
  const file = new File([content], filename, { type: 'text/csv' });
  // File.text() returns a promise in the real API; jsdom supports it
  const input = container.querySelector('#import-file-input');
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => {
    fireEvent.change(input);
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ImportModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    defaultType: 'password',
    onImportComplete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Visibility ───────────────────────────────────────────────────

  describe('visibility', () => {
    it('renders null when isOpen is false', () => {
      const { container } = render(
        <ImportModal {...defaultProps} isOpen={false} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders modal when isOpen is true', () => {
      const { getByTestId } = render(<ImportModal {...defaultProps} />);
      expect(getByTestId('modal')).toBeInTheDocument();
    });

    it('renders "Import Entries" title', () => {
      const { getByText } = render(<ImportModal {...defaultProps} />);
      expect(getByText('Import Entries')).toBeInTheDocument();
    });
  });

  // ── Step 0: Upload ───────────────────────────────────────────────

  describe('step 0 — upload', () => {
    it('shows file upload area', () => {
      const { container } = render(<ImportModal {...defaultProps} />);
      // Upload area has the descriptive text and hidden file input
      expect(container.querySelector('#import-file-input')).toBeInTheDocument();
      expect(container.textContent).toContain('Click to upload or drag and drop');
      expect(container.textContent).toContain('.csv or .xlsx files');
    });

    it('shows Google Sheets URL input', () => {
      const { container } = render(<ImportModal {...defaultProps} />);
      const urlInput = container.querySelector('input[type="url"]');
      expect(urlInput).toBeInTheDocument();
      expect(urlInput.placeholder).toContain('docs.google.com');
      expect(container.textContent).toContain('Google Sheets URL');
    });

    it('shows template download buttons', () => {
      const { container } = render(<ImportModal {...defaultProps} />);
      expect(container.textContent).toContain('Download a template');
      // Should have CSV buttons for each non-custom type
      expect(container.textContent).toContain('Passwords CSV');
      expect(container.textContent).toContain('Accounts CSV');
      expect(container.textContent).toContain('Assets CSV');
      expect(container.textContent).toContain('Licenses CSV');
      expect(container.textContent).toContain('Insurance CSV');
      // Should have an "All Types (Excel)" button
      expect(container.textContent).toContain('All Types (Excel)');
    });

    it('rejects unsupported file extension', async () => {
      const { container } = render(<ImportModal {...defaultProps} />);
      const file = new File(['data'], 'readme.txt', { type: 'text/plain' });
      const input = container.querySelector('#import-file-input');
      Object.defineProperty(input, 'files', { value: [file] });
      await act(async () => {
        fireEvent.change(input);
      });
      expect(container.textContent).toContain('Unsupported format. Use .csv or .xlsx.');
    });
  });

  // ── File upload ──────────────────────────────────────────────────

  describe('file upload', () => {
    it('parses CSV file and advances to step 1', async () => {
      const { container } = render(<ImportModal {...defaultProps} />);
      await uploadCsvFile(container);

      // parseCsv should have been called
      expect(parseCsv).toHaveBeenCalled();

      // Step 1 should now be visible — check for "Entry Type" label
      await waitFor(() => {
        expect(container.textContent).toContain('Entry Type');
      });

      // The review table should show parsed rows
      expect(container.querySelector('table')).toBeInTheDocument();

      // Import button should show entry count
      expect(container.textContent).toContain('Import 2 entries');
    });
  });

  // ── Step 1: Review ───────────────────────────────────────────────

  describe('step 1 — review', () => {
    async function renderAtStep1() {
      const result = render(<ImportModal {...defaultProps} />);
      await uploadCsvFile(result.container);
      await waitFor(() => {
        expect(result.container.textContent).toContain('Entry Type');
      });
      return result;
    }

    it('shows entry type selector', async () => {
      const { container } = await renderAtStep1();
      const select = container.querySelector('select.form-control');
      expect(select).toBeInTheDocument();
      // Should have all valid entry type options
      const options = Array.from(select.querySelectorAll('option'));
      const values = options.map(o => o.value);
      expect(values).toContain('password');
      expect(values).toContain('account');
      expect(values).toContain('asset');
      expect(values).toContain('license');
      expect(values).toContain('insurance');
      expect(values).toContain('custom');
    });

    it('shows mapped data table', async () => {
      const { container } = await renderAtStep1();
      const table = container.querySelector('table');
      expect(table).toBeInTheDocument();

      // Column headers should include the parsed CSV headers
      const thTexts = Array.from(table.querySelectorAll('th')).map(th => th.textContent);
      const headerStr = thTexts.join(' ');
      expect(headerStr).toContain('title');
      expect(headerStr).toContain('url');
      expect(headerStr).toContain('username');

      // Data rows should be present
      const rows = table.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);

      // First row should contain the parsed data
      expect(rows[0].textContent).toContain('My Site');
      expect(rows[0].textContent).toContain('https://example.com');
      expect(rows[0].textContent).toContain('user1');
    });

    it('shows Import button with entry count', async () => {
      const { container } = await renderAtStep1();
      const buttons = Array.from(container.querySelectorAll('button'));
      const importBtn = buttons.find(b => b.textContent.includes('Import'));
      expect(importBtn).toBeTruthy();
      expect(importBtn.textContent).toContain('Import 2 entries');
    });

    it('shows mapping summary with column count', async () => {
      const { container } = await renderAtStep1();
      // "2 rows, N/3 columns mapped" text
      expect(container.textContent).toContain('2 rows');
      expect(container.textContent).toContain('columns mapped');
    });

    it('shows Back button that returns to step 0', async () => {
      const { container } = await renderAtStep1();
      const backBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Back');
      expect(backBtn).toBeTruthy();

      await act(async () => {
        fireEvent.click(backBtn);
      });

      // Should be back at step 0 — upload area visible
      expect(container.textContent).toContain('Click to upload or drag and drop');
      // Table should be gone
      expect(container.querySelector('table')).not.toBeInTheDocument();
    });
  });

  // ── Close / Reset ────────────────────────────────────────────────

  describe('close/reset', () => {
    it('calls onClose and resets state when modal closed', async () => {
      const onClose = vi.fn();
      const { container, getByTestId } = render(
        <ImportModal {...defaultProps} onClose={onClose} />
      );

      // Advance to step 1
      await uploadCsvFile(container);
      await waitFor(() => {
        expect(container.textContent).toContain('Entry Type');
      });

      // Click the close button from the mocked Modal
      await act(async () => {
        fireEvent.click(getByTestId('close'));
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets to step 0 on re-open after close', async () => {
      const onClose = vi.fn();
      const { container, getByTestId, rerender } = render(
        <ImportModal {...defaultProps} onClose={onClose} />
      );

      // Advance to step 1
      await uploadCsvFile(container);
      await waitFor(() => {
        expect(container.textContent).toContain('Entry Type');
      });

      // Close the modal
      await act(async () => {
        fireEvent.click(getByTestId('close'));
      });

      // Re-render with isOpen=true (simulating re-open)
      rerender(<ImportModal {...defaultProps} onClose={onClose} />);

      // Should be back at step 0
      expect(container.textContent).toContain('Click to upload or drag and drop');
    });
  });
});
