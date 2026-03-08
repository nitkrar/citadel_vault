import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import { useHideAmounts } from '../components/Layout';
import {
  Plus, Trash2, Share2, Eye, Users, Lock, Clock, Send, Inbox,
  AlertTriangle, RefreshCw, Briefcase, Shield, FileText, PieChart,
  CheckSquare, Square,
} from 'lucide-react';
import { fmtCurrency, MASKED } from '../lib/checks';
import DetailField, { DetailRow } from '../components/DetailField';
import { AccountDetailContent } from '../components/AccountDetailModal';
import { AssetDetailContent } from '../components/AssetDetailModal';
import { LicenseDetailContent } from '../components/LicenseDetailModal';
import { InsuranceDetailContent } from '../components/InsuranceDetailModal';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';

const SYNC_MODES = [
  { value: 'auto', label: 'Auto Sync', desc: 'Changes are shared automatically' },
  { value: 'approval', label: 'Approval Required', desc: 'Recipient must approve changes' },
  { value: 'snapshot', label: 'Snapshot', desc: 'One-time copy, no future updates' },
];

const SOURCE_TYPES = [
  { value: 'account', label: 'Account', icon: Briefcase },
  { value: 'asset', label: 'Asset', icon: PieChart },
  { value: 'license', label: 'License', icon: FileText },
  { value: 'insurance', label: 'Insurance', icon: Shield },
  { value: 'portfolio', label: 'Portfolio', icon: PieChart },
];

const PORTFOLIO_MODES = [
  { value: 'summary', label: 'Summary Only', desc: 'Just totals (net worth, assets, liquid, liabilities)' },
  { value: 'full_snapshot', label: 'Full Snapshot', desc: 'Summary + all assets + breakdowns' },
  { value: 'saved_snapshot', label: 'Saved Snapshot', desc: 'A specific saved portfolio snapshot' },
  { value: 'auto', label: 'Auto Sync', desc: 'Full data, shared continuously in real time' },
  { value: 'selective', label: 'Selective', desc: 'Choose specific assets and accounts to share' },
];

const defaultForm = {
  recipient: '',
  source_type: 'account',
  source_ids: [],
  sync_mode: 'snapshot',
  label: '',
  expires_at: '',
  portfolio_mode: 'summary',
  snapshot_id: '',
  selected_asset_ids: [],
  selected_account_ids: [],
  auto_sync_confirmed: false,
  include_connected_assets: false,
};

// ---------------------------------------------------------------------------
// useSelection hook for multi-select checkbox lists
// ---------------------------------------------------------------------------
function useSelection(items) {
  const [selected, setSelected] = useState([]);

  const toggle = useCallback((id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.length === items.length ? [] : items.map((i) => i.id)
    );
  }, [items]);

  const clear = useCallback(() => setSelected([]), []);

  const allSelected = items.length > 0 && selected.length === items.length;

  return { selected, setSelected, toggle, toggleAll, clear, allSelected };
}

export default function SharingPage() {
  const { hideAmounts } = useHideAmounts();

  const [sentShares, setSentShares] = useState([]);
  const [receivedShares, setReceivedShares] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [assets, setAssets] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [insurance, setInsurance] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [portfolioData, setPortfolioData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...defaultForm });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [viewShare, setViewShare] = useState(null);
  const handleViewShare = (share) => setViewShare(share);
  const closeViewModal = () => setViewShare(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.get('/sharing.php?action=sent'),
      api.get('/sharing.php?action=received'),
      api.get('/accounts.php'),
      api.get('/assets.php'),
      api.get('/licenses.php'),
      api.get('/insurance.php'),
      api.get('/portfolio.php?action=snapshots'),
      api.get('/portfolio.php'),
    ]);

    if (results[0].status === 'fulfilled') {
      setSentShares(results[0].value.data?.data || results[0].value.data?.shares || []);
    }
    if (results[1].status === 'fulfilled') {
      setReceivedShares(results[1].value.data?.data || results[1].value.data?.shares || []);
    }
    if (results[2].status === 'fulfilled') {
      setAccounts(results[2].value.data?.data || []);
    }
    if (results[3].status === 'fulfilled') {
      setAssets(results[3].value.data?.data || []);
    }
    if (results[4].status === 'fulfilled') {
      setLicenses(results[4].value.data?.data || []);
    }
    if (results[5].status === 'fulfilled') {
      setInsurance(results[5].value.data?.data || []);
    }
    if (results[6].status === 'fulfilled') {
      setSnapshots(results[6].value.data?.data || []);
    }
    if (results[7].status === 'fulfilled') {
      setPortfolioData(results[7].value.data?.data || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Source-type specific item list
  const sourceItems = useMemo(() => {
    switch (form.source_type) {
      case 'account': return accounts;
      case 'asset': return assets;
      case 'license': return licenses.map((l) => ({ ...l, name: l.product_name || `License #${l.id}` }));
      case 'insurance': return insurance.map((p) => ({ ...p, name: p.policy_name || `Policy #${p.id}` }));
      default: return [];
    }
  }, [form.source_type, accounts, assets, licenses, insurance]);

  // Multi-select hook for items
  const itemSelection = useSelection(sourceItems);

  // Multi-select for selective portfolio assets
  const portfolioAssets = useMemo(() => portfolioData?.assets || [], [portfolioData]);
  const portfolioAccounts = useMemo(() => {
    const seen = new Map();
    (portfolioData?.assets || []).forEach((a) => {
      if (a.account_id && !seen.has(a.account_id)) {
        seen.set(a.account_id, { id: a.account_id, name: a.account_name || `Account #${a.account_id}` });
      }
    });
    return Array.from(seen.values());
  }, [portfolioData]);

  const selectiveAssetSel = useSelection(portfolioAssets);
  const selectiveAcctSel = useSelection(portfolioAccounts);

  const openModal = () => {
    setForm({ ...defaultForm });
    setFormError('');
    itemSelection.clear();
    selectiveAssetSel.clear();
    selectiveAcctSel.clear();
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setFormError('');
  };

  const setField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'source_type') {
        next.source_ids = [];
        next.portfolio_mode = 'summary';
        next.snapshot_id = '';
        next.selected_asset_ids = [];
        next.selected_account_ids = [];
        next.auto_sync_confirmed = false;
        next.include_connected_assets = false;
        itemSelection.clear();
      }
      if (key === 'portfolio_mode') {
        next.auto_sync_confirmed = false;
        next.snapshot_id = '';
        next.selected_asset_ids = [];
        next.selected_account_ids = [];
        selectiveAssetSel.clear();
        selectiveAcctSel.clear();
      }
      if (key === 'sync_mode') {
        next.auto_sync_confirmed = false;
      }
      return next;
    });
  };

  // Whether auto-sync warning should be shown
  const showAutoWarning =
    form.sync_mode === 'auto' ||
    (form.source_type === 'portfolio' && form.portfolio_mode === 'auto');

  // Whether save is allowed
  const canSave = (() => {
    if (!form.recipient.trim()) return false;
    if (form.source_type === 'portfolio') {
      if (form.portfolio_mode === 'saved_snapshot' && !form.snapshot_id) return false;
      if (form.portfolio_mode === 'selective') {
        if (selectiveAssetSel.selected.length === 0 && selectiveAcctSel.selected.length === 0) return false;
      }
    } else {
      if (itemSelection.selected.length === 0) return false;
    }
    if (showAutoWarning && !form.auto_sync_confirmed) return false;
    return true;
  })();

  const handleSave = async () => {
    setFormError('');

    const basePayload = {
      recipient: form.recipient.trim(),
      sync_mode: form.sync_mode,
      label: form.label.trim() || null,
      expires_at: form.expires_at || null,
    };

    setSaving(true);
    try {
      if (form.source_type === 'portfolio') {
        // Single POST for portfolio
        const payload = {
          ...basePayload,
          source_type: 'portfolio',
          source_id: null,
          portfolio_mode: form.portfolio_mode,
        };

        // Override sync_mode for auto portfolio
        if (form.portfolio_mode === 'auto') {
          payload.sync_mode = 'auto';
        }

        if (form.portfolio_mode === 'saved_snapshot') {
          payload.snapshot_id = parseInt(form.snapshot_id, 10);
        }
        if (form.portfolio_mode === 'selective') {
          payload.selected_asset_ids = selectiveAssetSel.selected;
          payload.selected_account_ids = selectiveAcctSel.selected;
        }

        await api.post('/sharing.php', payload);
      } else {
        // Batch POST for multi-select
        const batchItems = itemSelection.selected.map((id) => ({
          source_type: form.source_type,
          source_id: id,
        }));

        // Append connected assets when sharing accounts with the toggle on
        if (form.source_type === 'account' && form.include_connected_assets) {
          const connectedAssets = assets.filter(a => itemSelection.selected.includes(a.account_id));
          connectedAssets.forEach(a => {
            batchItems.push({ source_type: 'asset', source_id: a.id });
          });
        }

        await api.post('/sharing.php?action=batch', {
          ...basePayload,
          items: batchItems,
        });
      }

      closeModal();
      await loadData();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create share.');
    } finally {
      setSaving(false);
    }
  };

  const revokeShare = async (id) => {
    if (!window.confirm('Revoke this share? The recipient will lose access immediately.')) return;
    try {
      await api.delete(`/sharing.php?id=${id}`);
      setSentShares((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to revoke share.');
    }
  };

  const renderSyncBadge = (mode) => {
    switch (mode) {
      case 'auto':
        return <span className="badge badge-success">Auto</span>;
      case 'approval':
        return <span className="badge badge-warning">Approval</span>;
      case 'snapshot':
        return <span className="badge badge-muted">Snapshot</span>;
      default:
        return <span className="badge badge-muted">{mode}</span>;
    }
  };

  const renderExpiryBadge = (expires) => {
    if (!expires) return <span className="badge badge-muted">Permanent</span>;
    const d = new Date(expires);
    const now = new Date();
    if (d < now) return <span className="badge badge-danger">Expired</span>;
    return <span className="badge badge-warning">{d.toLocaleDateString()}</span>;
  };

  const renderSourceType = (type) => {
    const label = (type || '').replace('_', ' ');
    return (
      <span className="badge badge-primary">
        {label.charAt(0).toUpperCase() + label.slice(1)}
      </span>
    );
  };

  const hasSent = sentShares.length > 0;
  const hasReceived = receivedShares.length > 0;

  const { sorted: sortedSent, sortKey: sentSortKey, sortDir: sentSortDir, onSort: onSentSort } = useSort(sentShares, 'shared_at', 'desc');
  const { sorted: sortedReceived, sortKey: recvSortKey, sortDir: recvSortDir, onSort: onRecvSort } = useSort(receivedShares, 'shared_at', 'desc');

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Sharing</h1>
          <p className="page-subtitle">Share accounts, assets, licenses, insurance, and portfolios securely</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={loadData} title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-primary" onClick={openModal}>
            <Plus size={16} /> Share Item
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="alert alert-info mb-4">
        <Lock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>All shared data is encrypted end-to-end using RSA keys. Only the intended recipient can decrypt shared items.</span>
      </div>

      {/* Empty state */}
      {!hasSent && !hasReceived && (
        <div className="empty-state">
          <div className="empty-icon"><Share2 size={40} /></div>
          <h3>No shares yet</h3>
          <p>You have not shared anything or received any shared items. Click "Share Item" to get started.</p>
        </div>
      )}

      {/* Shared by Me */}
      {hasSent && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title inline-flex items-center gap-2">
              <Send size={16} /> Shared by Me
            </span>
            <span className="badge badge-muted">{sentShares.length}</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="recipient_identifier" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Shared With</SortableTh>
                  <SortableTh sortKey="source_name" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Item</SortableTh>
                  <SortableTh sortKey="source_type" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Type</SortableTh>
                  <SortableTh sortKey="sync_mode" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Sync Mode</SortableTh>
                  <SortableTh sortKey="label" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Label</SortableTh>
                  <SortableTh sortKey="expires_at" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Expiry</SortableTh>
                  <SortableTh sortKey="shared_at" current={sentSortKey} dir={sentSortDir} onSort={onSentSort}>Shared On</SortableTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedSent.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">
                      {s.recipient_identifier || s.recipient_username || '--'}
                    </td>
                    <td>{s.source_name || (s.source_id ? `#${s.source_id}` : '--')}</td>
                    <td>{renderSourceType(s.source_type)}</td>
                    <td>{renderSyncBadge(s.sync_mode)}</td>
                    <td className="td-muted">{s.label || '--'}</td>
                    <td>{renderExpiryBadge(s.expires_at)}</td>
                    <td className="td-muted">
                      {(s.shared_at || s.created_at) ? new Date(s.shared_at || s.created_at).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      <div className="td-actions">
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => revokeShare(s.id)}
                          title="Revoke"
                        >
                          <Trash2 size={14} /> Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Shared with Me */}
      {hasReceived && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title inline-flex items-center gap-2">
              <Inbox size={16} /> Shared with Me
            </span>
            <span className="badge badge-muted">{receivedShares.length}</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="owner_username" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>From</SortableTh>
                  <SortableTh sortKey="source_name" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>Item</SortableTh>
                  <SortableTh sortKey="source_type" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>Type</SortableTh>
                  <SortableTh sortKey="sync_mode" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>Sync Mode</SortableTh>
                  <SortableTh sortKey="label" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>Label</SortableTh>
                  <SortableTh sortKey="expires_at" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>Expiry</SortableTh>
                  <SortableTh sortKey="shared_at" current={recvSortKey} dir={recvSortDir} onSort={onRecvSort}>Shared On</SortableTh>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {sortedReceived.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">
                      {s.owner_username || s.owner_user_id}
                    </td>
                    <td>{s.source_name || (s.source_id ? `#${s.source_id}` : '--')}</td>
                    <td>{renderSourceType(s.source_type)}</td>
                    <td>{renderSyncBadge(s.sync_mode)}</td>
                    <td className="td-muted">{s.label || '--'}</td>
                    <td>{renderExpiryBadge(s.expires_at)}</td>
                    <td className="td-muted">
                      {(s.shared_at || s.created_at) ? new Date(s.shared_at || s.created_at).toLocaleDateString() : '--'}
                    </td>
                    <td>
                      {s.decrypted_data ? (
                        <button className="btn btn-sm btn-outline" onClick={() => handleViewShare(s)}>
                          <Eye size={12} /> View
                        </button>
                      ) : (
                        <span className="badge badge-muted inline-flex items-center gap-1" title="Decryption failed or data unavailable">
                          <Eye size={12} /> No Data
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Share Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="Share Item"
        size="xl"
        footer={
          <>
            <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !canSave}
            >
              {saving ? 'Sharing...' : 'Share'}
            </button>
          </>
        }
      >
        {formError && (
          <div className="alert alert-danger mb-3">
            <AlertTriangle size={16} />
            <span>{formError}</span>
          </div>
        )}

        {/* Recipient */}
        <div className="form-group">
          <label className="form-label">
            Recipient <span className="required">*</span>
          </label>
          <input
            className="form-control"
            type="text"
            value={form.recipient}
            onChange={(e) => setField('recipient', e.target.value)}
            placeholder="Username or email"
          />
        </div>

        {/* Source Type Buttons */}
        <div className="form-group">
          <label className="form-label">Item Type</label>
          <div className="flex gap-2 flex-wrap">
            {SOURCE_TYPES.map((st) => {
              const Icon = st.icon;
              return (
                <button
                  key={st.value}
                  type="button"
                  className={`btn btn-sm ${form.source_type === st.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setField('source_type', st.value)}
                >
                  <Icon size={14} /> {st.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Item Selection — multi-select checkbox list (not for portfolio) */}
        {form.source_type !== 'portfolio' && (
          <div className="form-group">
            <label className="form-label">
              Select {form.source_type === 'license' ? 'Licenses' : form.source_type === 'insurance' ? 'Policies' : `${form.source_type.charAt(0).toUpperCase() + form.source_type.slice(1)}s`}{' '}
              <span className="required">*</span>
              {itemSelection.selected.length > 0 && (
                <span className="badge badge-primary ml-auto" style={{ marginLeft: 8 }}>
                  {itemSelection.selected.length} selected
                </span>
              )}
            </label>
            <div className="share-item-picker">
              {sourceItems.length === 0 ? (
                <p className="form-hint p-3">No {form.source_type}s found. The vault may be locked.</p>
              ) : (
                <>
                  <div className="share-item-picker-header" onClick={itemSelection.toggleAll}>
                    {itemSelection.allSelected
                      ? <CheckSquare size={16} className="text-primary" />
                      : <Square size={16} />}
                    <span className="font-medium">Select All ({sourceItems.length})</span>
                  </div>
                  <div className="share-item-picker-list">
                    {sourceItems.map((item) => {
                      const checked = itemSelection.selected.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`share-item-picker-row${checked ? ' selected' : ''}`}
                          onClick={() => itemSelection.toggle(item.id)}
                        >
                          {checked
                            ? <CheckSquare size={16} className="text-primary" />
                            : <Square size={16} />}
                          <span className="share-item-name">{item.name || `#${item.id}`}</span>
                          {form.source_type === 'license' && item.vendor && (
                            <span className="text-muted text-sm">{item.vendor}</span>
                          )}
                          {form.source_type === 'insurance' && item.provider && (
                            <span className="text-muted text-sm">{item.provider}</span>
                          )}
                          {form.source_type === 'account' && item.institution && (
                            <span className="text-muted text-sm">{item.institution}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Include Connected Assets toggle (accounts only) */}
        {form.source_type === 'account' && itemSelection.selected.length > 0 && (() => {
          const connectedAssets = assets.filter(a => itemSelection.selected.includes(a.account_id));
          return (
            <div className="form-group">
              <label className="form-check" style={{ cursor: 'pointer', padding: '6px 0' }}>
                <input
                  type="checkbox"
                  checked={form.include_connected_assets}
                  onChange={(e) => setField('include_connected_assets', e.target.checked)}
                />
                <span className="font-medium">Include connected assets</span>
              </label>
              {connectedAssets.length > 0 && (
                <p className="form-hint" style={{ marginTop: 4 }}>
                  {connectedAssets.length} asset{connectedAssets.length !== 1 ? 's' : ''} across selected accounts will also be shared
                </p>
              )}
              {connectedAssets.length === 0 && (
                <p className="form-hint" style={{ marginTop: 4 }}>
                  No assets found linked to the selected accounts
                </p>
              )}
            </div>
          );
        })()}

        {/* Portfolio Mode Section */}
        {form.source_type === 'portfolio' && (
          <div className="form-group">
            <label className="form-label">Portfolio Share Mode</label>
            <div className="flex flex-col gap-2">
              {PORTFOLIO_MODES.map((pm) => (
                <label key={pm.value} className="form-check" style={{ padding: '6px 0' }}>
                  <input
                    type="radio"
                    name="portfolio_mode"
                    value={pm.value}
                    checked={form.portfolio_mode === pm.value}
                    onChange={() => setField('portfolio_mode', pm.value)}
                  />
                  <div>
                    <span className="font-medium">{pm.label}</span>
                    <span className="text-muted text-sm" style={{ display: 'block' }}>{pm.desc}</span>
                  </div>
                </label>
              ))}
            </div>

            {/* Saved Snapshot picker */}
            {form.portfolio_mode === 'saved_snapshot' && (
              <div className="mt-3">
                <label className="form-label">Select Snapshot <span className="required">*</span></label>
                <select
                  className="form-control"
                  value={form.snapshot_id}
                  onChange={(e) => setField('snapshot_id', e.target.value)}
                >
                  <option value="">Choose a snapshot...</option>
                  {snapshots.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.snapshot_date} — Net Worth: {hideAmounts ? MASKED : fmtCurrency(s.net_worth)}
                    </option>
                  ))}
                </select>
                {snapshots.length === 0 && (
                  <p className="form-hint">No saved snapshots. Save one from the Portfolio page first.</p>
                )}
              </div>
            )}

            {/* Selective asset/account picker */}
            {form.portfolio_mode === 'selective' && (
              <div className="mt-3">
                {/* Asset picker */}
                <label className="form-label">
                  Select Assets
                  {selectiveAssetSel.selected.length > 0 && (
                    <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                      {selectiveAssetSel.selected.length} selected
                    </span>
                  )}
                </label>
                <div className="share-item-picker" style={{ maxHeight: 180 }}>
                  {portfolioAssets.length === 0 ? (
                    <p className="form-hint p-3">No assets available.</p>
                  ) : (
                    <>
                      <div className="share-item-picker-header" onClick={selectiveAssetSel.toggleAll}>
                        {selectiveAssetSel.allSelected
                          ? <CheckSquare size={16} className="text-primary" />
                          : <Square size={16} />}
                        <span className="font-medium">Select All Assets ({portfolioAssets.length})</span>
                      </div>
                      <div className="share-item-picker-list" style={{ maxHeight: 140 }}>
                        {portfolioAssets.map((a) => {
                          const checked = selectiveAssetSel.selected.includes(a.id);
                          return (
                            <div
                              key={a.id}
                              className={`share-item-picker-row${checked ? ' selected' : ''}`}
                              onClick={() => selectiveAssetSel.toggle(a.id)}
                            >
                              {checked
                                ? <CheckSquare size={16} className="text-primary" />
                                : <Square size={16} />}
                              <span className="share-item-name">{a.name}</span>
                              <span className="text-muted text-sm">
                                {hideAmounts ? MASKED : fmtCurrency(a.base_amount)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Account picker */}
                {portfolioAccounts.length > 0 && (
                  <div className="mt-2">
                    <label className="form-label">
                      Or Select by Account
                      {selectiveAcctSel.selected.length > 0 && (
                        <span className="badge badge-primary" style={{ marginLeft: 8 }}>
                          {selectiveAcctSel.selected.length} selected
                        </span>
                      )}
                    </label>
                    <div className="share-item-picker" style={{ maxHeight: 140 }}>
                      <div className="share-item-picker-header" onClick={selectiveAcctSel.toggleAll}>
                        {selectiveAcctSel.allSelected
                          ? <CheckSquare size={16} className="text-primary" />
                          : <Square size={16} />}
                        <span className="font-medium">Select All Accounts ({portfolioAccounts.length})</span>
                      </div>
                      <div className="share-item-picker-list" style={{ maxHeight: 100 }}>
                        {portfolioAccounts.map((acc) => {
                          const checked = selectiveAcctSel.selected.includes(acc.id);
                          return (
                            <div
                              key={acc.id}
                              className={`share-item-picker-row${checked ? ' selected' : ''}`}
                              onClick={() => selectiveAcctSel.toggle(acc.id)}
                            >
                              {checked
                                ? <CheckSquare size={16} className="text-primary" />
                                : <Square size={16} />}
                              <span className="share-item-name">{acc.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Auto Sync Warning */}
        {showAutoWarning && (
          <div className="alert alert-danger mb-3" style={{ flexDirection: 'column', gap: 8 }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} />
              <strong>Auto Sync Warning</strong>
            </div>
            <p style={{ margin: 0, fontSize: 13 }}>
              Auto Sync shares ALL selected data continuously. Changes you make will be visible to the
              recipient in real time. This cannot be undone without revoking the share.
            </p>
            <label className="form-check mt-2" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.auto_sync_confirmed}
                onChange={(e) => setField('auto_sync_confirmed', e.target.checked)}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                I understand that all data will be shared continuously
              </span>
            </label>
          </div>
        )}

        {/* Sync Mode (hidden for portfolio — derived from portfolio_mode) */}
        {form.source_type !== 'portfolio' && (
          <div className="form-group">
            <label className="form-label">Sync Mode</label>
            <select
              className="form-control"
              value={form.sync_mode}
              onChange={(e) => setField('sync_mode', e.target.value)}
            >
              {SYNC_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} -- {m.desc}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Label */}
        <div className="form-group">
          <label className="form-label">Label</label>
          <input
            className="form-control"
            type="text"
            value={form.label}
            onChange={(e) => setField('label', e.target.value)}
            placeholder="Optional label for this share"
          />
        </div>

        {/* Expiry */}
        <div className="form-group">
          <label className="form-label flex items-center gap-1">
            <Clock size={14} /> Expires On
          </label>
          <input
            type="datetime-local"
            className="form-control"
            value={form.expires_at}
            onChange={(e) => setField('expires_at', e.target.value)}
          />
          <p className="form-hint">Leave blank for permanent access.</p>
        </div>
      </Modal>

      {/* View Shared Item Detail Modal */}
      <Modal
        isOpen={!!viewShare}
        onClose={closeViewModal}
        title="Shared Item Details"
        size="xl"
        footer={
          <button className="btn btn-secondary" onClick={closeViewModal}>Close</button>
        }
      >
        {viewShare && <SharedItemDetail share={viewShare} hideAmounts={hideAmounts} renderSourceType={renderSourceType} renderSyncBadge={renderSyncBadge} />}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SharedItemDetail — renders decrypted content based on source_type
// ---------------------------------------------------------------------------
function SharedItemDetail({ share, hideAmounts, renderSourceType, renderSyncBadge }) {
  const d = share.decrypted_data;

  const fmtDate = (v) => {
    if (!v) return '--';
    const dt = new Date(v);
    return isNaN(dt.getTime()) ? v : dt.toLocaleDateString();
  };

  const cur = (v) => fmtCurrency(v, '', hideAmounts);

  // Render snapshot details_json properly (has by_country, by_type arrays + simple fields)
  const renderSnapshotDetails = (details) => {
    if (!details || typeof details !== 'object') return null;
    const byCountry = details.by_country;
    const byType = details.by_type;
    // Simple scalar fields (exclude arrays)
    const simpleEntries = Object.entries(details).filter(([k, v]) => !Array.isArray(v) && typeof v !== 'object');

    return (
      <>
        {simpleEntries.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6, padding: '8px 12px' }}>
              {simpleEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between" style={{ padding: '2px 0', fontSize: 13 }}>
                  <span className="text-muted">{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                  <span className="font-medium">{String(v ?? '--')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {Array.isArray(byCountry) && byCountry.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <span className="text-muted text-sm">By Country</span>
            <div className="table-wrapper" style={{ maxHeight: 250, overflowY: 'auto', marginTop: 4 }}>
              <table>
                <thead>
                  <tr><th>Country</th><th>Assets</th><th>Liabilities</th><th>Net</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {byCountry.map((c) => (
                    <tr key={c.country_code}>
                      <td>{c.flag_emoji ? `${c.flag_emoji} ` : ''}{c.country_name}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{cur(c.assets)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{cur(c.liabilities)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{cur(c.total)}</td>
                      <td>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {Array.isArray(byType) && byType.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <span className="text-muted text-sm">By Type</span>
            <div className="table-wrapper" style={{ maxHeight: 250, overflowY: 'auto', marginTop: 4 }}>
              <table>
                <thead>
                  <tr><th>Type</th><th>Total</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {byType.map((t) => (
                    <tr key={t.category}>
                      <td>
                        {t.type_name}
                        {t.is_liability && <span className="badge badge-danger" style={{ marginLeft: 6, fontSize: 10 }}>Liability</span>}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{cur(t.total)}</td>
                      <td>{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <>
      {/* Metadata header */}
      <div className="form-row" style={{ marginBottom: 8 }}>
        <DetailField label="From" value={share.owner_username || share.owner_user_id} />
        <DetailField label="Type">{renderSourceType(share.source_type)}</DetailField>
      </div>
      <div className="form-row" style={{ marginBottom: 8 }}>
        <DetailField label="Sync Mode">{renderSyncBadge(share.sync_mode)}</DetailField>
        <DetailField label="Shared On" value={(share.shared_at || share.created_at) ? new Date(share.shared_at || share.created_at).toLocaleDateString() : '--'} />
      </div>
      {share.label && (
        <DetailField label="Label" value={share.label} />
      )}

      <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border-color, #e0e0e0)' }} />

      {!d && (
        <div className="alert alert-danger">
          <AlertTriangle size={16} />
          <span>Decryption failed — the shared data could not be read.</span>
        </div>
      )}

      {/* Reuse existing detail content components */}
      {d && share.source_type === 'account' && <AccountDetailContent item={d} />}
      {d && share.source_type === 'asset' && <AssetDetailContent item={d} />}
      {d && share.source_type === 'license' && <LicenseDetailContent item={d} />}
      {d && share.source_type === 'insurance' && <InsuranceDetailContent item={d} />}

      {/* Portfolio (no existing detail modal — custom rendering) */}
      {d && share.source_type === 'portfolio' && (
        <div className="flex flex-col gap-3">
          {/* Summary block */}
          {d.summary && (
            <>
              <DetailRow>
                <DetailField label="Net Worth" value={cur(d.summary.net_worth)} bold large />
                <DetailField label="Total Assets" value={cur(d.summary.total_assets)} bold />
              </DetailRow>
              <DetailRow>
                <DetailField label="Liquid Assets" value={cur(d.summary.total_liquid)} bold />
                <DetailField label="Total Liabilities" value={cur(d.summary.total_liabilities)} bold />
              </DetailRow>
            </>
          )}

          {d.snapshot_date && <DetailField label="Snapshot Date" value={fmtDate(d.snapshot_date)} />}

          {/* Assets table */}
          {Array.isArray(d.assets) && d.assets.length > 0 && (
            <div>
              <span className="text-muted text-sm">Assets</span>
              <div className="table-wrapper" style={{ maxHeight: 300, overflowY: 'auto', marginTop: 4 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Amount</th>
                      <th>Liquid</th>
                      <th>Liability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.assets.map((a, i) => (
                      <tr key={a.id || i}>
                        <td>{a.name || '--'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{cur(a.amount ?? a.base_amount)}</td>
                        <td>{a.is_liquid ? <span className="badge badge-success">Yes</span> : <span className="badge badge-muted">No</span>}</td>
                        <td>{a.is_liability ? <span className="badge badge-danger">Yes</span> : <span className="badge badge-muted">No</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Saved snapshot details (rendered as tables) */}
          {d.details && renderSnapshotDetails(d.details)}

          {/* By Country */}
          {Array.isArray(d.by_country) && d.by_country.length > 0 && (
            <div>
              <span className="text-muted text-sm">By Country</span>
              <div className="table-wrapper" style={{ maxHeight: 250, overflowY: 'auto', marginTop: 4 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Country</th>
                      <th>Assets</th>
                      <th>Liabilities</th>
                      <th>Net</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.by_country.map((c) => (
                      <tr key={c.country_code}>
                        <td>{c.flag_emoji ? `${c.flag_emoji} ` : ''}{c.country_name}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{cur(c.assets)}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{cur(c.liabilities)}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{cur(c.total)}</td>
                        <td>{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By Type */}
          {Array.isArray(d.by_type) && d.by_type.length > 0 && (
            <div>
              <span className="text-muted text-sm">By Type</span>
              <div className="table-wrapper" style={{ maxHeight: 250, overflowY: 'auto', marginTop: 4 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Total</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.by_type.map((t) => (
                      <tr key={t.category}>
                        <td>
                          {t.type_name}
                          {t.is_liability && <span className="badge badge-danger" style={{ marginLeft: 6, fontSize: 10 }}>Liability</span>}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{cur(t.total)}</td>
                        <td>{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Portfolio Snapshot (saved snapshot) */}
      {d && share.source_type === 'portfolio_snapshot' && (
        <div className="flex flex-col gap-3">
          {d.snapshot_date && <DetailField label="Snapshot Date" value={fmtDate(d.snapshot_date)} />}
          {d.net_worth != null && (
            <DetailRow>
              <DetailField label="Net Worth" value={cur(d.net_worth)} bold large />
              <DetailField label="Total Assets" value={cur(d.total_assets)} bold />
            </DetailRow>
          )}
          {(d.total_liquid != null || d.total_liabilities != null) && (
            <DetailRow>
              <DetailField label="Liquid Assets" value={cur(d.total_liquid)} bold />
              <DetailField label="Total Liabilities" value={cur(d.total_liabilities)} bold />
            </DetailRow>
          )}
          {d.details && renderSnapshotDetails(d.details)}
          {d.note && <DetailField label="Note" value={d.note} />}
        </div>
      )}

      {/* Fallback for unknown types */}
      {d && !['account', 'asset', 'license', 'insurance', 'portfolio', 'portfolio_snapshot'].includes(share.source_type) && (
        <div>
          <span className="text-muted text-sm">Raw Data</span>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 4, background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 6, padding: 12 }}>
            {JSON.stringify(d, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
