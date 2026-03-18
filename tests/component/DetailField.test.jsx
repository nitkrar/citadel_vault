/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import DetailField, { DetailRow } from '../../src/client/components/DetailField.jsx';

afterEach(() => {
  cleanup();
});

/** Helper: returns the inner content <div> (second child of the wrapper). */
function getContentDiv(container) {
  // Structure: container > wrapper div > [span.label, div.content]
  const wrapper = container.firstElementChild;
  return wrapper.querySelector('div');
}

describe('DetailField', () => {
  it('renders label text', () => {
    const { container } = render(<DetailField label="Account Name" value="Test" />);
    const label = container.querySelector('span.text-muted.text-sm');
    expect(label).toBeTruthy();
    expect(label.textContent).toBe('Account Name');
  });

  it('renders value as content', () => {
    const { container } = render(<DetailField label="Name" value="My Value" />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.textContent).toBe('My Value');
  });

  it('shows -- when value is null', () => {
    const { container } = render(<DetailField label="Name" value={null} />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.textContent).toBe('--');
  });

  it('shows -- when value is undefined', () => {
    const { container } = render(<DetailField label="Name" />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.textContent).toBe('--');
  });

  it('children override value', () => {
    const { container } = render(
      <DetailField label="Name" value="ignored">
        <em>Custom child</em>
      </DetailField>
    );
    const contentDiv = getContentDiv(container);
    expect(contentDiv.textContent).toBe('Custom child');
    expect(contentDiv.querySelector('em')).toBeTruthy();
  });

  it('bold prop applies fontWeight 600 and tabular-nums', () => {
    const { container } = render(<DetailField label="Amount" value="100" bold />);
    const contentDiv = getContentDiv(container);
    const style = contentDiv.getAttribute('style');
    expect(style).toContain('font-weight: 600');
    expect(style).toContain('font-variant-numeric: tabular-nums');
  });

  it('large prop applies fontSize 16 and font-medium class', () => {
    const { container } = render(<DetailField label="Title" value="Big" large />);
    const contentDiv = getContentDiv(container);
    const style = contentDiv.getAttribute('style');
    expect(style).toContain('font-size: 16px');
    expect(contentDiv.className).toContain('font-medium');
  });

  it('mono prop applies font-mono class', () => {
    const { container } = render(<DetailField label="Code" value="abc123" mono />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.className).toContain('font-mono');
  });

  it('pre prop applies whiteSpace pre-wrap', () => {
    const { container } = render(<DetailField label="Notes" value="line1\nline2" pre />);
    const contentDiv = getContentDiv(container);
    const style = contentDiv.getAttribute('style');
    expect(style).toContain('white-space: pre-wrap');
  });

  it('custom style prop merges with existing styles', () => {
    const { container } = render(
      <DetailField label="Styled" value="val" bold style={{ color: 'red', marginTop: 8 }} />
    );
    const contentDiv = getContentDiv(container);
    const style = contentDiv.getAttribute('style');
    // bold styles still present
    expect(style).toContain('font-weight: 600');
    expect(style).toContain('font-variant-numeric: tabular-nums');
    // custom styles merged
    expect(style).toContain('color: red');
    expect(style).toContain('margin-top: 8px');
  });

  it('does not set className when no large or mono prop', () => {
    const { container } = render(<DetailField label="Plain" value="text" />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.getAttribute('class')).toBeNull();
  });

  it('combines large and mono classes', () => {
    const { container } = render(<DetailField label="Both" value="x" large mono />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.className).toContain('font-medium');
    expect(contentDiv.className).toContain('font-mono');
  });

  it('renders value 0 without falling back to --', () => {
    const { container } = render(<DetailField label="Count" value={0} />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.textContent).toBe('0');
  });

  it('renders empty string value without falling back to --', () => {
    const { container } = render(<DetailField label="Empty" value="" />);
    const contentDiv = getContentDiv(container);
    expect(contentDiv.textContent).toBe('');
  });
});

describe('DetailRow', () => {
  it('renders children in a form-row div', () => {
    const { container } = render(
      <DetailRow>
        <span>Field A</span>
        <span>Field B</span>
      </DetailRow>
    );
    const row = container.querySelector('div.form-row');
    expect(row).toBeTruthy();
    expect(row.children).toHaveLength(2);
    expect(row.textContent).toContain('Field A');
    expect(row.textContent).toContain('Field B');
  });
});
