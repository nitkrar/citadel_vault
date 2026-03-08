import { useState, useMemo } from 'react';

/**
 * useSort — Generic hook for sortable tables.
 *
 * Usage:
 *   const { sorted, sortKey, sortDir, onSort } = useSort(items, 'name', 'asc');
 *   <SortableTh sortKey="name" current={sortKey} dir={sortDir} onSort={onSort}>Name</SortableTh>
 *
 * Supports nested access via dot notation: 'user.name'
 * Handles strings, numbers, dates, booleans, nulls.
 */
export default function useSort(items, defaultKey = '', defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const onSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !items?.length) return items || [];

    return [...items].sort((a, b) => {
      let va = resolve(a, sortKey);
      let vb = resolve(b, sortKey);

      // Nulls / undefined always last
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      // Booleans → number
      if (typeof va === 'boolean') va = va ? 1 : 0;
      if (typeof vb === 'boolean') vb = vb ? 1 : 0;

      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, onSort };
}

function resolve(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}
