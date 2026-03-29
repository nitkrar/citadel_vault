import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  PieChart as PieChartIcon, TrendingUp, Globe, Tag, List,
  DollarSign, Clock, Camera, Lock, Landmark, AlertTriangle,
  Trash2, ChevronDown, ChevronRight, RefreshCw, Link2,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import { useHideAmounts } from '../components/Layout';
import usePortfolioData from '../hooks/usePortfolioData';
import useVaultData from '../hooks/useVaultData';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';
import Modal from '../components/Modal';
import useAppConfig from '../hooks/useAppConfig';
import api from '../api/client';
import { fmtCurrency, MASKED, apiData } from '../lib/checks';
import { buildRateMap, recalculateSnapshot } from '../lib/portfolioAggregator';
import * as workerDispatcher from '../lib/workerDispatcher';
import { hasAnyIntegration, getIntegration, getIntegrationType } from '../integrations/helpers';
import { getProvider } from '../integrations/modules';

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
  const { entries: vaultEntries, decryptedCache } = useVaultEntries();
  const { hideAmounts } = useHideAmounts();
  const {
    portfolio, loading, error, refetch,
    displayCurrency, setDisplayCurrency, baseCurrency, currencies,
    ratesLastUpdated, refreshPrices,
  } = usePortfolioData();

  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('pv_portfolio_last_tab') || 'overview');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [snapshotPrompt, setSnapshotPrompt] = useState(null); // { staleCount }
  const { config } = useAppConfig();
  const plaidEnabled = config?.plaid_enabled === 'true';

  // Find Plaid-connected entries from portfolio data
  const plaidEntries = useMemo(() => {
    if (!portfolio?.assets) return [];
    return portfolio.assets.filter(a => hasAnyIntegration(a));
  }, [portfolio]);

  const hasPlaidEntries = plaidEntries.length > 0;

  const [balanceRefreshingHook, setBalanceRefreshingHook] = useState(false);

  // Combined refresh: prices + balances in parallel
  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    setRefreshResult(null);
    const results = [];

    try {
      const promises = [];

      // Refresh prices (stock/crypto)
      promises.push(
        refreshPrices()
          .then(r => { if (r.count > 0) results.push(`${r.count} price${r.count !== 1 ? 's' : ''}`); })
          .catch(() => results.push('prices failed'))
      );

      // Refresh balances (Plaid)
      if (hasPlaidEntries) {
        const itemIds = [...new Set(plaidEntries.map(e => getIntegration(e, getIntegrationType(e))?.item_id).filter(Boolean))];
        if (itemIds.length > 0) {
          const provider = getProvider('plaid');
          if (provider) {
          setBalanceRefreshingHook(true);
          promises.push(
            (async () => {
              const { updated } = await provider.refresh(itemIds, vaultEntries, decryptedCache, encrypt);
              if (updated > 0) { results.push(`${updated} balance${updated !== 1 ? 's' : ''}`); refetch(); }
            })().catch(() => results.push('balances failed'))
              .finally(() => setBalanceRefreshingHook(false))
          );
          }
        }
      }

      await Promise.all(promises);
      setRefreshResult(results.length > 0 ? `Refreshed ${results.join(', ')}` : 'Everything up to date');
      setTimeout(() => setRefreshResult(null), 5000);
    } catch {
      setRefreshResult('Refresh failed');
      setTimeout(() => setRefreshResult(null), 5000);
    } finally {
      setRefreshingAll(false);
    }
  };

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

  // handleRefreshPrices removed — merged into handleRefreshAll

  // ── Save snapshot (split model v3) ──────────────────────────────
  const doSaveSnapshot = async () => {
    if (!portfolio) return;
    setSnapshotSaving(true);
    setSnapshotPrompt(null);
    try {
      const meta = {
        base_currency: baseCurrency,
        date: new Date().toISOString(),
      };
      const encryptedMeta = await encrypt(meta);

      const entryBlobs = portfolio.assets.map(asset => ({
        name: asset.name,
        template_name: asset.template_name,
        entry_type: asset.entry_type,
        subtype: asset.subtype,
        is_liability: asset.is_liability,
        currency: asset.currency,
        raw_value: asset.rawValue,
        icon: asset.icon,
      }));
      const encryptedBlobs = await workerDispatcher.encryptBatch(entryBlobs, null);
      const entries = portfolio.assets.map((a, i) => ({
        entry_id: a.id,
        encrypted_data: encryptedBlobs[i],
      }));

      await api.post('/snapshots.php', {
        snapshot_date: new Date().toISOString().split('T')[0],
        encrypted_meta: encryptedMeta,
        entries,
      });
      alert('Snapshot saved.');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save snapshot.');
    } finally {
      setSnapshotSaving(false);
    }
  };

  const handleSaveSnapshot = () => {
    if (!portfolio) return;
    try {
      const cached = JSON.parse(sessionStorage.getItem('pv_ticker_prices') || '{}');
      if (Object.keys(cached).length > 0) {
        setSnapshotPrompt({ staleCount: Object.keys(cached).length });
        return;
      }
    } catch { /* ignore */ }
    doSaveSnapshot();
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
        <div className="flex items-center gap-2 flex-wrap">
          {/* Currency selector */}
          {currencies && currencies.length > 0 && (
            <select
              className="form-control"
              style={{ width: 'auto', minWidth: 90, padding: '4px 30px 4px 8px', fontSize: 13 }}
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value)}
            >
              {currencies.filter(c => c.is_active === 1 || c.is_active === '1' || c.is_active === true).map(c => (
                <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
              ))}
            </select>
          )}
          <button className="btn btn-secondary" onClick={handleRefreshAll} disabled={refreshingAll || isEmpty}>
            <RefreshCw size={16} className={refreshingAll ? 'spin' : ''} /> {refreshingAll ? 'Refreshing...' : 'Refresh All'}
          </button>
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
            onClick={() => { setActiveTab(t.key); sessionStorage.setItem('pv_portfolio_last_tab', t.key); }}
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
          {activeTab === 'overview' && <OverviewTab portfolio={p} fmtD={fmtD} hideAmounts={hideAmounts} refreshResult={refreshResult} />}
          {activeTab === 'country' && <GroupTab groups={p.by_country} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} labelKey="country" />}
          {activeTab === 'account' && <GroupTab groups={p.by_account} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} labelKey="account" />}
          {activeTab === 'type' && <TypeTab groups={p.by_type} fmtD={fmtD} />}
          {activeTab === 'assets' && <AllAssetsTab assets={p.assets} fmtD={fmtD} />}
          {activeTab === 'currencies' && <CurrencyTab groups={p.by_currency} fmtD={fmtD} />}
          {activeTab === 'history' && <HistoryTab decrypt={decrypt} encrypt={encrypt} fmtD={fmtD} hideAmounts={hideAmounts} currencies={currencies} displayCurrency={displayCurrency} baseCurrency={baseCurrency} snapshotPrompt={snapshotPrompt} setSnapshotPrompt={setSnapshotPrompt} doSaveSnapshot={doSaveSnapshot} snapshotSaving={snapshotSaving} />}
        </>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Overview Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function OverviewTab({ portfolio, fmtD, hideAmounts, refreshResult }) {
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

  const hasGainLoss = summary.total_gain_loss !== undefined && summary.total_gain_loss !== 0;
  const glColor = summary.total_gain_loss > 0 ? 'var(--color-success, #16a34a)' : summary.total_gain_loss < 0 ? 'var(--color-danger, #dc2626)' : 'var(--color-text-muted)';

  return (
    <>
      {refreshResult && (
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 8, textAlign: 'right' }}>
          {refreshResult}
        </div>
      )}
      {/* Summary Cards */}
      <div className="portfolio-summary-grid">
        <SummaryCard label="Total Assets" value={fmtD(summary.total_assets)} color="var(--color-info)" />
        <SummaryCard label="Liabilities" value={fmtD(summary.total_liabilities)} color="var(--color-danger)" />
        <SummaryCard label="Net Worth" value={fmtD(summary.net_worth)} color="var(--color-success)" />
        {hasGainLoss
          ? <SummaryCard label="Total Gain/Loss" value={fmtD(summary.total_gain_loss)} color={glColor} />
          : <SummaryCard label="Asset Count" value={hideAmounts ? MASKED : summary.asset_count} color="var(--color-text-muted)" />
        }
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
  const hasAnyGainLoss = assets.some(a => a.gainLoss !== undefined);

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
                {hasAnyGainLoss && <SortableTh label="Gain/Loss" field="gainLoss" sortKey={sortKey} sortDir={sortDir} onSort={onSort} style={{ textAlign: 'right' }} />}
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
                  {hasAnyGainLoss && (
                    <td style={{
                      textAlign: 'right', fontWeight: 500,
                      color: item.gainLoss > 0 ? 'var(--color-success, #16a34a)' : item.gainLoss < 0 ? 'var(--color-danger, #dc2626)' : 'inherit',
                    }}>
                      {item.gainLoss !== undefined ? (
                        <>
                          {fmtD(item.gainLoss)}
                          <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>
                            ({item.gainLossPercent >= 0 ? '+' : ''}{item.gainLossPercent.toFixed(1)}%)
                          </span>
                        </>
                      ) : '—'}
                    </td>
                  )}
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

function HistoryTab({ decrypt, fmtD, hideAmounts, currencies, displayCurrency, baseCurrency, snapshotPrompt, setSnapshotPrompt, doSaveSnapshot, snapshotSaving }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnap, setLoadingSnap] = useState(true);
  const [rateMode, setRateMode] = useState('current'); // 'current' | 'snapshot'
  const [historicalRatesCache, setHistoricalRatesCache] = useState({}); // date → rateMap
  const [loadingRates, setLoadingRates] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [expandedTypes, setExpandedTypes] = useState({});
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | specific type key

  // Build current rate map from live currencies
  const currentRateMap = useMemo(() => buildRateMap(currencies || []), [currencies]);

  const loadSnapshots = async () => {
    setLoadingSnap(true);
    try {
      const { data: resp } = await api.get('/snapshots.php');
      const raw = apiData({ data: resp }) || [];

      const decrypted = [];
      for (const s of raw) {
        if (!s.entries || s.entries.length === 0) continue;
        const entryBlobs = s.entries.map(e => e.encrypted_data);
        const decryptedEntries = await workerDispatcher.decryptBatch(entryBlobs, null);
        const entries = [];
        for (let j = 0; j < decryptedEntries.length; j++) {
          if (decryptedEntries[j]) {
            entries.push({ ...decryptedEntries[j], entry_id: s.entries[j].entry_id });
          }
        }
        decrypted.push({ ...s, _entries: entries });
      }
      setSnapshots(decrypted);
    } catch { /* silent */ }
    setLoadingSnap(false);
  };

  // Auto-load snapshots on mount
  useEffect(() => { loadSnapshots(); }, []);

  // Fetch historical rates for a specific date (cached)
  const fetchHistoricalRates = async (date) => {
    if (historicalRatesCache[date]) return historicalRatesCache[date];
    setLoadingRates(true);
    try {
      const { data: resp } = await api.get(`/reference.php?resource=historical-rates&date=${date}`);
      const ratesData = apiData({ data: resp });
      if (ratesData?.rates) {
        const rateMap = {};
        for (const [code, rate] of Object.entries(ratesData.rates)) {
          rateMap[code] = rate;
        }
        setHistoricalRatesCache(prev => ({ ...prev, [date]: rateMap }));
        setLoadingRates(false);
        return rateMap;
      }
    } catch { /* fallback to current */ }
    setLoadingRates(false);
    return null;
  };

  // Preload historical rates when switching to snapshot mode
  const handleRateModeChange = async (mode) => {
    setRateMode(mode);
    if (mode === 'snapshot') {
      const dates = [...new Set(snapshots.map(s => s.snapshot_date))];
      for (const date of dates) {
        if (!historicalRatesCache[date]) {
          await fetchHistoricalRates(date);
        }
      }
    }
  };

  // Compute summary for a v3 snapshot using recalculateSnapshot
  const getSnapshotSummary = (snapshot) => {
    if (!snapshot._entries || snapshot._entries.length === 0) return null;
    const rateMap = rateMode === 'snapshot'
      ? (historicalRatesCache[snapshot.snapshot_date] || currentRateMap)
      : currentRateMap;
    return recalculateSnapshot(snapshot._entries, rateMap, displayCurrency);
  };

  const hasSnapshots = snapshots.some(s => s._entries && s._entries.length > 0);

  // Hooks must be called unconditionally (before early returns)
  // Collect all unique asset types across v3 snapshots for filter
  const allTypeKeys = useMemo(() => {
    const types = new Map();
    for (const s of snapshots) {
      const summary = getSnapshotSummary(s);
      if (summary?.by_type) {
        for (const [key, val] of Object.entries(summary.by_type)) {
          if (!types.has(key)) types.set(key, val.label);
        }
      }
    }
    return types;
  }, [snapshots, rateMode, historicalRatesCache, displayCurrency]);

  // Build type breakdown chart data (stacked by type over time)
  const typeBreakdownData = useMemo(() => {
    if (!hasSnapshots) return [];
    return snapshots
      .filter(s => s._entries?.length > 0)
      .map(s => {
        const summary = getSnapshotSummary(s);
        if (!summary) return null;
        const row = { date: s.snapshot_date };
        for (const [key, val] of Object.entries(summary.by_type)) {
          row[key] = Math.abs(val.total);
        }
        return row;
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [snapshots, hasSnapshots, rateMode, historicalRatesCache, displayCurrency]);

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

  // Build chart data from v3 snapshots
  const chartData = snapshots
    .filter(s => s._entries?.length > 0)
    .map(s => {
      const summary = getSnapshotSummary(s);
      if (!summary) return null;
      if (typeFilter !== 'all') {
        const typeData = summary.by_type[typeFilter];
        return { date: s.snapshot_date, net_worth: typeData?.total || 0 };
      }
      return { date: s.snapshot_date, net_worth: summary.net_worth };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      {/* Controls bar — rate toggle + type filter */}
      {hasSnapshots && (
        <div className="card mb-4" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Rates:</span>
          <button
            className={`btn btn-sm ${rateMode === 'current' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => handleRateModeChange('current')}
          >
            Today's rates
          </button>
          <button
            className={`btn btn-sm ${rateMode === 'snapshot' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => handleRateModeChange('snapshot')}
            disabled={loadingRates}
          >
            {loadingRates ? 'Loading...' : 'Snapshot rates'}
          </button>
          {allTypeKeys.size > 1 && (
            <>
              <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8 }}>Filter:</span>
              <select
                className="form-control"
                style={{ width: 'auto', minWidth: 120, fontSize: 13, padding: '2px 24px 2px 8px' }}
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
              >
                <option value="all">All types</option>
                {[...allTypeKeys.entries()].map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {chartData.length >= 2 && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {typeFilter !== 'all' ? `${allTypeKeys.get(typeFilter) || typeFilter} Over Time` : 'Net Worth Over Time'}
          </h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={v => hideAmounts ? '***' : abbreviateNumber(v)} />
              <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
              <Line type="monotone" dataKey="net_worth" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name={typeFilter !== 'all' ? allTypeKeys.get(typeFilter) : 'Net Worth'} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Type breakdown chart — line chart showing each type over time */}
      {typeBreakdownData.length >= 2 && typeFilter === 'all' && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Asset Type Breakdown</h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={typeBreakdownData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={v => hideAmounts ? '***' : abbreviateNumber(v)} />
              <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {[...allTypeKeys.keys()].map((key, i) => (
                <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} name={allTypeKeys.get(key)} connectNulls />
              ))}
            </LineChart>
            {/* Stacked bar alternative:
            <BarChart data={typeBreakdownData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} tickFormatter={v => hideAmounts ? '***' : abbreviateNumber(v)} />
              <Tooltip content={<ChartTooltip hideAmounts={hideAmounts} />} />
              {[...allTypeKeys.keys()].map((key, i) => (
                <Bar key={key} dataKey={key} stackId="types" fill={CHART_COLORS[i % CHART_COLORS.length]} name={allTypeKeys.get(key)} />
              ))}
            </BarChart> */}
          </ResponsiveContainer>
        </div>
      )}

      <div className="card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>{typeFilter !== 'all' ? 'Total' : 'Net Worth'}</th>
                {typeFilter === 'all' && <th style={{ textAlign: 'right' }}>Assets</th>}
                {typeFilter === 'all' && <th style={{ textAlign: 'right' }}>Liabilities</th>}
                <th style={{ textAlign: 'right' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().map((s, i) => {
                // v3 split model — recalculate from entries
                const summary = getSnapshotSummary(s);
                if (!summary) return null;
                const filtered = typeFilter !== 'all';
                const typeData = filtered ? summary.by_type[typeFilter] : null;
                if (filtered && !typeData) return null;
                const displayTotal = filtered ? (typeData?.total || 0) : summary.net_worth;
                const displayCount = filtered ? (typeData?.count || 0) : summary.asset_count;
                return (
                  <tr key={i} style={{ cursor: 'pointer' }} onClick={() => { setSelectedSnapshot(s); setExpandedTypes({}); }}>
                    <td>{s.snapshot_date}</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(displayTotal)}</td>
                    {!filtered && <td style={{ textAlign: 'right' }}>{fmtD(summary.total_assets)}</td>}
                    {!filtered && <td style={{ textAlign: 'right' }}>{fmtD(summary.total_liabilities)}</td>}
                    <td style={{ textAlign: 'right' }}>{displayCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {/* Snapshot stale price prompt */}
      {snapshotPrompt && (
        <div className="modal-overlay" onClick={() => setSnapshotPrompt(null)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Fetched Prices Not Applied</h3>
              <button className="modal-close-btn" onClick={() => setSnapshotPrompt(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>You have {snapshotPrompt.staleCount} fetched price{snapshotPrompt.staleCount !== 1 ? 's' : ''} that haven't been applied to your entries yet.</span>
              </div>
              <p className="text-muted" style={{ fontSize: 13 }}>Snapshot will use the prices currently stored in your entries, not the recently fetched prices.</p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-outline" onClick={() => setSnapshotPrompt(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doSaveSnapshot} disabled={snapshotSaving}>
                {snapshotSaving ? 'Saving...' : 'Snapshot as-is'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Detail Modal */}
      <Modal isOpen={!!selectedSnapshot} onClose={() => setSelectedSnapshot(null)} title={`Snapshot — ${selectedSnapshot?.snapshot_date || ''}`} size="lg">
        {selectedSnapshot && (() => {
          const summary = getSnapshotSummary(selectedSnapshot);
          if (!summary) return <p className="text-muted">No entry data available for this snapshot.</p>;

          // Group entries by type
          const typeGroups = {};
          for (const entry of summary.entries) {
            const key = entry.template_name || entry.subtype || 'Other';
            if (!typeGroups[key]) typeGroups[key] = { label: key, entries: [], total: 0, isLiability: entry.is_liability };
            typeGroups[key].entries.push(entry);
            typeGroups[key].total += entry.displayValue || 0;
          }

          return (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
                {[
                  { label: 'Net Worth', value: summary.net_worth, color: 'var(--color-primary)' },
                  { label: 'Assets', value: summary.total_assets, color: 'var(--success)' },
                  { label: 'Liabilities', value: summary.total_liabilities, color: 'var(--danger)' },
                  { label: 'Entries', value: summary.asset_count, raw: true },
                ].map(c => (
                  <div key={c.label} style={{
                    background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 16px',
                    textAlign: 'center', border: '1px solid var(--border)',
                  }}>
                    <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>{c.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: c.color }}>
                      {c.raw ? c.value : (hideAmounts ? MASKED : fmtD(c.value))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Collapsible type sections */}
              {Object.entries(typeGroups).map(([key, group]) => {
                const isOpen = !!expandedTypes[key];
                return (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setExpandedTypes(prev => ({ ...prev, [key]: !prev[key] }))}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', borderRadius: 6, background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="font-medium">{group.label}</span>
                        <span className="text-muted" style={{ fontSize: 12 }}>({group.entries.length})</span>
                      </span>
                      <span style={{ fontWeight: 500, fontSize: 13, color: group.isLiability ? 'var(--danger)' : undefined }}>
                        {hideAmounts ? MASKED : fmtD(group.total)}
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: '4px 0 0 0' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Currency</th>
                              <th style={{ textAlign: 'right' }}>Value ({displayCurrency})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.entries.map((e, j) => (
                              <tr key={j}>
                                <td className="font-medium">{e.name}</td>
                                <td className="text-muted">{e.currency || '--'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 500, color: e.is_liability ? 'var(--danger)' : undefined }}>
                                  {hideAmounts ? MASKED : fmtD(e.displayValue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
      </Modal>
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
