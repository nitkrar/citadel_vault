import { useState, useMemo, useCallback } from 'react';
import {
  PieChart as PieChartIcon, TrendingUp, Globe, Tag, List,
  DollarSign, Clock, Camera, Lock, Landmark, AlertTriangle,
  Trash2, ChevronDown, ChevronRight, RefreshCw,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { useEncryption } from '../contexts/EncryptionContext';
import { useHideAmounts } from '../components/Layout';
import usePortfolioData from '../hooks/usePortfolioData';
import useVaultData from '../hooks/useVaultData';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';
import api from '../api/client';
import { fmtCurrency, MASKED, apiData } from '../lib/checks';

const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f97316',
];

const TABS = [
  { key: 'overview',   label: 'Overview',      icon: PieChartIcon },
  { key: 'country',    label: 'By Country',    icon: Globe },
  { key: 'account',    label: 'By Account',    icon: Landmark },
  { key: 'type',       label: 'By Asset Type', icon: Tag },
  { key: 'assets',     label: 'All Assets',    icon: List },
  { key: 'currencies', label: 'By Currency',   icon: DollarSign },
  { key: 'history',    label: 'History',       icon: Clock },
];

export default function PortfolioPage() {
  const { isUnlocked, decrypt, encrypt } = useEncryption();
  const { hideAmounts } = useHideAmounts();
  const {
    portfolio, loading, error, refetch,
    displayCurrency, setDisplayCurrency, baseCurrency, currencies,
    ratesLastUpdated,
  } = usePortfolioData();

  const [activeTab, setActiveTab] = useState('overview');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [snapshotSaving, setSnapshotSaving] = useState(false);

  // Format helper respecting hideAmounts
  const fmt = useCallback((value, symbol = '') => {
    if (hideAmounts) return MASKED;
    return fmtCurrency(value, symbol);
  }, [hideAmounts]);

  // Get currency symbol for display currency
  const currencySymbol = useMemo(() => {
    const c = currencies?.find(c => c.code === displayCurrency);
    return c?.symbol || displayCurrency || '';
  }, [currencies, displayCurrency]);

  const fmtD = useCallback((value) => fmt(value, currencySymbol), [fmt, currencySymbol]);

  // Toggle expandable group
  const toggleGroup = (key) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Save snapshot ──────────────────────────────────────────────
  const handleSaveSnapshot = async () => {
    if (!portfolio) return;
    setSnapshotSaving(true);
    try {
      const snapshotData = {
        v: 2,
        base_currency: baseCurrency,
        display_currency: displayCurrency,
        total_assets: portfolio.summary.total_assets,
        total_liabilities: portfolio.summary.total_liabilities,
        net_worth: portfolio.summary.net_worth,
        asset_count: portfolio.summary.asset_count,
        by_type: Object.entries(portfolio.by_type).map(([k, v]) => ({
          type: k, label: v.label, total: v.total, count: v.count,
        })),
        by_currency: Object.entries(portfolio.by_currency).map(([k, v]) => ({
          code: k, total: v.total, count: v.count,
        })),
        date: new Date().toISOString(),
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
      setSnapshotSaving(false);
    }
  };

  // ── Vault locked state ─────────────────────────────────────────
  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>Unlock to view your portfolio.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <AlertTriangle size={40} className="empty-icon" />
          <h3>Error loading portfolio</h3>
          <p>{error.message || 'An unexpected error occurred.'}</p>
          <button className="btn btn-primary mt-3" onClick={refetch}><RefreshCw size={14} /> Retry</button>
        </div>
      </div>
    );
  }

  const p = portfolio;
  const isEmpty = !p || p.summary.asset_count === 0;

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Portfolio</h1>
          <p className="page-subtitle">
            Financial overview
            {ratesLastUpdated && (
              <span className="text-sm" style={{ marginLeft: 8, opacity: 0.7 }}>
                Rates: {new Date(ratesLastUpdated).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Currency selector */}
          {currencies && currencies.length > 0 && (
            <select
              className="form-control"
              style={{ width: 'auto', minWidth: 100, padding: '4px 30px 4px 8px', fontSize: 13 }}
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value)}
            >
              {currencies.filter(c => c.is_active === 1 || c.is_active === '1' || c.is_active === true).map(c => (
                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={handleSaveSnapshot} disabled={snapshotSaving || isEmpty}>
            <Camera size={16} /> {snapshotSaving ? 'Saving...' : 'Snapshot'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            <t.icon size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {isEmpty && activeTab !== 'history' ? (
        <div className="empty-state">
          <TrendingUp size={40} className="empty-icon" />
          <h3>No assets yet</h3>
          <p>Add asset entries in the Vault to see your portfolio.</p>
        </div>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewTab portfolio={p} fmtD={fmtD} hideAmounts={hideAmounts} />}
          {activeTab === 'country' && <GroupTab groups={p.by_country} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} labelKey="country" />}
          {activeTab === 'account' && <GroupTab groups={p.by_account} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} labelKey="account" />}
          {activeTab === 'type' && <TypeTab groups={p.by_type} fmtD={fmtD} />}
          {activeTab === 'assets' && <AllAssetsTab assets={p.assets} fmtD={fmtD} />}
          {activeTab === 'currencies' && <CurrencyTab groups={p.by_currency} fmtD={fmtD} />}
          {activeTab === 'history' && <HistoryTab decrypt={decrypt} encrypt={encrypt} fmtD={fmtD} hideAmounts={hideAmounts} />}
        </>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Overview Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function OverviewTab({ portfolio, fmtD, hideAmounts }) {
  const { summary, by_country, by_type } = portfolio;

  const countryChartData = useMemo(() =>
    Object.entries(by_country)
      .map(([name, data]) => ({ name, value: Math.abs(data.total) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
  [by_country]);

  const typeChartData = useMemo(() =>
    Object.entries(by_type)
      .map(([, data]) => ({ name: data.label, value: Math.abs(data.total) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
  [by_type]);

  const barChartData = useMemo(() =>
    Object.entries(by_country)
      .map(([name, data]) => ({
        name: name.length > 12 ? name.substring(0, 12) + '...' : name,
        total: data.total,
        count: data.count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
  [by_country]);

  return (
    <>
      {/* Summary Cards */}
      <div className="portfolio-summary-grid">
        <SummaryCard label="Total Assets" value={fmtD(summary.total_assets)} color="var(--color-info)" />
        <SummaryCard label="Liabilities" value={fmtD(summary.total_liabilities)} color="var(--color-danger)" />
        <SummaryCard label="Net Worth" value={fmtD(summary.net_worth)} color="var(--color-success)" />
        <SummaryCard label="Asset Count" value={hideAmounts ? MASKED : summary.asset_count} color="var(--color-text-muted)" />
      </div>

      {/* Charts */}
      {(countryChartData.length > 0 || typeChartData.length > 0) && (
        <div className="portfolio-chart-row">
          {countryChartData.length > 0 && (
            <div className="card" style={{ padding: 16, flex: 1, minWidth: 280 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>By Country</h4>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={countryChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {countryChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {typeChartData.length > 0 && (
            <div className="card" style={{ padding: 16, flex: 1, minWidth: 280 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>By Asset Type</h4>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={typeChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {typeChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {barChartData.length > 1 && (
        <div className="card mt-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Value by Country</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={v => hideAmounts ? '***' : abbreviateNumber(v)} />
              <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
              <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ChartTooltip({ active, payload, hideAmounts }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-card)', border: '1px solid var(--color-border)',
      borderRadius: 8, padding: '8px 12px', boxShadow: 'var(--shadow-md)',
    }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{payload[0].name}</p>
      <p style={{ fontSize: 13, margin: 0, color: 'var(--color-text-muted)' }}>
        {hideAmounts ? MASKED : fmtCurrency(payload[0].value)}
      </p>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Group Tab (Country / Account)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function GroupTab({ groups, fmtD, expanded, toggle }) {
  const sortedGroups = useMemo(() =>
    Object.entries(groups).sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)),
  [groups]);

  if (sortedGroups.length === 0) {
    return <div className="empty-state"><p>No data to display.</p></div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sortedGroups.map(([key, group]) => {
        const isOpen = expanded[key];
        const label = group.label || key;
        return (
          <div key={key} className="card">
            <button
              type="button"
              onClick={() => toggle(key)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left', fontSize: 14, fontWeight: 600, color: 'var(--color-text)',
              }}
            >
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span style={{ flex: 1 }}>{label}</span>
              <span className="badge badge-muted" style={{ marginRight: 8 }}>{group.count}</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{fmtD(group.total)}</span>
            </button>
            {isOpen && (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Name</th><th>Type</th><th>Currency</th><th style={{ textAlign: 'right' }}>Value</th></tr></thead>
                  <tbody>
                    {group.items.map(item => (
                      <tr key={item.id}>
                        <td className="font-medium">{item.name}</td>
                        <td>
                          <span className={`badge ${item.is_liability ? 'badge-danger' : 'badge-primary'}`}>
                            {item.template_name}
                          </span>
                        </td>
                        <td className="td-muted">{item.currency}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(item.displayValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// By Asset Type Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TypeTab({ groups, fmtD }) {
  const rows = useMemo(() =>
    Object.entries(groups)
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  [groups]);

  return (
    <div className="card">
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Classification</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <td className="font-medium">{row.label}</td>
                <td>
                  <span className={`badge ${row.has_liability ? 'badge-danger' : 'badge-success'}`}>
                    {row.has_liability ? 'Liability' : 'Asset'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(row.total)}</td>
                <td style={{ textAlign: 'right' }}>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// All Assets Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function AllAssetsTab({ assets, fmtD }) {
  const { sorted, sortKey, sortDir, onSort } = useSort(assets, 'name', 'asc');
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map(a => a.id)));
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} selected entries? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      for (const id of selected) {
        await api.delete(`/vault.php?id=${id}`);
      }
      setSelected(new Set());
      window.dispatchEvent(new Event('vault-sync-refresh'));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete some entries.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {selected.size > 0 && (
        <div className="bulk-toolbar">
          <span className="bulk-count">{selected.size} selected</span>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
        </div>
      )}
      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th className="th-checkbox">
                  <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0} onChange={toggleAll} />
                </th>
                <SortableTh label="Name" field="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th>Type</th>
                <th>Currency</th>
                <SortableTh label="Value" field="displayValue" sortKey={sortKey} sortDir={sortDir} onSort={onSort} style={{ textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => (
                <tr key={item.id} className={selected.has(item.id) ? 'row-selected' : ''}>
                  <td className="td-checkbox">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} />
                  </td>
                  <td className="font-medium">{item.name}</td>
                  <td>
                    <span className={`badge ${item.is_liability ? 'badge-danger' : 'badge-primary'}`}>
                      {item.template_name}
                    </span>
                  </td>
                  <td className="td-muted">{item.currency}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(item.displayValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// By Currency Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function CurrencyTab({ groups, fmtD }) {
  const rows = useMemo(() =>
    Object.entries(groups)
      .map(([code, data]) => ({ code, ...data }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  [groups]);

  return (
    <div className="card">
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              <th>Symbol</th>
              <th style={{ textAlign: 'right' }}>Total (Display)</th>
              <th style={{ textAlign: 'right' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.code}>
                <td className="font-medium">{row.code}</td>
                <td>{row.symbol}</td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(row.total)}</td>
                <td style={{ textAlign: 'right' }}>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// History Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function HistoryTab({ decrypt, fmtD, hideAmounts }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadSnapshots = async () => {
    setLoadingSnap(true);
    try {
      const { data: resp } = await api.get('/snapshots.php');
      const raw = apiData({ data: resp }) || [];
      const decrypted = [];
      for (const s of raw) {
        try {
          const d = await decrypt(s.data || s.encrypted_data);
          decrypted.push({ ...s, _d: d });
        } catch {
          decrypted.push({ ...s, _d: null });
        }
      }
      setSnapshots(decrypted);
    } catch { /* silent */ }
    setLoadingSnap(false);
    setLoaded(true);
  };

  if (!loaded) {
    return (
      <div className="text-center" style={{ padding: 32 }}>
        <button className="btn btn-primary" onClick={loadSnapshots} disabled={loadingSnap}>
          <Clock size={16} /> {loadingSnap ? 'Loading...' : 'Load Snapshots'}
        </button>
      </div>
    );
  }

  if (loadingSnap) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  if (snapshots.length === 0) {
    return (
      <div className="empty-state">
        <Clock size={40} className="empty-icon" />
        <h3>No snapshots</h3>
        <p>Save a snapshot to track your portfolio over time.</p>
      </div>
    );
  }

  // Line chart data (need 2+ snapshots)
  const chartData = snapshots
    .filter(s => s._d)
    .map(s => ({
      date: s.snapshot_date,
      net_worth: s._d.net_worth ?? s._d.total ?? (s._d.assets + (s._d.accounts || 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      {chartData.length >= 2 && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Net Worth Over Time</h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={v => hideAmounts ? '***' : abbreviateNumber(v)} />
              <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
              <Line type="monotone" dataKey="net_worth" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Net Worth" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Net Worth</th>
                <th style={{ textAlign: 'right' }}>Assets</th>
                <th style={{ textAlign: 'right' }}>Liabilities</th>
                <th style={{ textAlign: 'right' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((s, i) => {
                const d = s._d;
                const isV2 = d?.v === 2;
                return (
                  <tr key={i}>
                    <td>{s.snapshot_date}</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                      {d ? fmtD(isV2 ? d.net_worth : (d.total ?? 0)) : '(encrypted)'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {d ? fmtD(isV2 ? d.total_assets : (d.assets ?? 0)) : '--'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {d ? fmtD(isV2 ? d.total_liabilities : 0) : '--'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {d ? (d.asset_count ?? '--') : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function abbreviateNumber(value) {
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toFixed(0);
}
