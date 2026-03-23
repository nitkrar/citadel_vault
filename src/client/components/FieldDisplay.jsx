import { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

const MASKED = '••••••';

/** Display a single field value with copy support for secrets */
export default function FieldDisplay({ field, value, masked }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const t = document.createElement('textarea'); t.value = value; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isSecret = field.type === 'secret';

  return (
    <div className="form-group">
      <label className="form-label">{field.label}</label>
      <div className="flex items-center gap-2">
        {field.type === 'url' ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="form-control-static" style={{ wordBreak: 'break-all' }}>{value}</a>
        ) : (
          <span className="form-control-static" style={{ flex: 1, fontFamily: isSecret ? 'monospace' : 'inherit' }}>
            {masked ? MASKED : (isSecret && !visible ? '••••••••' : value)}
          </span>
        )}
        {isSecret && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setVisible(!visible)} title={visible ? 'Hide' : 'Show'}>
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" onClick={handleCopy} title="Copy">
          {copied ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
