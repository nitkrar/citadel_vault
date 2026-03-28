import { useState, useRef } from 'react';
import { Copy, Check, Clock } from 'lucide-react';

export default function RecoveryKeyCopyBlock({ recoveryKey }) {
  const [copied, setCopied] = useState(false);
  const clearTimer = useRef(null);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(recoveryKey); } catch {
      const tmp = document.createElement('textarea');
      tmp.value = recoveryKey;
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      document.body.removeChild(tmp);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => { try { navigator.clipboard.writeText(''); } catch {} }, 30000);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--color-input-bg, var(--bg-secondary))', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontFamily: 'monospace', fontSize: 16, wordBreak: 'break-all' }}>
        <span style={{ flex: 1 }}>{recoveryKey}</span>
        <button type="button" onClick={handleCopy} title="Copy recovery key" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: copied ? 'var(--color-success)' : 'var(--color-text-muted)', flexShrink: 0 }}>
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
      {copied && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--color-warning-light)', border: '1px solid var(--color-warning)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, color: 'var(--color-warning)', fontSize: 13 }}>
          <Clock size={14} style={{ flexShrink: 0 }} />
          <span>Clipboard will be automatically cleared in 30 seconds.</span>
        </div>
      )}
    </>
  );
}
