import Modal from './Modal';
import DetailField, { DetailRow } from './DetailField';
import InsuranceCategoryBadge from './InsuranceCategoryBadge';
import { useHideAmounts } from './Layout';
import { fmtCurrency, fmtDate } from '../lib/checks';
import { Edit2 } from 'lucide-react';

export function InsuranceDetailContent({ item }) {
  const { hideAmounts } = useHideAmounts();

  if (!item) return null;

  return (
    <div className="flex flex-col gap-3">
      <DetailField label="Policy Name" value={item.policy_name} large />

      <DetailRow>
        <DetailField label="Provider" value={item.provider} />
        <DetailField label="Category">
          <InsuranceCategoryBadge category={item.category} />
        </DetailField>
      </DetailRow>

      <DetailField label="Policy Number" value={item.policy_number} mono />

      <DetailRow>
        <DetailField label="Premium" value={fmtCurrency(item.premium_amount, item.premium_currency_symbol || '', hideAmounts)} bold />
        <DetailField label="Coverage" value={fmtCurrency(item.coverage_amount, item.coverage_currency_symbol || '', hideAmounts)} bold />
      </DetailRow>

      <DetailRow>
        <DetailField label="Payment Frequency">
          <span className="badge badge-muted">{item.payment_frequency || '--'}</span>
        </DetailField>
        <DetailField label="Beneficiary" value={item.beneficiary} />
      </DetailRow>

      <DetailRow>
        <DetailField label="Start Date" value={fmtDate(item.start_date)} />
        <DetailField label="Maturity Date" value={fmtDate(item.maturity_date)} />
      </DetailRow>

      {(item.comments || item.notes) && <DetailField label="Comments" value={item.comments || item.notes} pre />}
    </div>
  );
}

export default function InsuranceDetailModal({ isOpen, onClose, item, onEdit }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Policy Details"
      size="lg"
      footer={
        onEdit ? (
          <button className="btn btn-primary" onClick={() => { onClose(); onEdit(item); }}>
            <Edit2 size={14} /> Edit Policy
          </button>
        ) : null
      }
    >
      <InsuranceDetailContent item={item} />
    </Modal>
  );
}
