/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSort from '../../src/client/hooks/useSort.js';

const items = [
  { id: 1, name: 'Charlie', age: 30 },
  { id: 2, name: 'Alpha', age: 25 },
  { id: 3, name: 'Bravo', age: 35 },
];

describe('useSort', () => {
  it('returns items unsorted when no default key', () => {
    const { result } = renderHook(() => useSort(items));
    expect(result.current.sorted).toEqual(items);
    expect(result.current.sortKey).toBe('');
    expect(result.current.sortDir).toBe('asc');
  });

  it('sorts by default key ascending', () => {
    const { result } = renderHook(() => useSort(items, 'name', 'asc'));
    expect(result.current.sorted.map(i => i.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('sorts by default key descending', () => {
    const { result } = renderHook(() => useSort(items, 'name', 'desc'));
    expect(result.current.sorted.map(i => i.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('sorts numbers correctly', () => {
    const { result } = renderHook(() => useSort(items, 'age', 'asc'));
    expect(result.current.sorted.map(i => i.age)).toEqual([25, 30, 35]);
  });

  it('onSort sets a new sort key with asc direction', () => {
    const { result } = renderHook(() => useSort(items, 'name', 'asc'));
    act(() => result.current.onSort('age'));
    expect(result.current.sortKey).toBe('age');
    expect(result.current.sortDir).toBe('asc');
    expect(result.current.sorted.map(i => i.age)).toEqual([25, 30, 35]);
  });

  it('onSort toggles direction when same key clicked', () => {
    const { result } = renderHook(() => useSort(items, 'name', 'asc'));
    expect(result.current.sortDir).toBe('asc');
    act(() => result.current.onSort('name'));
    expect(result.current.sortDir).toBe('desc');
    expect(result.current.sorted.map(i => i.name)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('double toggle returns to asc', () => {
    const { result } = renderHook(() => useSort(items, 'name', 'asc'));
    act(() => result.current.onSort('name')); // asc -> desc
    act(() => result.current.onSort('name')); // desc -> asc
    expect(result.current.sortDir).toBe('asc');
  });

  it('handles dot-notation nested keys', () => {
    const nested = [
      { id: 1, user: { name: 'Charlie' } },
      { id: 2, user: { name: 'Alpha' } },
      { id: 3, user: { name: 'Bravo' } },
    ];
    const { result } = renderHook(() => useSort(nested, 'user.name', 'asc'));
    expect(result.current.sorted.map(i => i.user.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('handles null values — pushes them to the end', () => {
    const withNulls = [
      { id: 1, name: 'Charlie' },
      { id: 2, name: null },
      { id: 3, name: 'Alpha' },
    ];
    const { result } = renderHook(() => useSort(withNulls, 'name', 'asc'));
    const names = result.current.sorted.map(i => i.name);
    // Nulls should be last regardless of direction
    expect(names[0]).toBe('Alpha');
    expect(names[1]).toBe('Charlie');
    expect(names[2]).toBe(null);
  });

  it('handles null values last even in desc', () => {
    const withNulls = [
      { id: 1, name: null },
      { id: 2, name: 'Bravo' },
      { id: 3, name: 'Alpha' },
    ];
    const { result } = renderHook(() => useSort(withNulls, 'name', 'desc'));
    const names = result.current.sorted.map(i => i.name);
    expect(names[0]).toBe('Bravo');
    expect(names[1]).toBe('Alpha');
    expect(names[2]).toBe(null);
  });

  it('handles undefined values — pushes them to end', () => {
    const withUndefined = [
      { id: 1, name: 'Charlie' },
      { id: 2 }, // name is undefined
      { id: 3, name: 'Alpha' },
    ];
    const { result } = renderHook(() => useSort(withUndefined, 'name', 'asc'));
    const sorted = result.current.sorted;
    expect(sorted[0].name).toBe('Alpha');
    expect(sorted[1].name).toBe('Charlie');
    expect(sorted[2].name).toBeUndefined();
  });

  it('handles boolean values', () => {
    const bools = [
      { id: 1, active: false },
      { id: 2, active: true },
      { id: 3, active: false },
    ];
    const { result } = renderHook(() => useSort(bools, 'active', 'asc'));
    // false=0, true=1, so asc: false first
    expect(result.current.sorted.map(i => i.active)).toEqual([false, false, true]);
  });

  it('handles empty array', () => {
    const { result } = renderHook(() => useSort([], 'name', 'asc'));
    expect(result.current.sorted).toEqual([]);
  });

  it('handles null/undefined items gracefully', () => {
    const { result } = renderHook(() => useSort(null, 'name', 'asc'));
    expect(result.current.sorted).toEqual([]);
  });

  it('does not mutate original array', () => {
    const original = [...items];
    const { result } = renderHook(() => useSort(items, 'name', 'asc'));
    // Original array should be unchanged
    expect(items).toEqual(original);
    // Sorted should be a different reference
    expect(result.current.sorted).not.toBe(items);
  });

  it('uses numeric-aware string comparison', () => {
    const numbered = [
      { id: 1, label: 'item10' },
      { id: 2, label: 'item2' },
      { id: 3, label: 'item1' },
    ];
    const { result } = renderHook(() => useSort(numbered, 'label', 'asc'));
    // numeric: true in localeCompare means item1 < item2 < item10
    expect(result.current.sorted.map(i => i.label)).toEqual(['item1', 'item2', 'item10']);
  });

  it('handles deeply nested dot-notation', () => {
    const deep = [
      { id: 1, a: { b: { c: 3 } } },
      { id: 2, a: { b: { c: 1 } } },
      { id: 3, a: { b: { c: 2 } } },
    ];
    const { result } = renderHook(() => useSort(deep, 'a.b.c', 'asc'));
    expect(result.current.sorted.map(i => i.a.b.c)).toEqual([1, 2, 3]);
  });

  it('handles missing nested path gracefully', () => {
    const partial = [
      { id: 1, user: { name: 'Charlie' } },
      { id: 2, user: null },
      { id: 3, user: { name: 'Alpha' } },
    ];
    const { result } = renderHook(() => useSort(partial, 'user.name', 'asc'));
    const sorted = result.current.sorted;
    expect(sorted[0].user.name).toBe('Alpha');
    expect(sorted[1].user.name).toBe('Charlie');
    // null.name resolves to undefined, pushed to end
    expect(sorted[2].user).toBe(null);
  });

  it('both null values are treated equal', () => {
    const bothNull = [
      { id: 1, name: null },
      { id: 2, name: null },
    ];
    const { result } = renderHook(() => useSort(bothNull, 'name', 'asc'));
    // Order preserved for equal (null) values
    expect(result.current.sorted).toHaveLength(2);
  });
});
