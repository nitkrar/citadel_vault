import { useState, useEffect } from 'react';
import Modal from './Modal';
import DetailField, { DetailRow } from './DetailField';
import ExpiryBadge from './ExpiryBadge';
import api from '../api/client';
import { apiData } from '../lib/checks';
import { Eye, EyeOff, Copy, Check, Edit2 } from 'lucide-react';

export function LicenseDetailContent({ item }) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  const copyKey = (key) => {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3">
      <DetailField label="Product Name" value={item.product_name} large />

      <DetailRow>
        <DetailField label="Vendor" value={item.vendor} />
        <DetailField label="Category">
          {item.category ? <span className="badge badge-primary">{item.category}</span> : '--'}
        </DetailField>
      </DetailRow>

      <DetailField label="License Key">
        <div className="flex items-center gap-2">
          {item.license_key ? (
            <>
              <code className="font-mono" style={{ wordBreak: 'break-all' }}>
                {showKey ? item.license_key : '\u2022'.repeat(Math.min(24, item.license_key.length))}
              </code>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setShowKey(p => !p)}
                title={showKey ? 'Hide' : 'Show'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                onClick={() => copyKey(item.license_key)}
                title="Copy"
              >
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
            </>
          ) : (
            <span className="text-muted">--</span>
          )}
        </div>
      </DetailField>

      <DetailRow>
        <DetailField label="Purchase Date" value={item.purchase_date} />
        <DetailField label="Expiry Date">
          <div className="flex items-center gap-2">
            <ExpiryBadge expiry_date={item.expiry_date} />
            {item.expiry_date && <span className="text-muted text-sm">({item.expiry_date})</span>}
          </div>
        </DetailField>
      </DetailRow>

      <DetailField label="Seats" value={item.seats ?? '--'} />

      {item.notes && <DetailField label="Notes" value={item.notes} pre />}
    </div>
  );
}

export default function LicenseDetailModal({ isOpen, onClose, item, onEdit }) {
  const [fullData, setFullData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && item?.id) {
      setFullData(null);
      setLoading(true);
      api.get(`/licenses.php?id=${item.id}`)
        .then(res => setFullData(apiData(res, item)))
        .catch(() => setFullData(item))
        .finally(() => setLoading(false));
    }
  }, [isOpen, item?.id]);

  const lic = fullData || item;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="License Details"
      size="lg"
      footer={
        onEdit && lic ? (
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(lic); }}>
            <Edit2 size={14} /> Edit License
          </button>
        ) : null
      }
    >
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <LicenseDetailContent item={lic} />
      )}
    </Modal>
  );
}
