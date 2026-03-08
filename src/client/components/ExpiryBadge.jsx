import { daysUntil } from '../lib/checks';

export default function ExpiryBadge({ expiry_date }) {
  const days = daysUntil(expiry_date);
  if (days === null) return <span className="badge badge-muted">Permanent</span>;
  if (days < 0) return <span className="badge badge-danger">Expired</span>;
  if (days <= 30) return <span className="badge badge-danger" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)' }}>Expiring Soon ({days}d)</span>;
  if (days <= 90) return <span className="badge badge-warning">{days}d remaining</span>;
  return <span className="badge badge-success">Active</span>;
}
