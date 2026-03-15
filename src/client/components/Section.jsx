import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Collapsible section card */
export default function Section({ icon: Icon, title, defaultOpen = false, danger = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card mb-4" style={{ padding: 0, ...(danger ? { borderColor: '#fecaca' } : {}) }}>
      <button type="button" onClick={() => setOpen(!open)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 16, fontWeight: 600, color: danger ? '#dc2626' : 'inherit' }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Icon size={18} /> {title}
      </button>
      {open && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  );
}
