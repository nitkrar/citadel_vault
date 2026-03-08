import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, Info, X } from 'lucide-react';
import api from '../api/client';

// Module-level cache — fetched once per session
let cachedNotices = null;

export default function PageNotice() {
  const location = useLocation();
  const [notices, setNotices] = useState(cachedNotices);
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    if (cachedNotices) return;
    api.get('/page-notices.php')
      .then((r) => {
        const data = r.data?.data || r.data || {};
        cachedNotices = data;
        setNotices(data);
      })
      .catch(() => {
        cachedNotices = {};
        setNotices({});
      });
  }, []);

  if (!notices) return null;

  const path = location.pathname;
  const notice = notices[path];
  if (!notice || dismissed[path]) return null;

  const isWarning = notice.type === 'warning';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 8,
        fontSize: '0.85rem',
        lineHeight: 1.5,
        background: isWarning ? '#fef3c7' : '#dbeafe',
        border: `1px solid ${isWarning ? '#fcd34d' : '#93c5fd'}`,
        color: isWarning ? '#92400e' : '#1e40af',
      }}
    >
      {isWarning ? <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />}
      <span style={{ flex: 1 }}>{notice.message}</span>
      <button
        onClick={() => setDismissed((d) => ({ ...d, [path]: true }))}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', flexShrink: 0 }}
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
