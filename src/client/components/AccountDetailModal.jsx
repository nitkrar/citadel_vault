import Modal from './Modal';
import DetailField, { DetailRow } from './DetailField';
import { useHideAmounts } from './Layout';
import { dbBool, pluralize, MASKED } from '../lib/checks';
import { Edit2 } from 'lucide-react';

export function AccountDetailContent({ item }) {
  const { hideAmounts } = useHideAmounts();

  if (!item) return null;

  let details = {};
  if (item.account_details) {
    if (typeof item.account_details === 'string') {
      try { details = JSON.parse(item.account_details); } catch { details = {}; }
    } else if (typeof item.account_details === 'object') {
      details = item.account_details;
    }
  }
  const detailKeys = Object.keys(details);
  const count = item.asset_count ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <DetailField label="Name" value={item.name} large />

      <DetailRow>
        <DetailField label="Institution" value={item.institution} />
        <DetailField label="Account Type">
          {item.account_type_name ? <span className="badge badge-primary">{item.account_type_name}</span> : '--'}
        </DetailField>
      </DetailRow>

      <DetailRow>
        <DetailField label="Subtype" value={item.subtype ? item.subtype.toUpperCase() : '--'} />
        <DetailField label="Country">
          {item.country_name ? <span>{item.flag_emoji} {item.country_name}</span> : '--'}
        </DetailField>
      </DetailRow>

      <DetailRow>
        <DetailField label="Currency" value={item.currency_code} />
        <DetailField label="Customer ID" value={hideAmounts ? MASKED : (item.customer_id || '--')} mono />
      </DetailRow>

      {count > 0 && (
        <DetailField label="Assets">
          <span className="badge badge-muted">{count} {pluralize(count, 'asset')}</span>
        </DetailField>
      )}

      {detailKeys.length > 0 && (
        <DetailField label="Account Details">
          <div className="card" style={{ padding: 'var(--space-sm) var(--space-md)', marginTop: 4 }}>
            {detailKeys.map(key => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="text-muted">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                <span className="font-mono">{hideAmounts ? MASKED : String(details[key] || '--')}</span>
              </div>
            ))}
          </div>
        </DetailField>
      )}

      {item.comments && <DetailField label="Comments" value={item.comments} pre />}
    </div>
  );
}

export default function AccountDetailModal({ isOpen, onClose, item, onEdit }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Account Details"
      size="lg"
      footer={
        onEdit ? (
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(item); }}>
            <Edit2 size={14} /> Edit Account
          </button>
        ) : null
      }
    >
      <AccountDetailContent item={item} />
    </Modal>
  );
}
