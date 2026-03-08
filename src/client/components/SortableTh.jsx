import { ChevronUp, ChevronDown } from 'lucide-react';

/**
 * SortableTh — Drop-in replacement for <th> that adds click-to-sort.
 *
 * Props:
 *   sortKey  — the key this column sorts by
 *   current  — currently active sort key
 *   dir      — current sort direction ('asc' | 'desc')
 *   onSort   — callback(sortKey)
 *   children — column label
 *   ...rest  — passed through to <th> (style, className, etc.)
 */
export default function SortableTh({ sortKey, current, dir, onSort, children, ...rest }) {
  const active = sortKey === current;

  return (
    <th
      {...rest}
      onClick={() => onSort(sortKey)}
      style={{ cursor: 'pointer', userSelect: 'none', ...rest.style }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {children}
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 0, opacity: active ? 1 : 0.25 }}>
          <ChevronUp size={10} style={{ marginBottom: -2, color: active && dir === 'asc' ? 'var(--primary)' : undefined }} />
          <ChevronDown size={10} style={{ marginTop: -2, color: active && dir === 'desc' ? 'var(--primary)' : undefined }} />
        </span>
      </span>
    </th>
  );
}
