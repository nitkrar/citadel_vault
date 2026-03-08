import { useState, useMemo, useCallback } from 'react';
import {
  Briefcase, Lock, TrendingUp, Camera, Calendar, AlertTriangle, DollarSign,
} from 'lucide-react';
import api from '../api/client';
import { useEncryption } from '../contexts/EncryptionContext';
import { entryStore } from '../lib/entryStore';
import useVaultData from '../hooks/useVaultData';
import { apiData, fmtCurrency } from '../lib/checks';

export default function PortfolioPage() {
  const { isUnlocked, decrypt, encrypt } = useEncryption();
  const [tab, setTab] = useState('live');
  const [saving, setSaving] = useState(false);

  // ── Live view: compute from decrypted entries ────────────────────
  const fetchPortfolio = useCallback(async () => {
    const entries = await entryStore.getAll();
    const assets = [];
    const accounts = [];

    for (const entry of entries) {
      if (entry.entry_type !== 'asset' && entry.entry_type !== 'account') continue;
      try {
        const d = await decrypt(entry.data);
        if (d) {
          const item = { ...d, entry_type: entry.entry_type, id: entry.id };
          if (entry.entry_type === 'asset') assets.push(item);
          else accounts.push(item);
        }
      } catch { /* skip */ }
    }

    // Also fetch shared items (always live)
    try {
      // Shared items that are accounts/assets would need RSA decryption
      // For MVP, only include own entries
    } catch {}

    return { assets, accounts };
  }, [decrypt]);

  const { data: portfolio, loading, refetch } = useVaultData(fetchPortfolio, { assets: [], accounts: [] });

  // ── Totals ───────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let assetTotal = 0;
    let accountTotal = 0;
    for (const a of portfolio.assets) {
      const val = parseFloat(a.value || a.current_value || 0);
      if (!isNaN(val)) assetTotal += val;
    }
    for (const a of portfolio.accounts) {
      const val = parseFloat(a.balance || 0);
      if (!isNaN(val)) accountTotal += val;
    }
    return { assets: assetTotal, accounts: accountTotal, total: assetTotal + accountTotal };
  }, [portfolio]);

  // ── Save snapshot ────────────────────────────────────────────────
  const handleSaveSnapshot = async () => {
    setSaving(true);
    try {
      const snapshotData = {
        assets: totals.assets,
        accounts: totals.accounts,
        total: totals.total,
        date: new Date().toISOString(),
        asset_count: portfolio.assets.length,
        account_count: portfolio.accounts.length,
      };
      const blob = await encrypt(snapshotData);
      await api.post('/snapshots.php', {
        snapshot_date: new Date().toISOString().split('T')[0],
        encrypted_data: blob,
      });
      alert('Snapshot saved.');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save snapshot.');
    } finally {
      setSaving(false);
    }
  };

  // ── History tab: fetch and decrypt snapshots ─────────────────────
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);

  const loadSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const { data: resp } = await api.get('/snapshots.php');
      const raw = apiData({ data: resp }) || [];
      const decrypted = [];
      for (const s of raw) {
        try {
          const d = await decrypt(s.data);
          decrypted.push({ ...s, _decrypted: d });
        } catch {
          decrypted.push({ ...s, _decrypted: null });
        }
      }
      setSnapshots(decrypted);
    } catch {}
    setLoadingSnapshots(false);
  };

  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state"><Lock size={40} className="empty-icon" /><h3>Vault is locked</h3><p>Unlock to view your portfolio.</p></div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div><h1 className="page-title">Portfolio</h1><p className="page-subtitle">Your financial overview (computed client-side)</p></div>
        <button className="btn btn-primary" onClick={handleSaveSnapshot} disabled={saving}>
          <Camera size={16} /> {saving ? 'Saving...' : 'Save Snapshot'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button className={`btn btn-sm ${tab === 'live' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('live')}><TrendingUp size={14} /> Live</button>
        <button className={`btn btn-sm ${tab === 'history' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setTab('history'); loadSnapshots(); }}><Calendar size={14} /> History</button>
      </div>

      {tab === 'live' && (
        loading ? <div className="loading-center"><div className="spinner" /></div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Total Net Worth</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCurrency(totals.total)}</div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Assets ({portfolio.assets.length})</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCurrency(totals.assets)}</div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Accounts ({portfolio.accounts.length})</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{fmtCurrency(totals.accounts)}</div>
              </div>
            </div>

            {portfolio.assets.length === 0 && portfolio.accounts.length === 0 ? (
              <div className="empty-state"><Briefcase size={40} className="empty-icon" /><h3>No assets or accounts</h3><p>Add entries in the Vault to see your portfolio.</p></div>
            ) : (
              <div className="card"><div className="table-wrapper"><table>
                <thead><tr><th>Name</th><th>Type</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                <tbody>
                  {[...portfolio.assets, ...portfolio.accounts].map((item, i) => (
                    <tr key={i}>
                      <td className="font-medium">{item.title || 'Untitled'}</td>
                      <td><span className="badge">{item.entry_type}</span></td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(item.value || item.current_value || item.balance || 0, item.currency ? item.currency + ' ' : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div></div>
            )}
          </>
        )
      )}

      {tab === 'history' && (
        loadingSnapshots ? <div className="loading-center"><div className="spinner" /></div> :
        snapshots.length === 0 ? (
          <div className="empty-state"><Calendar size={40} className="empty-icon" /><h3>No snapshots</h3><p>Save a snapshot to track your portfolio over time.</p></div>
        ) : (
          <div className="card"><div className="table-wrapper"><table>
            <thead><tr><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Assets</th><th style={{ textAlign: 'right' }}>Accounts</th></tr></thead>
            <tbody>{snapshots.map((s, i) => (
              <tr key={i}>
                <td>{s.snapshot_date}</td>
                <td style={{ textAlign: 'right' }}>{s._decrypted ? fmtCurrency(s._decrypted.total) : '(encrypted)'}</td>
                <td style={{ textAlign: 'right' }}>{s._decrypted ? fmtCurrency(s._decrypted.assets) : '--'}</td>
                <td style={{ textAlign: 'right' }}>{s._decrypted ? fmtCurrency(s._decrypted.accounts) : '--'}</td>
              </tr>
            ))}</tbody>
          </table></div></div>
        )
      )}
    </div>
  );
}
