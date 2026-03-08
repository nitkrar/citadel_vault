/**
 * DetailField — reusable label/value pair for detail modals.
 *
 * Usage:
 *   <DetailField label="Name" value={item.name} />
 *   <DetailField label="Amount" value={fmtCurrency(...)} bold />
 *   <DetailField label="Notes" value={item.notes} pre />  // whitespace preserved
 *   <DetailField label="Name" large>{custom JSX}</DetailField>
 */
export default function DetailField({ label, value, children, bold, large, mono, pre, style }) {
  const content = children ?? (value != null ? value : '--');

  return (
    <div>
      <span className="text-muted text-sm">{label}</span>
      <div
        className={[
          large && 'font-medium',
          mono && 'font-mono',
        ].filter(Boolean).join(' ') || undefined}
        style={{
          ...(large ? { fontSize: 16 } : {}),
          ...(bold ? { fontWeight: 600, fontVariantNumeric: 'tabular-nums' } : {}),
          ...(pre ? { whiteSpace: 'pre-wrap' } : {}),
          ...style,
        }}
      >
        {content}
      </div>
    </div>
  );
}

/**
 * DetailRow — two fields side by side using form-row layout.
 */
export function DetailRow({ children }) {
  return <div className="form-row">{children}</div>;
}
