/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import Modal from '../../src/client/components/Modal.jsx';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('Modal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <Modal isOpen={false} title="Test">Content</Modal>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders children when isOpen is true', () => {
    render(
      <Modal isOpen={true} title="Test Modal">
        <p>Hello world</p>
      </Modal>
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders the title', () => {
    render(
      <Modal isOpen={true} title="My Title">Content</Modal>
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('renders footer when provided', () => {
    render(
      <Modal isOpen={true} title="Test" footer={<button>Save</button>}>
        Content
      </Modal>
    );
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('does not render footer when not provided', () => {
    const { container } = render(
      <Modal isOpen={true} title="Test">Content</Modal>
    );
    expect(container.querySelector('.modal-footer')).toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} title="Test" onClose={onClose}>Content</Modal>
    );
    const closeBtn = within(container).getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop (overlay) is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} title="Test" onClose={onClose}>Content</Modal>
    );
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal dialog body is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal isOpen={true} title="Test" onClose={onClose}>
        <p>Click me</p>
      </Modal>
    );
    fireEvent.click(within(container).getByText('Click me'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} title="Test" onClose={onClose}>Content</Modal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} title="Test" onClose={onClose}>Content</Modal>
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not render close button when onClose is not provided', () => {
    const { container } = render(
      <Modal isOpen={true} title="No Close">Content</Modal>
    );
    expect(within(container).queryByLabelText('Close')).toBeNull();
  });

  it('applies modal-lg class for size="lg"', () => {
    const { container } = render(
      <Modal isOpen={true} title="Test" size="lg">Content</Modal>
    );
    expect(container.querySelector('.modal-lg')).toBeTruthy();
  });

  it('applies modal-xl class for size="xl"', () => {
    const { container } = render(
      <Modal isOpen={true} title="Test" size="xl">Content</Modal>
    );
    expect(container.querySelector('.modal-xl')).toBeTruthy();
  });

  it('does not apply size class when size is not provided', () => {
    const { container } = render(
      <Modal isOpen={true} title="Test">Content</Modal>
    );
    const dialog = container.querySelector('.modal-dialog');
    expect(dialog.classList.contains('modal-lg')).toBe(false);
    expect(dialog.classList.contains('modal-xl')).toBe(false);
  });

  it('locks body scroll when open and restores on close', () => {
    const { rerender } = render(
      <Modal isOpen={true} title="Test">Content</Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} title="Test">Content</Modal>
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('restores body scroll on unmount', () => {
    const { unmount } = render(
      <Modal isOpen={true} title="Test">Content</Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
