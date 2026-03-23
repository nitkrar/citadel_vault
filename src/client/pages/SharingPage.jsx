import { useState, useCallback } from 'react';
import {
  Share2, Users, Send, Lock, AlertTriangle, Trash2, Eye, X,
} from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';
import FieldDisplay from '../components/FieldDisplay';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import * as cryptoLib from '../lib/crypto';
import useVaultData from '../hooks/useVaultData';
import { apiData } from '../lib/checks';

export default function SharingPage() {
  const { isUnlocked } = useEncryption();
  const { entries: myEntries, decryptedCache: decryptedEntries } = useVaultEntries();
  const [tab, setTab] = useState('with-me');
  const [showShareModal, setShowShareModal] = useState(false);
  const [viewItem, setViewItem] = useState(null);

  // Share form
  const [shareEntryId, setShareEntryId] = useState('');
  const [shareRecipient, setShareRecipient] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');

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

  // ── Open share modal ─────────────────────────────────────────────
  const openShareModal = () => {
    setShareEntryId('');
    setShareRecipient('');
    setShareError('');
    setShowShareModal(true);
  };

  // ── Share ────────────────────────────────────────────────────────
  const handleShare = async (e) => {
    e.preventDefault();
    setShareError('');
    if (!shareEntryId) { setShareError('Select an entry.'); return; }
    if (!shareRecipient.trim()) { setShareError('Enter a recipient.'); return; }

    setSharing(true);
    try {
      const { data: keyResp } = await api.get(`/sharing.php?action=recipient-key&identifier=${encodeURIComponent(shareRecipient.trim())}`);
      const { public_key, recipient_token } = apiData({ data: keyResp });

      const entry = myEntries.find(e => e.id === parseInt(shareEntryId));
      const plainData = decryptedEntries[entry.id];
      if (!plainData) throw new Error('Cannot decrypt entry.');

      const recipientPubKey = await cryptoLib.importPublicKey(public_key);
      const encryptedData = await cryptoLib.hybridEncrypt(JSON.stringify(plainData), recipientPubKey);

      await api.post('/sharing.php?action=share', {
        source_entry_id: parseInt(shareEntryId),
        recipients: [{ recipient_token, encrypted_data: encryptedData, identifier: shareRecipient.trim() }],
      });

      setShowShareModal(false);
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

      {tab === 'with-me' && (
        loadingWithMe ? <div className="loading-center"><div className="spinner" /></div> :
        sharedWithMe.length === 0 ? (
          <div className="empty-state"><Users size={40} className="empty-icon" /><h3>Nothing shared with you</h3></div>
        ) : (
          <div className="card"><div className="table-wrapper"><table>
            <thead><tr><th>Title</th><th>From</th><th>Type</th><th>Shared</th></tr></thead>
            <tbody>{sharedWithMe.map(item => (
              <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => setViewItem(item)}>
                <td className="font-medium">{item._decrypted?.title || '(encrypted)'}</td>
                <td>{item.sender_username || 'Unknown'}</td>
                <td><span className="badge">{item.entry_type}</span></td>
                <td style={{ fontSize: 13 }}>{new Date(item.created_at).toLocaleDateString()}</td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )
      )}

      {tab === 'by-me' && (
        loadingByMe ? <div className="loading-center"><div className="spinner" /></div> :
        sharedByMe.length === 0 ? (
          <div className="empty-state"><Share2 size={40} className="empty-icon" /><h3>You haven't shared anything</h3></div>
        ) : (
          <div className="card"><div className="table-wrapper"><table>
            <thead><tr><th>Recipient</th><th>Type</th><th>Status</th><th>Shared</th><th>Actions</th></tr></thead>
            <tbody>{sharedByMe.map(item => (
              <tr key={item.id}>
                <td>{item.recipient_identifier}</td>
                <td><span className="badge">{item.entry_type}</span></td>
                <td>{item.status === 'pending' ? <span className="badge badge-warning">Pending</span> : <span className="badge badge-success">Active</span>}</td>
                <td style={{ fontSize: 13 }}>{new Date(item.created_at).toLocaleDateString()}</td>
                <td><button className="btn btn-ghost btn-sm text-danger" onClick={() => handleRevoke(item)}><Trash2 size={14} /> Revoke</button></td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )
      )}

      <Modal isOpen={showShareModal} onClose={() => setShowShareModal(false)} title="Share Entry">
        <form onSubmit={handleShare}>
          {shareError && <div className="alert alert-danger mb-3">{shareError}</div>}
          <div className="form-group">
            <label className="form-label">Entry</label>
            <select className="form-control" value={shareEntryId} onChange={e => setShareEntryId(e.target.value)} required>
              <option value="">Select...</option>
              {myEntries.map(e => <option key={e.id} value={e.id}>{decryptedEntries[e.id]?.title || `#${e.id}`} ({e.entry_type})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Recipient (username or email)</label>
            <input className="form-control" value={shareRecipient} onChange={e => setShareRecipient(e.target.value)} placeholder="username or email" required />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            If the recipient doesn't exist, a ghost share is created (data is unrecoverable by design).
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowShareModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={sharing}>{sharing ? 'Sharing...' : 'Share'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!viewItem} onClose={() => setViewItem(null)} title={viewItem?._decrypted?.title || 'Shared Entry'}>
        {viewItem && (() => {
          const d = viewItem._decrypted;
          if (!d) return <p className="text-muted">Unable to decrypt this entry.</p>;

          const header = (
            <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="badge">{viewItem.entry_type}</span>
                <span className={`badge ${viewItem.status === 'pending' ? 'badge-warning' : 'badge-success'}`}>
                  {viewItem.status === 'pending' ? 'Pending' : 'Active'}
                </span>
              </div>
              <div className="text-muted" style={{ fontSize: 13 }}>
                Shared by <strong>{viewItem.sender_username || 'Unknown'}</strong> on {new Date(viewItem.created_at).toLocaleDateString()}
              </div>
            </div>
          );

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
