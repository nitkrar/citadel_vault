import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSync } from '../contexts/SyncContext';

export default function SyncToast() {
  const { hasVaultUpdates, dismissSync, applySync } = useSync();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (hasVaultUpdates) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 5000);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [hasVaultUpdates]);

  if (!visible) return null;

  return (
    <div className="sync-toast" style={{
      position: 'fixed',
      bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
      right: 20,
      zIndex: 9999,
      background: 'var(--color-primary, #0d9488)',
      color: '#fff',
      borderRadius: 8,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      fontSize: 14,
      maxWidth: 360,
      animation: 'fadeIn 0.2s ease-out',
    }}>
      <RefreshCw size={16} style={{ flexShrink: 0 }} />
      <span>Vault data updated on another device.</span>
      <button
        onClick={applySync}
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          color: '#fff',
          padding: '4px 10px',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
          whiteSpace: 'nowrap',
        }}
      >
        Refresh
      </button>
      <button
        onClick={dismissSync}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          padding: '2px 4px',
          fontSize: 16,
          lineHeight: 1,
        }}
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
