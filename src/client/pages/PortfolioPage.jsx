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
import { buildRateMap, recalculateSnapshot } from '../lib/portfolioAggregator';

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

  // ── Save snapshot (split model v3) ──────────────────────────────
  const handleSaveSnapshot = async () => {
    if (!portfolio) return;
    setSnapshotSaving(true);
    try {
      // Encrypt metadata header
      const meta = {
        base_currency: baseCurrency,
        date: new Date().toISOString(),
      };
      const encryptedMeta = await encrypt(meta);

      // Encrypt each asset entry individually
      const entries = [];
      for (const asset of portfolio.assets) {
        const entryBlob = {
          name: asset.name,
          template_name: asset.template_name,
          subtype: asset.subtype,
          is_liability: asset.is_liability,
          currency: asset.currency,
          raw_value: asset.rawValue,
          icon: asset.icon,
        };
        const encryptedEntry = await encrypt(entryBlob);
        entries.push({
          entry_id: asset.id,
          encrypted_data: encryptedEntry,
        });
      }

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
          {activeTab === 'history' && <HistoryTab decrypt={decrypt} encrypt={encrypt} fmtD={fmtD} hideAmounts={hideAmounts} currencies={currencies} displayCurrency={displayCurrency} baseCurrency={baseCurrency} />}
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

function HistoryTab({ decrypt, fmtD, hideAmounts, currencies, displayCurrency, baseCurrency }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rateMode, setRateMode] = useState('current'); // 'current' | 'snapshot'
  const [historicalRatesCache, setHistoricalRatesCache] = useState({}); // date → rateMap
  const [loadingRates, setLoadingRates] = useState(false);

  // Build current rate map from live currencies
  const currentRateMap = useMemo(() => buildRateMap(currencies || []), [currencies]);

  const loadSnapshots = async () => {
    setLoadingSnap(true);
    try {
      const { data: resp } = await api.get('/snapshots.php');
      const raw = apiData({ data: resp }) || [];
      const decrypted = [];
      for (const s of raw) {
        try {
          // Decrypt meta blob
          const meta = await decrypt(s.data || s.encrypted_data);

          // Decrypt per-entry blobs if present (v3 split model)
          let entries = null;
          if (s.entries && s.entries.length > 0) {
            entries = [];
            for (const e of s.entries) {
              try {
                const d = await decrypt(e.encrypted_data);
                entries.push({ ...d, entry_id: e.entry_id });
              } catch {
                // skip entries that fail to decrypt
              }
            }
          }

          decrypted.push({ ...s, _meta: meta, _entries: entries });
        } catch {
          decrypted.push({ ...s, _meta: null, _entries: null });
        }
      }
      setSnapshots(decrypted);
    } catch { /* silent */ }
    setLoadingSnap(false);
    setLoaded(true);
  };

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

  // Check if any snapshot has entries (v3)
  const hasV3Snapshots = snapshots.some(s => s._entries && s._entries.length > 0);

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

  // Build chart data — use recalculateSnapshot for v3, fallback for legacy
  const chartData = snapshots
    .filter(s => s._meta || s._entries)
    .map(s => {
      const summary = getSnapshotSummary(s);
      if (summary) {
        return { date: s.snapshot_date, net_worth: summary.net_worth };
      }
      // Legacy v2 fallback
      const d = s._meta;
      if (!d) return null;
      return {
        date: s.snapshot_date,
        net_worth: d.net_worth ?? d.total ?? (d.assets + (d.accounts || 0)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      {/* Rate toggle — only show if v3 snapshots exist */}
      {hasV3Snapshots && (
        <div className="card mb-4" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
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
        </div>
      )}

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
                // v3 split model — recalculate from entries
                const summary = getSnapshotSummary(s);
                if (summary) {
                  return (
                    <tr key={i}>
                      <td>{s.snapshot_date}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(summary.net_worth)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtD(summary.total_assets)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtD(summary.total_liabilities)}</td>
                      <td style={{ textAlign: 'right' }}>{summary.asset_count}</td>
                    </tr>
                  );
                }

                // Legacy v2/v1 fallback
                const d = s._meta;
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
