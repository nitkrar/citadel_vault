import { Fragment } from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUT_DEFS } from '../hooks/useKeyboardShortcuts';

export default function ShortcutOverlay({ onClose, settings }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div className="card" style={{ position: 'relative', padding: 24, maxWidth: 380, width: '90%', zIndex: 1 }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2" style={{ margin: 0 }}>
            <Keyboard size={18} /> Keyboard Shortcuts
          </h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '10px 16px', alignItems: 'center', fontSize: 14 }}>
          {SHORTCUT_DEFS.map(s => (
            <Fragment key={s.id}>
              <kbd style={{
                background: 'var(--bg-secondary, #f3f4f6)', border: '1px solid var(--border-color, #e5e7eb)',
                borderRadius: 4, padding: '2px 8px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap',
              }}>
                Ctrl+{s.key === '/' ? '/' : s.key.toUpperCase()}
              </kbd>
              <span>{s.label}</span>
              <span style={{ fontSize: 11, color: settings[s.id] ? 'var(--text-muted)' : '#ef4444' }}>
                {settings[s.id] ? s.when : 'Disabled'}
              </span>
            </Fragment>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
          Toggle shortcuts in Profile &rarr; Keyboard Shortcuts
        </p>
      </div>
    </div>
  );
}
