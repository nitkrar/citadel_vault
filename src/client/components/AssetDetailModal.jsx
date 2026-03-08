import Modal from './Modal';
import DetailField, { DetailRow } from './DetailField';
import { useHideAmounts } from './Layout';
import { fmtCurrency, dbBool, MASKED } from '../lib/checks';
import { Edit2 } from 'lucide-react';

export function AssetDetailContent({ item }) {
  const { hideAmounts } = useHideAmounts();

  if (!item) return null;

  let assetData = {};
  if (item.asset_data) {
    if (typeof item.asset_data === 'string') {
      try { assetData = JSON.parse(item.asset_data); } catch { assetData = {}; }
    } else if (typeof item.asset_data === 'object') {
      assetData = item.asset_data;
    }
  }
  const dataKeys = Object.keys(assetData);

  return (
    <div className="flex flex-col gap-3">
      <DetailField label="Name" large>
        {item.name}
        {item.ticker_symbol && <span className="badge badge-muted ml-2" style={{ marginLeft: 8 }}>{item.ticker_symbol}</span>}
      </DetailField>

      <DetailRow>
        <DetailField label="Asset Type">
          {item.asset_type_name ? <span className="badge badge-primary">{item.asset_type_name}</span> : '--'}
        </DetailField>
        <DetailField label="Category" value={item.asset_type_category || item.category} />
      </DetailRow>

      <DetailRow>
        <DetailField label="Account" value={item.account_name} />
        <DetailField label="Currency" value={item.currency_code} />
      </DetailRow>

      <DetailRow>
        <DetailField label="Amount" value={fmtCurrency(item.amount, item.currency_symbol || '', hideAmounts)} bold />
        <DetailField label="Base Amount" value={fmtCurrency(item.base_amount, '', hideAmounts)} bold />
      </DetailRow>

      {(item.shares_quantity != null && item.shares_quantity !== '') && (
        <DetailField label="Shares Quantity" value={hideAmounts ? MASKED : Number(item.shares_quantity).toLocaleString()} />
      )}

      <DetailRow>
        <DetailField label="Liquid">
          {dbBool(item.is_liquid)
            ? <span className="badge badge-success">Yes</span>
            : <span className="badge badge-muted">No</span>}
        </DetailField>
        <DetailField label="Type">
          {dbBool(item.is_liability)
            ? <span className="badge badge-danger">Liability</span>
            : <span className="badge badge-success">Asset</span>}
        </DetailField>
      </DetailRow>

      {item.country_name && (
        <DetailField label="Country" value={`${item.flag_emoji} ${item.country_name}`} />
      )}

      {dataKeys.length > 0 && (
        <DetailField label="Asset Details">
          <div className="card" style={{ padding: 'var(--space-sm) var(--space-md)', marginTop: 4 }}>
            {dataKeys.map(key => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="text-muted">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                <span className="font-mono">{hideAmounts ? MASKED : String(assetData[key] || '--')}</span>
              </div>
            ))}
          </div>
        </DetailField>
      )}

      {item.comments && <DetailField label="Comments" value={item.comments} pre />}
    </div>
  );
}

export default function AssetDetailModal({ isOpen, onClose, item, onEdit }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Asset Details"
      size="lg"
      footer={
        onEdit ? (
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(item); }}>
            <Edit2 size={14} /> Edit Asset
          </button>
        ) : null
      }
    >
      <AssetDetailContent item={item} />
    </Modal>
  );
}
