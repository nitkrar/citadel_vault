import { useState, useCallback, useMemo } from 'react';

/**
 * useSelection — composable hook for multi-select in tables.
 *
 * Manages a Set<id> of selected item IDs. Works across grouped tables.
 *
 * @param {Array} items  The current filtered/visible items (each must have .id)
 * @returns {object} Selection state and actions
 */
export default function useSelection(items) {
  const [selectedIds, setSelectedIds] = useState(new Set());

  const isSelected = useCallback(
    (id) => selectedIds.has(id),
    [selectedIds]
  );

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (subset) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const ids = (subset || items).map((i) => i.id);
        const allSelected = ids.every((id) => next.has(id));
        if (allSelected) {
          ids.forEach((id) => next.delete(id));
        } else {
          ids.forEach((id) => next.add(id));
        }
        return next;
      });
    },
    [items]
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;

  const selectionMode = selectedCount > 0;

  const getSelectedItems = useCallback(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  );

  // Check if all items in a subset are selected
  const isAllSelected = useCallback(
    (subset) => {
      const ids = (subset || items).map((i) => i.id);
      return ids.length > 0 && ids.every((id) => selectedIds.has(id));
    },
    [items, selectedIds]
  );

  // Check if some (but not all) items in a subset are selected
  const isSomeSelected = useCallback(
    (subset) => {
      const ids = (subset || items).map((i) => i.id);
      const count = ids.filter((id) => selectedIds.has(id)).length;
      return count > 0 && count < ids.length;
    },
    [items, selectedIds]
  );

  return {
    selectedIds,
    isSelected,
    toggle,
    toggleAll,
    selectAll,
    clearSelection,
    selectedCount,
    selectionMode,
    getSelectedItems,
    isAllSelected,
    isSomeSelected,
  };
}
