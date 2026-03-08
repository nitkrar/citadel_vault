import { useState, useMemo, useCallback } from 'react';
import Modal from './Modal';
import BulkAddModal from './BulkAddModal';
import useReferenceData from '../hooks/useReferenceData';
import { useEncryption } from '../contexts/EncryptionContext';
import { isTruthy } from '../lib/checks';
import { ArrowRight, ArrowLeft, SkipForward, CheckCircle } from 'lucide-react';

const WIZARD_STEPS = [
  { key: 'accounts', label: 'Accounts', desc: 'Create financial accounts' },
  { key: 'assets', label: 'Assets', desc: 'Add assets & liabilities' },
  { key: 'licenses', label: 'Licenses', desc: 'Track software licenses' },
  { key: 'insurance', label: 'Insurance', desc: 'Record insurance policies' },
];

/**
 * BulkWizard — multi-step wizard for sequential bulk creation.
 *
 * Steps: Accounts → Assets → Licenses → Insurance
 * Each step saves immediately. Newly created items from previous steps
 * are available as reference data in subsequent steps.
 *
 * Props:
 *   isOpen, onClose
 */
export default function BulkWizard({ isOpen, onClose }) {
  const { isUnlocked } = useEncryption();
  const vaultLocked = !isUnlocked;

  const [currentStep, setCurrentStep] = useState(0);
  const [stepResults, setStepResults] = useState({});
  const [completed, setCompleted] = useState(false);

  // Reference data
  const { assetTypes, accountTypes, currencies, countries, accounts } = useReferenceData(
    [
      { key: 'assetTypes', url: '/reference.php?resource=asset-types' },
      { key: 'accountTypes', url: '/reference.php?resource=account-types' },
      { key: 'currencies', url: '/reference.php?resource=currencies' },
      { key: 'countries', url: '/reference.php?resource=countries' },
      { key: 'accounts', url: '/accounts.php' },
    ],
    { deps: [vaultLocked] }
  );

  // Merge newly created accounts into reference data for assets step
  const [newlyCreatedAccounts, setNewlyCreatedAccounts] = useState([]);

  const mergedAccounts = useMemo(() => {
    return [...(accounts || []), ...newlyCreatedAccounts];
  }, [accounts, newlyCreatedAccounts]);

  // Build ref data per step
  const getReferenceData = useCallback(
    (stepKey) => {
      switch (stepKey) {
        case 'accounts':
          return { accountTypes: accountTypes || [], currencies: currencies || [], countries: countries || [] };
        case 'assets':
          return { assetTypes: assetTypes || [], accounts: mergedAccounts, currencies: currencies || [], countries: countries || [] };
        case 'licenses':
          return {};
        case 'insurance':
          return {};
        default:
          return {};
      }
    },
    [assetTypes, accountTypes, currencies, countries, mergedAccounts]
  );

  const handleStepComplete = (stepKey, resultData) => {
    setStepResults((prev) => ({ ...prev, [stepKey]: resultData }));

    // If accounts were created, track them for the assets step
    if (stepKey === 'accounts' && resultData?.results) {
      const newAccounts = resultData.results
        .filter((r) => r.success && r.id)
        .map((r) => ({ id: r.id, name: `New Account #${r.id}` }));
      setNewlyCreatedAccounts((prev) => [...prev, ...newAccounts]);
    }
  };

  const goNext = () => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      setCompleted(true);
    }
  };

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const skipStep = () => {
    goNext();
  };

  const handleClose = () => {
    setCurrentStep(0);
    setStepResults({});
    setCompleted(false);
    setNewlyCreatedAccounts([]);
    onClose();
  };

  if (!isOpen) return null;

  const step = WIZARD_STEPS[currentStep];
  const totalCreated = Object.values(stepResults).reduce(
    (sum, r) => sum + (r?.succeeded || 0),
    0
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Setup Wizard"
      size="lg"
      footer={
        completed ? (
          <button className="btn btn-primary" onClick={handleClose}>
            Done
          </button>
        ) : (
          <>
            {currentStep > 0 && (
              <button className="btn btn-secondary" onClick={goBack}>
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <button className="btn btn-secondary" onClick={skipStep}>
              <SkipForward size={14} /> Skip
            </button>
            <button className="btn btn-primary" onClick={goNext}>
              {currentStep < WIZARD_STEPS.length - 1 ? (
                <>Next <ArrowRight size={14} /></>
              ) : (
                'Finish'
              )}
            </button>
          </>
        )
      }
    >
      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-4">
        {WIZARD_STEPS.map((s, i) => {
          const isDone = !!stepResults[s.key];
          const isCurrent = i === currentStep && !completed;
          return (
            <div
              key={s.key}
              className="flex items-center gap-1"
              style={{
                padding: '4px 12px',
                borderRadius: 'var(--radius-full)',
                fontSize: 12,
                fontWeight: isCurrent ? 600 : 400,
                background: isCurrent
                  ? 'var(--color-primary-light)'
                  : isDone
                  ? 'var(--color-success-light)'
                  : 'var(--bg)',
                color: isCurrent
                  ? 'var(--primary)'
                  : isDone
                  ? 'var(--success)'
                  : 'var(--text-muted)',
                border: `1px solid ${isCurrent ? 'var(--primary)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}
              onClick={() => !completed && setCurrentStep(i)}
            >
              {isDone ? <CheckCircle size={12} /> : null}
              {s.label}
              {isDone && stepResults[s.key]?.succeeded > 0 && (
                <span className="badge badge-success" style={{ fontSize: 10, marginLeft: 4 }}>
                  {stepResults[s.key].succeeded}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {completed ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          <CheckCircle size={48} style={{ color: 'var(--success)', marginBottom: 16 }} />
          <h3>Wizard Complete</h3>
          <p className="text-muted">
            {totalCreated > 0
              ? `Successfully created ${totalCreated} item${totalCreated !== 1 ? 's' : ''} across all steps.`
              : 'No items were created. You can always add items from the individual pages.'}
          </p>
          <div style={{ marginTop: 16 }}>
            {Object.entries(stepResults).map(([key, result]) => (
              result?.succeeded > 0 && (
                <div key={key} className="flex items-center justify-center gap-2 text-sm" style={{ marginBottom: 4 }}>
                  <CheckCircle size={14} style={{ color: 'var(--success)' }} />
                  <span>{WIZARD_STEPS.find((s) => s.key === key)?.label}: {result.succeeded} created</span>
                </div>
              )
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3">
            <h3 style={{ fontSize: 16, marginBottom: 4 }}>
              Step {currentStep + 1}: {step.label}
            </h3>
            <p className="text-muted text-sm">{step.desc}</p>
          </div>

          <BulkAddModal
            isOpen={true}
            onClose={() => {}}
            entityType={step.key}
            onSaveComplete={(data) => handleStepComplete(step.key, data)}
            referenceData={getReferenceData(step.key)}
            standalone={false}
          />
        </div>
      )}
    </Modal>
  );
}
