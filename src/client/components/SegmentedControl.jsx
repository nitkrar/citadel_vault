/**
 * SegmentedControl — pill-shaped toggle for switching between options.
 *
 * Props:
 *   options — [{ value, label }]
 *   value   — currently active value
 *   onChange — callback(value)
 */
export default function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="segmented-control">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-control__btn${value === opt.value ? ' segmented-control__btn--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
