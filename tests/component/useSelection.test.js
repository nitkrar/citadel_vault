/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSelection from '../../src/client/hooks/useSelection.js';

const items = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
  { id: 3, name: 'Gamma' },
  { id: 4, name: 'Delta' },
];

describe('useSelection', () => {
  it('starts with empty selection', () => {
    const { result } = renderHook(() => useSelection(items));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('toggle adds an item to selection', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggle(1));
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.selectionMode).toBe(true);
  });

  it('toggle removes an already-selected item', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggle(2));
    expect(result.current.isSelected(2)).toBe(true);
    act(() => result.current.toggle(2));
    expect(result.current.isSelected(2)).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('toggleAll selects all items when none selected', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggleAll());
    expect(result.current.selectedCount).toBe(4);
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isSelected(4)).toBe(true);
  });

  it('toggleAll deselects all when all are selected', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggleAll());
    expect(result.current.selectedCount).toBe(4);
    act(() => result.current.toggleAll());
    expect(result.current.selectedCount).toBe(0);
  });

  it('toggleAll with subset selects only that subset', () => {
    const { result } = renderHook(() => useSelection(items));
    const subset = [items[0], items[1]]; // Alpha, Beta
    act(() => result.current.toggleAll(subset));
    expect(result.current.isSelected(1)).toBe(true);
    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.isSelected(3)).toBe(false);
    expect(result.current.isSelected(4)).toBe(false);
  });

  it('toggleAll with subset deselects subset when all in subset are selected', () => {
    const { result } = renderHook(() => useSelection(items));
    const subset = [items[0], items[1]];
    act(() => result.current.toggleAll(subset));
    expect(result.current.selectedCount).toBe(2);
    act(() => result.current.toggleAll(subset));
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.isSelected(2)).toBe(false);
  });

  it('selectAll selects all items', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.selectedCount).toBe(4);
  });

  it('clearSelection clears all selections', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.selectedCount).toBe(4);
    act(() => result.current.clearSelection());
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectionMode).toBe(false);
  });

  it('getSelectedItems returns selected item objects', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => {
      result.current.toggle(1);
      result.current.toggle(3);
    });
    const selected = result.current.getSelectedItems();
    expect(selected).toHaveLength(2);
    expect(selected.map(i => i.id)).toEqual([1, 3]);
  });

  it('isAllSelected returns true when all items selected', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.isAllSelected()).toBe(true);
  });

  it('isAllSelected returns false when only some selected', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggle(1));
    expect(result.current.isAllSelected()).toBe(false);
  });

  it('isAllSelected with subset checks only that subset', () => {
    const { result } = renderHook(() => useSelection(items));
    const subset = [items[0], items[1]];
    act(() => {
      result.current.toggle(1);
      result.current.toggle(2);
    });
    expect(result.current.isAllSelected(subset)).toBe(true);
    expect(result.current.isAllSelected()).toBe(false); // not all items
  });

  it('isAllSelected returns false for empty subset', () => {
    const { result } = renderHook(() => useSelection(items));
    expect(result.current.isAllSelected([])).toBe(false);
  });

  it('isSomeSelected returns true when some but not all selected', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggle(1));
    expect(result.current.isSomeSelected()).toBe(true);
  });

  it('isSomeSelected returns false when none selected', () => {
    const { result } = renderHook(() => useSelection(items));
    expect(result.current.isSomeSelected()).toBe(false);
  });

  it('isSomeSelected returns false when all selected', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.selectAll());
    expect(result.current.isSomeSelected()).toBe(false);
  });

  it('isSomeSelected with subset checks only that subset', () => {
    const { result } = renderHook(() => useSelection(items));
    const subset = [items[0], items[1]];
    act(() => result.current.toggle(1));
    expect(result.current.isSomeSelected(subset)).toBe(true);
  });

  it('multiple toggles work correctly', () => {
    const { result } = renderHook(() => useSelection(items));
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(3));
    expect(result.current.selectedCount).toBe(3);
    act(() => result.current.toggle(2));
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected(2)).toBe(false);
  });
});
