/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import SearchableSelect from '../../src/client/components/SearchableSelect.jsx';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

const options = [
  { value: 'us', label: 'United States' },
  { value: 'uk', label: 'United Kingdom' },
  { value: 'in', label: 'India' },
  { value: 'de', label: 'Germany' },
];

describe('SearchableSelect', () => {
  it('renders placeholder when no value selected', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} placeholder="Choose country" />
    );
    expect(within(container).getByText('Choose country')).toBeInTheDocument();
  });

  it('renders selected option label', () => {
    const { container } = render(
      <SearchableSelect options={options} value="uk" onChange={() => {}} />
    );
    expect(within(container).getByText('United Kingdom')).toBeInTheDocument();
  });

  it('opens dropdown on click and shows all options', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} placeholder="Pick one" />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    // All options should be visible in the dropdown
    expect(within(container).getByText('United States')).toBeInTheDocument();
    expect(within(container).getByText('India')).toBeInTheDocument();
    expect(within(container).getByText('Germany')).toBeInTheDocument();
    expect(within(container).getByText('United Kingdom')).toBeInTheDocument();
  });

  it('filters options when typing', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    fireEvent.change(input, { target: { value: 'united' } });
    // Should show matching options
    expect(within(container).getByText('United States')).toBeInTheDocument();
    expect(within(container).getByText('United Kingdom')).toBeInTheDocument();
    // Non-matching should be gone
    expect(within(container).queryByText('India')).toBeNull();
    expect(within(container).queryByText('Germany')).toBeNull();
  });

  it('shows "No matches" when filter matches nothing', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    fireEvent.change(input, { target: { value: 'zzzzz' } });
    expect(within(container).getByText('No matches')).toBeInTheDocument();
  });

  it('calls onChange when option is selected via mouseDown', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={onChange} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    fireEvent.mouseDown(within(container).getByText('India'));
    expect(onChange).toHaveBeenCalledWith('in');
  });

  it('does not open dropdown when disabled', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} disabled />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    // Dropdown should not render — no list items
    expect(container.querySelector('.searchable-select-dropdown')).toBeNull();
  });

  it('calls onChange with empty string when clear button is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchableSelect options={options} value="uk" onChange={onChange} />
    );
    // Clear button is a button[type="button"] inside the trigger
    const clearBtn = container.querySelector('button[type="button"]');
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('closes dropdown on Escape key', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    expect(within(container).getByText('United States')).toBeInTheDocument();

    const input = container.querySelector('.searchable-select-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Dropdown should be closed
    expect(container.querySelector('.searchable-select-dropdown')).toBeNull();
  });

  it('selects highlighted option on Enter key', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={onChange} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    // First option is highlighted by default (index 0 = United States)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('us');
  });

  it('navigates options with arrow keys', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={onChange} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    // Arrow down to move highlight from index 0 to index 1
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // Enter to select highlighted (index 1 = United Kingdom)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('uk');
  });

  it('does not go below last option with ArrowDown', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={onChange} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    // Press ArrowDown many times (more than options count)
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    // Should select the last option (Germany, index 3)
    expect(onChange).toHaveBeenCalledWith('de');
  });

  it('does not go above first option with ArrowUp', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={onChange} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    // Press ArrowUp from index 0
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Should still be first option
    expect(onChange).toHaveBeenCalledWith('us');
  });

  it('does not select a disabled option via mouseDown', () => {
    const onChange = vi.fn();
    const optionsWithDisabled = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta', disabled: true },
      { value: 'c', label: 'Gamma' },
    ];
    const { container } = render(
      <SearchableSelect options={optionsWithDisabled} value="" onChange={onChange} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    fireEvent.mouseDown(within(container).getByText('Beta'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders option with hint text', () => {
    const optionsWithHint = [
      { value: 'a', label: 'Alpha', hint: 'First letter' },
    ];
    const { container } = render(
      <SearchableSelect options={optionsWithHint} value="" onChange={() => {}} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    expect(within(container).getByText('First letter')).toBeInTheDocument();
  });

  it('renders with default placeholder when none specified', () => {
    const { container } = render(
      <SearchableSelect options={[]} value="" onChange={() => {}} />
    );
    expect(within(container).getByText('Select...')).toBeInTheDocument();
  });

  it('filter is case-insensitive', () => {
    const { container } = render(
      <SearchableSelect options={options} value="" onChange={() => {}} />
    );
    const trigger = container.querySelector('.searchable-select-trigger');
    fireEvent.click(trigger);
    const input = container.querySelector('.searchable-select-input');
    fireEvent.change(input, { target: { value: 'INDIA' } });
    expect(within(container).getByText('India')).toBeInTheDocument();
    expect(within(container).queryByText('Germany')).toBeNull();
  });
});
