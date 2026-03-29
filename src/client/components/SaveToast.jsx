import { useEffect, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';

/**
 * Floating top-right toast for settings save feedback.
 * Mount with a new `key` on each save to re-animate on rapid successive clicks.
 * Auto-dismisses after 2 seconds with a fade-out.
 *
 * Colors are colorblind-safe:
 *   success — teal (#0D9488): high blue content, distinguishable from error even with deuteranopia
 *   error   — rose (#BE123C): warm pink-red, distinguishable from teal across colorblind types
 */
export default function SaveToast({ message, type = 'success', onDismiss }) {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const fadeOut = setTimeout(() => setOpacity(0), 1700);
    const remove  = setTimeout(() => onDismiss?.(), 2000);
    return () => { clearTimeout(fadeOut); clearTimeout(remove); };
  }, []);

  const bg = type === 'error' ? '#BE123C' : '#0D9488';
  const Icon = type === 'error' ? AlertCircle : Check;

  return (
    <div style={{
      position: 'fixed',
      top: 'calc(16px + env(safe-area-inset-top, 0px))',
      right: 'calc(16px + env(safe-area-inset-right, 0px))',
      zIndex: 9999,
      background: bg,
      color: '#fff',
      borderRadius: 8,
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      fontSize: 14,
      fontWeight: 500,
      opacity,
      transition: 'opacity 0.3s ease',
      animation: 'fadeIn 0.2s ease-out',
      pointerEvents: 'none',
    }}>
      <Icon size={15} style={{ flexShrink: 0 }} />
      {message}
    </div>
  );
}
