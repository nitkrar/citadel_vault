import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Share2, Users, Send, Lock, AlertTriangle, Trash2, Eye, X,
  Landmark, Briefcase, FileText, Shield, PieChart, CheckSquare, Square, Clock, Info, Camera,
} from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';
import SortTh from '../components/SortableTh';
import FieldDisplay from '../components/FieldDisplay';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import * as cryptoLib from '../lib/crypto';
import useVaultData from '../hooks/useVaultData';
import usePortfolioData from '../hooks/usePortfolioData';
import { apiData } from '../lib/checks';

// ── Constants ──────────────────────────────────────────────────────────

const SYNC_MODES = [
  { value: 'snapshot', label: 'One-time Snapshot', desc: 'Recipient gets a copy at this point in time' },
  { value: 'continuous', label: 'Continuous', desc: 'You can push updates when you edit the entry' },
];

const SOURCE_TYPES = [
  { value: 'account', label: 'Accounts', icon: Landmark },
  { value: 'asset', label: 'Assets', icon: Briefcase },
  { value: 'license', label: 'Licenses', icon: FileText },
  { value: 'insurance', label: 'Insurance', icon: Shield },
  { value: 'portfolio', label: 'Portfolio', icon: PieChart },
];

const PORTFOLIO_MODES = [
  { value: 'summary', label: 'Summary Only', desc: 'Net worth, totals, breakdowns by country/type' },
  { value: 'full_snapshot', label: 'Full Snapshot', desc: 'Summary + all individual assets' },
  { value: 'saved_snapshot', label: 'Saved Snapshot', desc: 'A specific saved portfolio snapshot' },
  { value: 'selective', label: 'Selective', desc: 'Choose specific assets to include' },
];

const defaultForm = {
  recipient: '',
  source_type: 'account',
  sync_mode: 'snapshot',
  label: '',
  expires_at: '',
};

// ── useSelection hook ──────────────────────────────────────────────────

function useSelection() {
  const [selected, setSelected] = useState([]);

  const toggle = useCallback((id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const toggleAll = useCallback((items) => {
    setSelected(prev => prev.length === items.length ? [] : items.map(i => i.id));
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  return { selected, setSelected, toggle, toggleAll, clear };
}

// ── Render helpers ─────────────────────────────────────────────────────

const renderSyncBadge = (mode) => {
  if (mode === 'continuous') return <span className="badge badge-success">Continuous</span>;
  return <span className="badge badge-muted">Snapshot</span>;
};

const renderExpiryBadge = (expires) => {
  if (!expires) return <span className="text-muted" style={{ fontSize: 12 }}>Permanent</span>;
  const d = new Date(expires);
  if (d < new Date()) return <span className="badge badge-danger">Expired</span>;
  return <span className="badge badge-warning">{d.toLocaleDateString()}</span>;
};

const renderTypeBadge = (type) => {
  const cfg = SOURCE_TYPES.find(s => s.value === type);
  return <span className="badge">{cfg?.label || type || 'Entry'}</span>;
};

// ── Component ──────────────────────────────────────────────────────────

export default function SharingPage() {
  const { isUnlocked, decrypt } = useEncryption();
  const { entries, decryptedCache } = useVaultEntries();
  const { portfolio, displayCurrency, baseCurrency, currencies } = usePortfolioData();
  const [tab, setTab] = useState('with-me');
  const [showShareModal, setShowShareModal] = useState(false);
  const [viewItem, setViewItem] = useState(null);

  // Sort state — Shared By Me
  const [sentSortKey, setSentSortKey] = useState('created_at');
  const [sentSortDir, setSentSortDir] = useState('desc');
  const toggleSentSort = (key) => {
    if (sentSortKey === key) setSentSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSentSortKey(key); setSentSortDir(key === 'recipient_identifier' ? 'asc' : 'desc'); }
  };

  // Sort state — Shared With Me
  const [recvSortKey, setRecvSortKey] = useState('created_at');
  const [recvSortDir, setRecvSortDir] = useState('desc');
  const toggleRecvSort = (key) => {
    if (recvSortKey === key) setRecvSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setRecvSortKey(key); setRecvSortDir(key === 'title' ? 'asc' : 'desc'); }
  };

  // Share form
  const [form, setForm] = useState({ ...defaultForm });
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [includeConnected, setIncludeConnected] = useState(false);

  // Portfolio sharing state
  const [portfolioMode, setPortfolioMode] = useState('summary');
  const [snapshotId, setSnapshotId] = useState('');
  const [savedSnapshots, setSavedSnapshots] = useState([]);

  // Selection hooks (unconditional)
  const itemSelection = useSelection();
  const selectiveSelection = useSelection();

  // Load saved snapshots when vault is unlocked
  useEffect(() => {
    if (!isUnlocked) return;
    api.get('/snapshots.php')
      .then(({ data: resp }) => {
        const snaps = apiData({ data: resp }) || [];
        setSavedSnapshots(snaps);
      })
      .catch(() => {});
  }, [isUnlocked]);

  // Derive portfolio assets for selective mode picker
  const portfolioAssets = useMemo(() => portfolio?.assets || [], [portfolio]);

  const setField = (key, value) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'source_type') {
        itemSelection.clear();
        selectiveSelection.clear();
        setIncludeConnected(false);
        setPortfolioMode('summary');
        setSnapshotId('');
      }
      return next;
    });
  };

  // ── Derive items for picker ──────────────────────────────────────
  const sourceItems = useMemo(() => {
    if (form.source_type === 'portfolio') return [];
    return entries
      .filter(e => e.entry_type === form.source_type)
      .map(e => {
        const d = decryptedCache[e.id];
        return {
          id: e.id,
          name: d?.title || `#${e.id}`,
          meta: d?.institution || d?.provider || d?.vendor || '',
        };
      });
  }, [entries, decryptedCache, form.source_type]);

  const allSelected = sourceItems.length > 0 && itemSelection.selected.length === sourceItems.length;

  // ── Connected assets ─────────────────────────────────────────────
  const connectedAssets = useMemo(() => {
    if (form.source_type !== 'account') return [];
    return entries.filter(e => {
      if (e.entry_type !== 'asset') return false;
      const d = decryptedCache[e.id];
      return d && itemSelection.selected.includes(parseInt(d.linked_account_id));
    });
  }, [entries, decryptedCache, form.source_type, itemSelection.selected]);

  // ── Shared with me (decrypt with RSA) ────────────────────────────
  const fetchSharedWithMe = useCallback(async () => {
    const { data: resp } = await api.get('/sharing.php?action=shared-with-me');
    const items = apiData({ data: resp }) || [];

    // Fetch + decrypt private key once
    let privateKey = null;
    try {
      const { data: pkResp } = await api.get('/encryption.php?action=private-key-encrypted');
      const { encrypted_private_key } = apiData({ data: pkResp });
      privateKey = await cryptoLib.decryptPrivateKey(encrypted_private_key, cryptoLib._getDekForContext());
    } catch { /* no private key */ }

    const decrypted = [];
    for (const item of items) {
      let plainData = null;
      if (privateKey && item.encrypted_data) {
        try {
          const plain = await cryptoLib.hybridDecrypt(item.encrypted_data, privateKey);
          plainData = JSON.parse(plain);
        } catch { /* decryption failed */ }
      }
      decrypted.push({ ...item, _decrypted: plainData });
    }
    return decrypted;
  }, []);

  const { data: sharedWithMe, loading: loadingWithMe, refetch: refetchWithMe } = useVaultData(fetchSharedWithMe, []);

  // ── Shared by me ─────────────────────────────────────────────────
  const fetchSharedByMe = useCallback(async () => {
    const { data: resp } = await api.get('/sharing.php?action=shared-by-me');
    return apiData({ data: resp }) || [];
  }, []);

  const { data: sharedByMe, loading: loadingByMe, refetch: refetchByMe } = useVaultData(fetchSharedByMe, []);

  // ── Sorted data ─────────────────────────────────────────────────
  const sortedSent = useMemo(() => {
    const dir = sentSortDir === 'asc' ? 1 : -1;
    return [...sharedByMe].sort((a, b) => {
      let va, vb;
      switch (sentSortKey) {
        case 'recipient_identifier': va = a.recipient_identifier || ''; vb = b.recipient_identifier || ''; break;
        case 'entry_type': va = a.entry_type || a.source_type || ''; vb = b.entry_type || b.source_type || ''; break;
        case 'sync_mode': va = a.sync_mode || ''; vb = b.sync_mode || ''; break;
        case 'label': va = a.label || ''; vb = b.label || ''; break;
        case 'expires_at': va = a.expires_at || ''; vb = b.expires_at || ''; break;
        default: va = a.created_at || ''; vb = b.created_at || '';
      }
      const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
      return sa < sb ? -dir : sa > sb ? dir : 0;
    });
  }, [sharedByMe, sentSortKey, sentSortDir]);

  const sortedRecv = useMemo(() => {
    const dir = recvSortDir === 'asc' ? 1 : -1;
    return [...sharedWithMe].sort((a, b) => {
      let va, vb;
      switch (recvSortKey) {
        case 'title':
          va = a._decrypted?.title || ''; vb = b._decrypted?.title || ''; break;
        case 'sender_username': va = a.sender_username || ''; vb = b.sender_username || ''; break;
        case 'entry_type': va = a.source_type || a.entry_type || ''; vb = b.source_type || b.entry_type || ''; break;
        case 'sync_mode': va = a.sync_mode || ''; vb = b.sync_mode || ''; break;
        case 'label': va = a.label || ''; vb = b.label || ''; break;
        case 'expires_at': va = a.expires_at || ''; vb = b.expires_at || ''; break;
        default: va = a.created_at || ''; vb = b.created_at || '';
      }
      const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
      return sa < sb ? -dir : sa > sb ? dir : 0;
    });
  }, [sharedWithMe, recvSortKey, recvSortDir]);

  // ── Open share modal ─────────────────────────────────────────────
  const openShareModal = () => {
    setForm({ ...defaultForm });
    setShareError('');
    itemSelection.clear();
    selectiveSelection.clear();
    setIncludeConnected(false);
    setPortfolioMode('summary');
    setSnapshotId('');
    setShowShareModal(true);
  };

  // ── Share ────────────────────────────────────────────────────────
  const handleShare = async (e) => {
    e.preventDefault();
    setShareError('');
    if (!form.recipient.trim()) { setShareError('Enter a recipient.'); return; }

    if (form.source_type === 'portfolio') {
      // Portfolio sharing
      if (!portfolio && portfolioMode !== 'saved_snapshot') {
        setShareError('Portfolio data not available. Unlock vault and wait for portfolio to load.');
        return;
      }

      let dataToShare;

      if (portfolioMode === 'summary') {
        dataToShare = {
          type: 'portfolio_summary',
          snapshot_date: new Date().toISOString(),
          display_currency: displayCurrency,
          summary: portfolio.summary,
          by_country: portfolio.by_country,
          by_type: portfolio.by_type,
        };
      } else if (portfolioMode === 'full_snapshot') {
        dataToShare = {
          type: 'portfolio_full',
          snapshot_date: new Date().toISOString(),
          display_currency: displayCurrency,
          summary: portfolio.summary,
          assets: portfolio.assets.map(a => ({
            name: a.name, currency: a.currency, rawValue: a.rawValue,
            displayValue: a.displayValue, subtype: a.subtype, is_liability: a.is_liability,
          })),
          by_country: portfolio.by_country,
          by_type: portfolio.by_type,
        };
      } else if (portfolioMode === 'saved_snapshot') {
        if (!snapshotId) { setShareError('Select a snapshot.'); return; }
        const snap = savedSnapshots.find(s => s.snapshot_date === snapshotId);
        if (!snap) { setShareError('Snapshot not found.'); return; }
        // Decrypt snapshot entries
        const decryptedEntries = [];
        if (snap.entries && snap.entries.length > 0) {
          for (const se of snap.entries) {
            try {
              const d = await decrypt(se.encrypted_data);
              decryptedEntries.push(d);
            } catch { /* skip */ }
          }
        }
        // Decrypt snapshot meta
        let meta = {};
        try { meta = await decrypt(snap.data || snap.encrypted_data); } catch { /* skip */ }
        dataToShare = {
          type: 'portfolio_snapshot',
          snapshot_date: snap.snapshot_date,
          meta,
          assets: decryptedEntries,
        };
      } else if (portfolioMode === 'selective') {
        if (selectiveSelection.selected.length === 0) { setShareError('Select at least one asset.'); return; }
        const selectedAssets = portfolio.assets.filter(a => selectiveSelection.selected.includes(a.id));
        dataToShare = {
          type: 'portfolio_selective',
          snapshot_date: new Date().toISOString(),
          display_currency: displayCurrency,
          assets: selectedAssets.map(a => ({
            name: a.name, currency: a.currency, rawValue: a.rawValue,
            displayValue: a.displayValue, subtype: a.subtype, is_liability: a.is_liability,
          })),
        };
      }

      // Encrypt and share
      setSharing(true);
      try {
        const { data: keyResp } = await api.get(`/sharing.php?action=recipient-key&identifier=${encodeURIComponent(form.recipient.trim())}`);
        const { public_key, recipient_token } = apiData({ data: keyResp });
        const recipientPubKey = await cryptoLib.importPublicKey(public_key);
        const encryptedData = await cryptoLib.hybridEncrypt(JSON.stringify(dataToShare), recipientPubKey);

        await api.post('/sharing.php?action=share', {
          source_entry_id: 0,
          source_type: 'portfolio',
          entry_type: 'portfolio',
          sync_mode: form.sync_mode,
          label: form.label.trim() || null,
          expires_at: form.expires_at || null,
          recipients: [{ recipient_token, encrypted_data: encryptedData, identifier: form.recipient.trim() }],
        });

        setShowShareModal(false);
        refetchByMe();
      } catch (err) {
        setShareError(err.response?.data?.error || err.message || 'Share failed.');
      } finally {
        setSharing(false);
      }
      return;
    }

    if (itemSelection.selected.length === 0) { setShareError('Select at least one item.'); return; }

    setSharing(true);
    try {
      // Get recipient key
      const { data: keyResp } = await api.get(`/sharing.php?action=recipient-key&identifier=${encodeURIComponent(form.recipient.trim())}`);
      const { public_key, recipient_token } = apiData({ data: keyResp });
      const recipientPubKey = await cryptoLib.importPublicKey(public_key);

      // Build items to share
      let itemIds = [...itemSelection.selected];
      if (form.source_type === 'account' && includeConnected) {
        for (const asset of connectedAssets) {
          if (!itemIds.includes(asset.id)) itemIds.push(asset.id);
        }
      }

      // Encrypt and POST each item
      for (const id of itemIds) {
        const entry = entries.find(en => en.id === id);
        const plainData = decryptedCache[id];
        if (!plainData || !entry) continue;
        const encryptedData = await cryptoLib.hybridEncrypt(JSON.stringify(plainData), recipientPubKey);

        await api.post('/sharing.php?action=share', {
          source_entry_id: id,
          source_type: entry.entry_type,
          sync_mode: form.sync_mode,
          label: form.label.trim() || null,
          expires_at: form.expires_at || null,
          recipients: [{ recipient_token, encrypted_data: encryptedData, identifier: form.recipient.trim() }],
        });
      }

      setShowShareModal(false);
      setForm({ ...defaultForm });
      itemSelection.clear();
      setIncludeConnected(false);
      refetchByMe();
    } catch (err) {
      setShareError(err.response?.data?.error || err.message || 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  // ── Revoke ───────────────────────────────────────────────────────
  const handleRevoke = async (share) => {
    if (!window.confirm('Revoke this share?')) return;
    try {
      await api.post('/sharing.php?action=revoke', {
        source_entry_id: share.source_entry_id,
        user_ids: share.recipient_id ? [share.recipient_id] : [],
      });
      refetchByMe();
    } catch (err) {
      alert(err.response?.data?.error || 'Revoke failed.');
    }
  };

  // ── Locked state ─────────────────────────────────────────────────
  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state"><Lock size={40} className="empty-icon" /><h3>Vault is locked</h3><p>Unlock your vault to manage sharing.</p></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Sharing</h1><p className="page-subtitle">Share entries securely with other users</p></div>
        <button className="btn btn-primary" onClick={openShareModal}><Send size={16} /> Share Entry</button>
      </div>

      <div className="flex gap-2 mb-4">
        <button className={`btn btn-sm ${tab === 'with-me' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('with-me')}><Users size={14} /> Shared With Me</button>
        <button className={`btn btn-sm ${tab === 'by-me' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('by-me')}><Share2 size={14} /> Shared By Me</button>
      </div>

      {/* ── Shared With Me table ──────────────────────────────────── */}
      {tab === 'with-me' && (
        loadingWithMe ? <div className="loading-center"><div className="spinner" /></div> :
        sharedWithMe.length === 0 ? (
          <div className="empty-state"><Users size={40} className="empty-icon" /><h3>Nothing shared with you</h3></div>
        ) : (
          <div className="card"><div className="table-wrapper"><table>
            <thead><tr>
              <SortTh sortKey="title" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>Title</SortTh>
              <SortTh sortKey="sender_username" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>From</SortTh>
              <SortTh sortKey="entry_type" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>Type</SortTh>
              <SortTh sortKey="sync_mode" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>Sync</SortTh>
              <SortTh sortKey="label" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>Label</SortTh>
              <SortTh sortKey="expires_at" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>Expiry</SortTh>
              <SortTh sortKey="created_at" current={recvSortKey} dir={recvSortDir} onSort={toggleRecvSort}>Shared</SortTh>
              <th>Actions</th>
            </tr></thead>
            <tbody>{sortedRecv.map(item => (
              <tr key={item.id}>
                <td className="font-medium">
                  {item._decrypted?.type?.startsWith('portfolio_')
                    ? `Portfolio (${item._decrypted.type.replace('portfolio_', '')})`
                    : (item._decrypted?.title || '(encrypted)')}
                </td>
                <td>{item.sender_username || 'Unknown'}</td>
                <td>{renderTypeBadge(item.source_type || item.entry_type)}</td>
                <td>{renderSyncBadge(item.sync_mode)}</td>
                <td>{item.label || <span className="text-muted" style={{ fontSize: 12 }}>—</span>}</td>
                <td>{renderExpiryBadge(item.expires_at)}</td>
                <td style={{ fontSize: 13 }}>{new Date(item.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => setViewItem(item)}>
                    <Eye size={14} /> View
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )
      )}

      {/* ── Shared By Me table ───────────────────────────────────── */}
      {tab === 'by-me' && (
        loadingByMe ? <div className="loading-center"><div className="spinner" /></div> :
        sharedByMe.length === 0 ? (
          <div className="empty-state"><Share2 size={40} className="empty-icon" /><h3>You haven't shared anything</h3></div>
        ) : (
          <div className="card"><div className="table-wrapper"><table>
            <thead><tr>
              <SortTh sortKey="recipient_identifier" current={sentSortKey} dir={sentSortDir} onSort={toggleSentSort}>Recipient</SortTh>
              <SortTh sortKey="entry_type" current={sentSortKey} dir={sentSortDir} onSort={toggleSentSort}>Type</SortTh>
              <SortTh sortKey="sync_mode" current={sentSortKey} dir={sentSortDir} onSort={toggleSentSort}>Sync</SortTh>
              <SortTh sortKey="label" current={sentSortKey} dir={sentSortDir} onSort={toggleSentSort}>Label</SortTh>
              <SortTh sortKey="expires_at" current={sentSortKey} dir={sentSortDir} onSort={toggleSentSort}>Expiry</SortTh>
              <SortTh sortKey="created_at" current={sentSortKey} dir={sentSortDir} onSort={toggleSentSort}>Shared</SortTh>
              <th>Actions</th>
            </tr></thead>
            <tbody>{sortedSent.map(item => (
              <tr key={item.id}>
                <td>{item.recipient_identifier}</td>
                <td>{renderTypeBadge(item.source_type || item.entry_type)}</td>
                <td>{renderSyncBadge(item.sync_mode)}</td>
                <td>{item.label || <span className="text-muted" style={{ fontSize: 12 }}>—</span>}</td>
                <td>{renderExpiryBadge(item.expires_at)}</td>
                <td style={{ fontSize: 13 }}>{new Date(item.created_at).toLocaleDateString()}</td>
                <td><button className="btn btn-ghost btn-sm text-danger" onClick={() => handleRevoke(item)}><Trash2 size={14} /> Revoke</button></td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )
      )}

      {/* ── Share Modal ──────────────────────────────────────────── */}
      <Modal isOpen={showShareModal} onClose={() => setShowShareModal(false)} title="Share Entry">
        <form onSubmit={handleShare}>
          {/* Error */}
          {shareError && <div className="alert alert-danger mb-3"><AlertTriangle size={14} /> {shareError}</div>}

          {/* Recipient */}
          <div className="form-group">
            <label className="form-label">Recipient (username or email)</label>
            <input
              className="form-control"
              value={form.recipient}
              onChange={e => setField('recipient', e.target.value)}
              placeholder="username or email"
            />
          </div>

          {/* Source type buttons */}
          <div className="form-group">
            <label className="form-label">Type</label>
            <div className="share-source-types">
              {SOURCE_TYPES.map(st => {
                const Icon = st.icon;
                return (
                  <button
                    key={st.value}
                    type="button"
                    className={`share-source-btn${form.source_type === st.value ? ' active' : ''}`}
                    onClick={() => setField('source_type', st.value)}
                  >
                    <Icon size={18} />
                    {st.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Item picker (non-portfolio) */}
          {form.source_type !== 'portfolio' && (
            <div className="form-group">
              <label className="form-label">
                Select Items
                {itemSelection.selected.length > 0 && (
                  <span className="badge badge-success" style={{ marginLeft: 8 }}>{itemSelection.selected.length} selected</span>
                )}
              </label>
              {sourceItems.length === 0 ? (
                <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>
                  No {SOURCE_TYPES.find(s => s.value === form.source_type)?.label?.toLowerCase() || 'items'} in your vault.
                </div>
              ) : (
                <div className="share-item-picker">
                  {/* Select all header */}
                  <div className="share-item-picker-header" onClick={() => itemSelection.toggleAll(sourceItems)}>
                    {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    <span>Select All ({sourceItems.length})</span>
                  </div>
                  {/* Item list */}
                  <div className="share-item-picker-list">
                    {sourceItems.map(item => {
                      const isSelected = itemSelection.selected.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`share-item-picker-row${isSelected ? ' selected' : ''}`}
                          onClick={() => itemSelection.toggle(item.id)}
                        >
                          {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                          <div className="share-item-name">
                            {item.name}
                            {item.meta && <div className="share-item-meta">{item.meta}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Include connected assets toggle (accounts only) */}
          {form.source_type === 'account' && itemSelection.selected.length > 0 && (
            <div className="form-group">
              <div
                className="share-connected-toggle"
                onClick={() => setIncludeConnected(prev => !prev)}
              >
                {includeConnected ? <CheckSquare size={16} /> : <Square size={16} />}
                <span>
                  Include connected assets
                  {connectedAssets.length > 0
                    ? ` (${connectedAssets.length} found)`
                    : ' (none found)'}
                </span>
              </div>
            </div>
          )}

          {/* Portfolio mode selector */}
          {form.source_type === 'portfolio' && (
            <div className="form-group">
              <label className="form-label">Portfolio Mode</label>
              <div className="share-item-picker">
                {PORTFOLIO_MODES.map(mode => (
                  <div
                    key={mode.value}
                    className={`share-item-picker-row${portfolioMode === mode.value ? ' selected' : ''}`}
                    onClick={() => { setPortfolioMode(mode.value); selectiveSelection.clear(); setSnapshotId(''); }}
                    style={{ cursor: 'pointer' }}
                  >
                    {portfolioMode === mode.value ? <CheckSquare size={14} /> : <Square size={14} />}
                    <div className="share-item-name">
                      {mode.label}
                      <div className="share-item-meta">{mode.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saved snapshot picker */}
          {form.source_type === 'portfolio' && portfolioMode === 'saved_snapshot' && (
            <div className="form-group">
              <label className="form-label">Select Snapshot</label>
              {savedSnapshots.length === 0 ? (
                <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>
                  <Camera size={14} style={{ marginRight: 4 }} />
                  No saved snapshots. Save a snapshot from the Portfolio page first.
                </div>
              ) : (
                <select
                  className="form-control"
                  value={snapshotId}
                  onChange={e => setSnapshotId(e.target.value)}
                >
                  <option value="">-- Select a snapshot --</option>
                  {savedSnapshots.map((s, i) => (
                    <option key={i} value={s.snapshot_date}>
                      {s.snapshot_date} ({s.entries?.length || 0} entries)
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Selective asset picker */}
          {form.source_type === 'portfolio' && portfolioMode === 'selective' && (
            <div className="form-group">
              <label className="form-label">
                Select Assets
                {selectiveSelection.selected.length > 0 && (
                  <span className="badge badge-success" style={{ marginLeft: 8 }}>{selectiveSelection.selected.length} selected</span>
                )}
              </label>
              {portfolioAssets.length === 0 ? (
                <div className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>
                  No portfolio assets available. Add assets to your vault first.
                </div>
              ) : (
                <div className="share-item-picker">
                  <div className="share-item-picker-header" onClick={() => selectiveSelection.toggleAll(portfolioAssets)}>
                    {selectiveSelection.selected.length === portfolioAssets.length ? <CheckSquare size={16} /> : <Square size={16} />}
                    <span>Select All ({portfolioAssets.length})</span>
                  </div>
                  <div className="share-item-picker-list">
                    {portfolioAssets.map(asset => {
                      const isSelected = selectiveSelection.selected.includes(asset.id);
                      return (
                        <div
                          key={asset.id}
                          className={`share-item-picker-row${isSelected ? ' selected' : ''}`}
                          onClick={() => selectiveSelection.toggle(asset.id)}
                        >
                          {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                          <div className="share-item-name">
                            {asset.name}
                            <div className="share-item-meta">
                              {asset.currency} {typeof asset.displayValue === 'number' ? asset.displayValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
                              {asset.subtype ? ` \u00B7 ${asset.subtype}` : ''}
                              {asset.is_liability ? ' (Liability)' : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sync mode */}
          <div className="form-group">
            <label className="form-label">Sync Mode</label>
            <select
              className="form-control"
              value={form.sync_mode}
              onChange={e => setField('sync_mode', e.target.value)}
            >
              {SYNC_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              {SYNC_MODES.find(m => m.value === form.sync_mode)?.desc}
            </div>
          </div>

          {/* Continuous warning */}
          {form.sync_mode === 'continuous' && (
            <div className="alert alert-warning mb-3" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {form.source_type === 'portfolio'
                  ? 'Continuous portfolio shares require you to manually re-share updated data.'
                  : 'When you edit a continuous share, you will be prompted to re-encrypt and push the update to the recipient.'}
              </span>
            </div>
          )}

          {/* Label */}
          <div className="form-group">
            <label className="form-label">Label (optional)</label>
            <input
              className="form-control"
              value={form.label}
              onChange={e => setField('label', e.target.value)}
              placeholder="e.g. For accountant, Tax review"
            />
          </div>

          {/* Expiry */}
          <div className="form-group">
            <label className="form-label">Expires (optional)</label>
            <input
              type="datetime-local"
              className="form-control"
              value={form.expires_at}
              onChange={e => setField('expires_at', e.target.value)}
            />
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Leave blank for permanent access
            </div>
          </div>

          {/* Ghost share notice */}
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            If the recipient doesn't exist, a ghost share is created (data is unrecoverable by design).
          </p>

          {/* Buttons */}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowShareModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={sharing}>
              {sharing ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Detail Modal (received shares) ───────────────────────── */}
      <Modal
        isOpen={!!viewItem}
        onClose={() => setViewItem(null)}
        title={viewItem?._decrypted?.type?.startsWith('portfolio_')
          ? 'Portfolio Share'
          : (viewItem?._decrypted?.title || 'Shared Entry')}
      >
        {viewItem && (() => {
          const d = viewItem._decrypted;
          if (!d) return <p className="text-muted">Unable to decrypt this entry.</p>;

          const header = (
            <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="badge">{viewItem.source_type || viewItem.entry_type}</span>
                {renderSyncBadge(viewItem.sync_mode)}
                <span className={`badge ${viewItem.status === 'pending' ? 'badge-warning' : 'badge-success'}`}>
                  {viewItem.status === 'pending' ? 'Pending' : 'Active'}
                </span>
              </div>
              <div className="text-muted" style={{ fontSize: 13 }}>
                Shared by <strong>{viewItem.sender_username || 'Unknown'}</strong> on {new Date(viewItem.created_at).toLocaleDateString()}
              </div>
              {viewItem.label && (
                <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
                  Label: <strong>{viewItem.label}</strong>
                </div>
              )}
            </div>
          );

          // Portfolio share rendering
          if (d.type && d.type.startsWith('portfolio_')) {
            const fmtVal = (v) => typeof v === 'number'
              ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : String(v ?? '');
            const cur = d.display_currency || '';

            return (
              <>
                {header}
                {d.snapshot_date && (
                  <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                    Snapshot date: <strong>{new Date(d.snapshot_date).toLocaleDateString()}</strong>
                    {d.type === 'portfolio_snapshot' ? ' (Saved)' : ''}
                  </div>
                )}

                {/* Summary tiles */}
                {d.summary && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
                    {[
                      { label: 'Net Worth', val: d.summary.net_worth },
                      { label: 'Total Assets', val: d.summary.total_assets },
                      { label: 'Total Liabilities', val: d.summary.total_liabilities },
                      { label: 'Asset Count', val: d.summary.asset_count },
                    ].map(tile => (
                      <div key={tile.label} className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <div className="text-muted" style={{ fontSize: 11 }}>{tile.label}</div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          {tile.label === 'Asset Count' ? tile.val : `${cur} ${fmtVal(tile.val)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Meta for saved snapshots */}
                {d.meta && typeof d.meta === 'object' && Object.keys(d.meta).length > 0 && !d.summary && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
                    {Object.entries(d.meta).filter(([k]) => typeof d.meta[k] === 'number').map(([k, v]) => (
                      <div key={k} className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <div className="text-muted" style={{ fontSize: 11, textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtVal(v)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Assets table */}
                {d.assets && d.assets.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <label className="form-label" style={{ marginBottom: 8 }}>Assets ({d.assets.length})</label>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th style={{ textAlign: 'right' }}>Value</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.assets.map((a, i) => (
                            <tr key={i}>
                              <td className="font-medium">{a.name || a.title || `Asset ${i + 1}`}</td>
                              <td style={{ textAlign: 'right' }}>
                                {a.currency || cur} {fmtVal(a.displayValue ?? a.rawValue ?? a.raw_value ?? '')}
                                {a.is_liability && <span className="badge badge-danger" style={{ marginLeft: 4, fontSize: 10 }}>Liability</span>}
                              </td>
                              <td><span className="text-muted" style={{ fontSize: 12 }}>{a.subtype || a.template_name || ''}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* By country breakdown */}
                {d.by_country && Object.keys(d.by_country).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <label className="form-label" style={{ marginBottom: 8 }}>By Country</label>
                    <div className="table-wrapper">
                      <table>
                        <thead><tr><th>Country</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
                        <tbody>
                          {Object.entries(d.by_country).map(([country, data]) => (
                            <tr key={country}>
                              <td>{country}</td>
                              <td style={{ textAlign: 'right' }}>{cur} {fmtVal(data.total)}</td>
                              <td style={{ textAlign: 'right' }}>{data.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* By type breakdown */}
                {d.by_type && Object.keys(d.by_type).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <label className="form-label" style={{ marginBottom: 8 }}>By Type</label>
                    <div className="table-wrapper">
                      <table>
                        <thead><tr><th>Type</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
                        <tbody>
                          {Object.entries(d.by_type).map(([type, data]) => (
                            <tr key={type}>
                              <td style={{ textTransform: 'capitalize' }}>{data.label || type}</td>
                              <td style={{ textAlign: 'right' }}>{cur} {fmtVal(data.total)}</td>
                              <td style={{ textAlign: 'right' }}>{data.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          }

          // Standard entry rendering
          const tplFields = viewItem.template?.fields;
          const fields = !tplFields ? [] : (typeof tplFields === 'string' ? JSON.parse(tplFields) : tplFields);

          if (fields.length === 0) {
            return <>{header}{Object.entries(d).map(([k, v]) => (
              <div key={k} className="form-group">
                <label className="form-label" style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</label>
                <div className="form-control-static">{typeof v === 'string' ? v : JSON.stringify(v)}</div>
              </div>
            ))}</>;
          }

          return <>{header}{fields.map(field => {
            const val = d[field.key];
            if (val === undefined || val === null || val === '') return null;
            return <FieldDisplay key={field.key} field={field} value={String(val)} />;
          })}</>;
        })()}
      </Modal>
    </div>
  );
}
