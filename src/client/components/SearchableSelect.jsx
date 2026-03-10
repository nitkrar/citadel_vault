import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, X } from 'lucide-react';

/**
 * Searchable dropdown selector with keyboard navigation.
 *
 * Props:
 *   options  — [{value, label, icon?, disabled?, hint?}]
 *   value    — current selected value (matches option.value)
 *   onChange — (value) => void
 *   placeholder
 *   className
 *   disabled
 */
export default function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find(o => o.value === value);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Click outside closes
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset highlight when filtered list changes
  useEffect(() => { setHighlightIdx(0); }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlightIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  const handleSelect = useCallback((val) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightIdx] && !filtered[highlightIdx].disabled) handleSelect(filtered[highlightIdx].value);
        break;
      case 'Escape':
        setOpen(false);
        setQuery('');
        break;
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
  };

  return (
    <div
      ref={wrapperRef}
      className={`searchable-select ${className}`}
      style={{ position: 'relative' }}
    >
      <div
        className={`form-control searchable-select-trigger ${disabled ? 'disabled' : ''}`}
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
          if (!open) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        style={{
          display: 'flex', alignItems: 'center', cursor: disabled ? 'default' : 'pointer',
          gap: 6, minHeight: 38, padding: '4px 8px',
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            className="searchable-select-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selected ? selected.label : placeholder}
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              flex: 1, fontSize: 'inherit', color: 'inherit', padding: 0,
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selected ? (
              <>{selected.icon ? <span style={{ marginRight: 4 }}>{selected.icon}</span> : null}{selected.label}</>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>
            )}
          </span>
        )}
        {value && !disabled && (
          <button type="button" onClick={handleClear}
            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <X size={14} />
          </button>
        )}
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </div>

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="searchable-select-dropdown"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            maxHeight: 220, overflowY: 'auto', margin: 0, padding: 0,
            listStyle: 'none',
            background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
            borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.15)',
            marginTop: 2,
          }}
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.value}
              onMouseDown={() => { if (!opt.disabled) handleSelect(opt.value); }}
              onMouseEnter={() => setHighlightIdx(idx)}
              style={{
                padding: '7px 10px', fontSize: 14,
                cursor: opt.disabled ? 'default' : 'pointer',
                background: opt.disabled ? 'transparent' : (idx === highlightIdx ? 'var(--hover-bg, #f0f0f0)' : 'transparent'),
                fontWeight: opt.value === value ? 600 : 400,
                opacity: opt.disabled ? 0.45 : 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {opt.icon ? <span style={{ marginRight: 6 }}>{opt.icon}</span> : null}
              {opt.label}
              {opt.hint ? <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>{opt.hint}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          padding: '10px 12px', fontSize: 13, color: 'var(--text-muted)',
          background: 'var(--card-bg, #fff)', border: '1px solid var(--border)',
          borderRadius: 6, marginTop: 2,
        }}>
          No matches
        </div>
      )}
    </div>
  );
}
