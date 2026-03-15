import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function UpdateToast() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const currentBuild = import.meta.env.VITE_BUILD_ID;

  const checkForUpdate = useCallback(async () => {
    if (!currentBuild) return;
    try {
      const res = await fetch('/version.json?_=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      if (data.build && data.build !== currentBuild) {
        setUpdateAvailable(true);
      }
    } catch {
      // network error — ignore
    }
  }, [currentBuild]);

  useEffect(() => {
    const initial = setTimeout(checkForUpdate, 10_000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [checkForUpdate]);

  const handleUpdate = async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    window.location.reload();
  };

  if (!updateAvailable || dismissed) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
      left: 'calc(20px + env(safe-area-inset-left, 0px))',
      right: 'calc(20px + env(safe-area-inset-right, 0px))',
      zIndex: 9999,
      background: '#2563eb',
      color: '#fff',
      borderRadius: 8,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      fontSize: 14,
      maxWidth: 400,
      animation: 'fadeIn 0.2s ease-out',
    }}>
      <Download size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>New version available</span>
      <button
        onClick={handleUpdate}
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          color: '#fff',
          padding: '6px 14px',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
          whiteSpace: 'nowrap',
          minHeight: 36,
        }}
      >
        Update
      </button>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          padding: '4px 6px',
          fontSize: 18,
          lineHeight: 1,
          minHeight: 36,
          minWidth: 32,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
