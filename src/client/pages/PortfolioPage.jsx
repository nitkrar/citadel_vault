import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart as PieChartIcon, TrendingUp, List, Plus,
  DollarSign, Clock, Camera, Lock, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, Link2, Settings,
} from 'lucide-react';
import { Line as CJSLine, Bar as CJSBar, Doughnut as CJSDoughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Filler, Title, Tooltip as CJSTooltip, Legend as CJSLegend, TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import { useHideAmounts } from '../components/Layout';
import usePortfolioData from '../hooks/usePortfolioData';
import useVaultData from '../hooks/useVaultData';
import Modal from '../components/Modal';
import SegmentedControl from '../components/SegmentedControl';
import AssetsTab from '../components/portfolio/AssetsTab';
import useAppConfig from '../hooks/useAppConfig';
import api from '../api/client';
import { fmtCurrency, MASKED, apiData } from '../lib/checks';
import { buildRateMap, buildSymbolMap, recalculateSnapshot } from '../lib/portfolioAggregator';
import * as workerDispatcher from '../lib/workerDispatcher';
import { hasAnyIntegration, getIntegration, getIntegrationType } from '../integrations/helpers';
import { getProvider } from '../integrations/modules';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Title, CJSTooltip, CJSLegend, TimeScale);

const TYPE_COLORS = {
  cash:            '#00C4B4',  // cyan-teal
  stock:           '#F5A623',  // warm amber
  cash_equivalent: '#4FC3F7',  // cornflower sky
  real_estate:     '#BA68C8',  // soft violet
  crypto:          '#5C6BC0',  // periwinkle indigo
  bond:            '#F4845F',  // warm coral
  vehicle:         '#CFD8DC',  // light blue-grey (rare, muted)
  asset:           '#78909C',  // mid blue-grey (neutral fallback)
};
const EXTRA_COLORS = ['#00897B', '#FFB300', '#29B6F6', '#AB47BC', '#7E57C2', '#FF7043'];
function getTypeColor(typeKey) {
  if (TYPE_COLORS[typeKey]) return TYPE_COLORS[typeKey];
  let hash = 0;
  for (let i = 0; i < typeKey.length; i++) hash = ((hash << 5) - hash + typeKey.charCodeAt(i)) | 0;
  return EXTRA_COLORS[Math.abs(hash) % EXTRA_COLORS.length];
}

const CHART_COLORS = ['#00C4B4', '#F5A623', '#4FC3F7', '#BA68C8', '#5C6BC0', '#F4845F', '#00897B', '#FFB300'];
const NET_WORTH_COLOR = '#3B82F6';   // hero line — bold electric blue
const POSITIVE_COLOR  = '#3B9EFF';  // gains — bright blue (NOT green)
const NEGATIVE_COLOR  = '#E8A838';  // losses — golden amber (NOT red)

const TABS = [
  { key: 'overview',    label: 'Overview',    icon: PieChartIcon },
  { key: 'assets',      label: 'Assets',      icon: List },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
];

// Migration map for old sessionStorage tab keys
const TAB_MIGRATION = { country: 'assets', account: 'assets', type: 'assets', currencies: 'assets', history: 'performance' };

export default function PortfolioPage() {
  const { isUnlocked, decrypt, encrypt } = useEncryption();
  const { entries: vaultEntries, decryptedCache } = useVaultEntries();
  const { hideAmounts } = useHideAmounts();
  const {
    portfolio, loading, error, refetch,
    displayCurrency, setDisplayCurrency, baseCurrency, currencies,
    ratesLastUpdated, refreshPrices,
  } = usePortfolioData();

  const [activeTab, setActiveTab] = useState(() => {
    const saved = sessionStorage.getItem('pv_portfolio_last_tab') || 'overview';
    return TAB_MIGRATION[saved] || saved;
  });
  const [assetsGroupBy, setAssetsGroupBy] = useState(() => sessionStorage.getItem('pv_portfolio_assets_group') || 'none');
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
        country: asset.country || null,
        linked_account: asset.linked_account_id
          ? { id: asset.linked_account_id, name: portfolio.accounts?.[asset.linked_account_id]?.name || 'Unknown Account' }
          : null,
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
        <div style={{ marginBottom: 24 }}>
          <div className="skeleton skeleton-text" style={{ width: 200, height: 20, marginBottom: 8 }} />
          <div className="skeleton skeleton-text" style={{ width: 300, height: 14 }} />
        </div>
        <div className="portfolio-summary-grid">
          {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-card" />)}
        </div>
        <div className="portfolio-chart-grid">
          <div className="skeleton skeleton-chart" />
          <div className="skeleton skeleton-chart" />
        </div>
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
      {isEmpty && activeTab !== 'performance' ? (
        <div className="empty-state">
          <TrendingUp size={40} className="empty-icon" />
          <h3>No assets yet</h3>
          <p>Add asset entries in the Vault to build your portfolio.</p>
          <Link to="/vault" className="btn btn-primary mt-3"><Plus size={16} /> Add Asset</Link>
        </div>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewTab portfolio={p} fmtD={fmtD} hideAmounts={hideAmounts} refreshResult={refreshResult} />}
          {activeTab === 'assets' && <AssetsTab portfolio={p} fmtD={fmtD} groupBy={assetsGroupBy} setGroupBy={setAssetsGroupBy} expandedGroups={expandedGroups} toggleGroup={toggleGroup} />}
          {activeTab === 'performance' && <PerformanceTab decrypt={decrypt} encrypt={encrypt} fmtD={fmtD} hideAmounts={hideAmounts} currencies={currencies} displayCurrency={displayCurrency} baseCurrency={baseCurrency} snapshotPrompt={snapshotPrompt} setSnapshotPrompt={setSnapshotPrompt} doSaveSnapshot={doSaveSnapshot} snapshotSaving={snapshotSaving} decryptedCache={decryptedCache} portfolio={portfolio} />}
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
      .map(([key, data]) => ({ key, name: data.label, value: Math.abs(data.total) }))
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

  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#6b7280';
  const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#e5e7eb';
  const legendPosition = window.innerWidth >= 768 ? 'right' : 'bottom';

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
        <div className="portfolio-chart-grid">
          {countryChartData.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>By Country</h4>
              <div style={{ minHeight: 220 }}>
                <CJSDoughnut
                  data={{
                    labels: countryChartData.map(d => d.name),
                    datasets: [{
                      data: countryChartData.map(d => d.value),
                      backgroundColor: countryChartData.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                      borderWidth: 0,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '55%',
                    plugins: {
                      legend: { position: legendPosition, labels: { color: textColor, font: { size: 11 }, usePointStyle: true, padding: 8 } },
                      tooltip: {
                        callbacks: {
                          label: ctx => hideAmounts ? MASKED : fmtCurrency(ctx.parsed),
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          )}
          {typeChartData.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>By Asset Type</h4>
              <div style={{ minHeight: 220 }}>
                <CJSDoughnut
                  data={{
                    labels: typeChartData.map(d => d.name),
                    datasets: [{
                      data: typeChartData.map(d => d.value),
                      backgroundColor: typeChartData.map(d => getTypeColor(d.key)),
                      borderWidth: 0,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '55%',
                    plugins: {
                      legend: { position: legendPosition, labels: { color: textColor, font: { size: 11 }, usePointStyle: true, padding: 8 } },
                      tooltip: {
                        callbacks: {
                          label: ctx => hideAmounts ? MASKED : fmtCurrency(ctx.parsed),
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {barChartData.length > 1 && (
        <div className="card mt-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Value by Country</h4>
          <div style={{ height: 250 }}>
            <CJSBar
              data={{
                labels: barChartData.map(d => d.name),
                datasets: [{
                  label: 'Total',
                  data: barChartData.map(d => d.total),
                  backgroundColor: CHART_COLORS[0],
                  borderRadius: 4,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { grid: { color: borderColor }, ticks: { color: textColor, font: { size: 12 } } },
                  y: { grid: { color: borderColor }, ticks: { color: textColor, font: { size: 12 }, callback: v => hideAmounts ? '***' : abbreviateNumber(v) } },
                },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: ctx => hideAmounts ? MASKED : fmtCurrency(ctx.parsed.y),
                    },
                  },
                },
              }}
            />
          </div>
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

// (GroupTab, TypeTab, AllAssetsTab, CurrencyTab moved to components/portfolio/AssetsTab.jsx)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// History Tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getGroupTotals(summary, breakdown) {
  if (breakdown === 'type') return summary.by_type;
  if (breakdown === 'country') return summary.by_country;
  if (breakdown === 'account') return summary.by_account;
  if (breakdown === 'currency') return summary.by_currency;
  if (breakdown === 'asset') {
    const byAsset = {};
    for (const e of (summary.entries || [])) {
      const key = String(e.entry_id);
      if (!key || key === 'undefined') continue;
      if (!byAsset[key]) byAsset[key] = { total: 0, count: 0, label: e.name || 'Unnamed' };
      byAsset[key].total += e.displayValue;
      byAsset[key].count++;
    }
    return byAsset;
  }
  return {};
}

function getBreakdownColor(key, breakdown, index) {
  if (breakdown === 'type') return getTypeColor(key);
  return CHART_COLORS[index % CHART_COLORS.length];
}

function PerformanceTab({ decrypt, fmtD, hideAmounts, currencies, displayCurrency, baseCurrency, snapshotPrompt, setSnapshotPrompt, doSaveSnapshot, snapshotSaving, decryptedCache, portfolio }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnap, setLoadingSnap] = useState(true);
  const [rateMode, setRateMode] = useState('current'); // 'current' | 'snapshot'
  const [historicalRatesCache, setHistoricalRatesCache] = useState({}); // date → rateMap
  const [loadingRates, setLoadingRates] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [expandedTypes, setExpandedTypes] = useState({});
  const [groupFilter, setGroupFilter] = useState('all'); // 'all' | specific group key
  const [breakdown, setBreakdown] = useState(() => sessionStorage.getItem('pv_portfolio_breakdown') || 'type');
  const [dateRange, setDateRange] = useState('all'); // 'all' | '3m' | '6m' | '1y' | 'ytd'
  const [showPercent, setShowPercent] = useState(false);
  const [tableExpanded, setTableExpanded] = useState(false);
  const [showRateSettings, setShowRateSettings] = useState(false);

  // Build current rate map from live currencies
  const currentRateMap = useMemo(() => buildRateMap(currencies || []), [currencies]);

  // Build currency symbol map
  const symbolMap = useMemo(() => buildSymbolMap(currencies || []), [currencies]);

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
        // Backfill old entries missing country/linked_account.
        // If the vault entry has been deleted since the snapshot was taken,
        // decryptedCache lookup returns undefined — entry gets country=null
        // and linked_account=null, which maps to "Unknown" country and
        // "Not linked to an account" in the breakdown charts.
        for (const entry of entries) {
          if (entry.country === undefined || entry.linked_account === undefined) {
            const vaultEntry = decryptedCache?.[entry.entry_id];
            if (vaultEntry) {
              if (entry.country === undefined) entry.country = vaultEntry.country || null;
              if (entry.linked_account === undefined) {
                const acctId = vaultEntry.linked_account_id;
                entry.linked_account = acctId
                  ? { id: acctId, name: portfolio?.accounts?.[acctId]?.name || 'Unknown Account' }
                  : null;
              }
            } else {
              // Vault entry deleted — set explicit nulls
              if (entry.country === undefined) entry.country = null;
              if (entry.linked_account === undefined) entry.linked_account = null;
            }
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

  // ── All useMemo hooks BEFORE early returns (React Rules of Hooks) ──

  // Filter snapshots by date range
  const filteredSnapshots = useMemo(() => {
    if (dateRange === 'all') return snapshots;
    const now = new Date();
    let cutoff;
    if (dateRange === '3m') { cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 3); }
    else if (dateRange === '6m') { cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 6); }
    else if (dateRange === '1y') { cutoff = new Date(now); cutoff.setFullYear(cutoff.getFullYear() - 1); }
    else if (dateRange === 'ytd') { cutoff = new Date(now.getFullYear(), 0, 1); }
    if (!cutoff) return snapshots;
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return snapshots.filter(s => s.snapshot_date >= cutoffStr);
  }, [snapshots, dateRange]);

  // Single useMemo for all snapshot summaries — all chart data derives from this
  const snapshotSummaryMap = useMemo(() => {
    const map = new Map();
    for (let idx = 0; idx < filteredSnapshots.length; idx++) {
      const snap = filteredSnapshots[idx];
      if (!snap._entries || snap._entries.length === 0) continue;
      const snapRateMap = rateMode === 'snapshot'
        ? (historicalRatesCache[snap.snapshot_date] || currentRateMap)
        : currentRateMap;
      const summary = recalculateSnapshot(snap._entries, snapRateMap, displayCurrency);
      map.set(snap.id ?? idx, { date: snap.snapshot_date, ...summary });
    }
    return map;
  }, [filteredSnapshots, rateMode, historicalRatesCache, currentRateMap, displayCurrency]);

  // Collect all unique group keys with labels from snapshotSummaryMap
  const allGroupKeys = useMemo(() => {
    const keys = new Map();
    for (const summary of snapshotSummaryMap.values()) {
      let source;
      if (breakdown === 'type') source = summary.by_type;
      else if (breakdown === 'country') source = summary.by_country;
      else if (breakdown === 'account') source = summary.by_account;
      else if (breakdown === 'currency') source = summary.by_currency;
      else if (breakdown === 'asset') {
        for (const e of (summary.entries || [])) {
          if (e.entry_id && !keys.has(String(e.entry_id))) {
            keys.set(String(e.entry_id), e.name || 'Unnamed');
          }
        }
        continue;
      }
      if (source) {
        for (const [key, val] of Object.entries(source)) {
          if (!keys.has(key)) keys.set(key, val.label || key);
        }
      }
    }
    return keys;
  }, [snapshotSummaryMap, breakdown]);

  // Chart data: date + netWorth + byGroup totals per snapshot
  const chartData = useMemo(() =>
    [...snapshotSummaryMap.values()].map(s => ({
      date: s.date,
      netWorth: s.net_worth,
      byGroup: Object.fromEntries(
        Object.entries(getGroupTotals(s, breakdown)).map(([k, v]) => [k, v.total])
      ),
    })).sort((a, b) => a.date.localeCompare(b.date)),
  [snapshotSummaryMap, breakdown]);

  // Percentage data: each group as % of sum of absolute group totals
  const percentageData = useMemo(() =>
    [...snapshotSummaryMap.values()].map(s => {
      const groups = getGroupTotals(s, breakdown);
      const absSum = Object.values(groups).reduce((acc, g) => acc + Math.abs(g.total), 0);
      if (absSum === 0) return { date: s.date, groups: {} };
      return {
        date: s.date,
        groups: Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [k, (Math.abs(v.total) / absSum) * 100])
        ),
      };
    }).sort((a, b) => a.date.localeCompare(b.date)),
  [snapshotSummaryMap, breakdown]);

  // Delta data: consecutive diffs per group — absolute + percentage (first snapshot omitted)
  const deltaData = useMemo(() => {
    const data = [...snapshotSummaryMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return data.slice(1).map((s, i) => {
      const prev = data[i];
      const delta = s.net_worth - prev.net_worth;
      const pctDelta = prev.net_worth !== 0 ? (delta / Math.abs(prev.net_worth)) * 100 : 0;
      // Per-group deltas for breakdown-aware bar chart
      const currGroups = getGroupTotals(s, breakdown);
      const prevGroups = getGroupTotals(prev, breakdown);
      const byGroup = {};
      for (const key of new Set([...Object.keys(currGroups), ...Object.keys(prevGroups)])) {
        const curr = currGroups[key]?.total || 0;
        const prv = prevGroups[key]?.total || 0;
        byGroup[key] = { delta: curr - prv, pctDelta: prv !== 0 ? ((curr - prv) / Math.abs(prv)) * 100 : 0 };
      }
      return { date: s.date, delta, pctDelta, byGroup };
    });
  }, [snapshotSummaryMap, breakdown]);

  // ── Early returns (after all hooks) ──

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

  // ── Chart.js options (read CSS vars for dark mode) ──
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim() || '#6b7280';
  const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#e5e7eb';

  // Determine which group keys to show in hero chart
  const visibleGroupKeys = groupFilter === 'all'
    ? [...allGroupKeys.keys()]
    : allGroupKeys.has(groupFilter) ? [groupFilter] : [];

  // Hero line chart datasets (normal mode)
  const heroLineData = {
    labels: chartData.map(d => d.date),
    datasets: [
      ...(groupFilter === 'all' ? [{
        label: 'Net Worth',
        data: chartData.map(d => d.netWorth),
        borderColor: NET_WORTH_COLOR,
        backgroundColor: NET_WORTH_COLOR + '33',
        borderWidth: 3,
        pointRadius: 4,
        tension: 0.3,
        fill: false,
        order: 0,
      }] : []),
      ...visibleGroupKeys.map((key, idx) => ({
        label: allGroupKeys.get(key) || key,
        data: chartData.map(d => d.byGroup[key] || 0),
        borderColor: getBreakdownColor(key, breakdown, idx),
        backgroundColor: getBreakdownColor(key, breakdown, idx) + '33',
        borderWidth: 1.5,
        pointRadius: 3,
        tension: 0.3,
        fill: false,
        order: idx + 1,
      })),
    ],
  };

  // Hero stacked area datasets (percent mode)
  const heroPercentData = {
    labels: percentageData.map(d => d.date),
    datasets: visibleGroupKeys.map((key, idx) => ({
      label: allGroupKeys.get(key) || key,
      data: percentageData.map(d => d.groups[key] || 0),
      borderColor: getBreakdownColor(key, breakdown, idx),
      backgroundColor: getBreakdownColor(key, breakdown, idx) + '99',
      borderWidth: 1.5,
      pointRadius: 3,
      tension: 0.3,
      fill: true,
      order: idx + 1,
    })),
  };

  const heroOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day', tooltipFormat: 'MMM d, yyyy' },
        grid: { color: borderColor },
        ticks: { color: textColor, font: { size: 12 } },
      },
      y: {
        stacked: showPercent || undefined,
        ...(showPercent ? { max: 100 } : {}),
        grid: { color: borderColor },
        ticks: {
          color: textColor,
          font: { size: 12 },
          callback: v => hideAmounts ? '***' : showPercent ? v.toFixed(0) + '%' : abbreviateNumber(v),
        },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: textColor, font: { size: 12 }, usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          label: ctx => hideAmounts
            ? `${ctx.dataset.label}: ${MASKED}`
            : showPercent
              ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
              : `${ctx.dataset.label}: ${fmtCurrency(ctx.parsed.y)}`,
        },
      },
    },
  };

  // Delta bar chart — per-group bars when breakdown active, or single net worth bar
  const deltaChartData = {
    labels: deltaData.map(d => d.date),
    datasets: visibleGroupKeys.length > 0 && groupFilter !== 'all'
      // Single filtered group — one dataset
      ? [{
          label: allGroupKeys.get(groupFilter) || groupFilter,
          data: deltaData.map(d => {
            const g = d.byGroup[groupFilter];
            return showPercent ? (g?.pctDelta || 0) : (g?.delta || 0);
          }),
          backgroundColor: deltaData.map(d => {
            const v = showPercent ? (d.byGroup[groupFilter]?.pctDelta || 0) : (d.byGroup[groupFilter]?.delta || 0);
            return v >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR;
          }),
          borderRadius: 4,
        }]
      // All groups — stacked bars per group
      : visibleGroupKeys.length > 1
        ? visibleGroupKeys.map((key, idx) => ({
            label: allGroupKeys.get(key) || key,
            data: deltaData.map(d => {
              const g = d.byGroup[key];
              return showPercent ? (g?.pctDelta || 0) : (g?.delta || 0);
            }),
            backgroundColor: getBreakdownColor(key, breakdown, idx),
            borderRadius: 2,
            stack: 'delta',
          }))
        // Fallback: single net worth bar (no breakdown or only 1 group)
        : [{
            label: showPercent ? '% Change' : 'Period Change',
            data: deltaData.map(d => showPercent ? d.pctDelta : d.delta),
            backgroundColor: deltaData.map(d => (showPercent ? d.pctDelta : d.delta) >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR),
            borderRadius: 4,
          }],
  };

  const deltaOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day', tooltipFormat: 'MMM d, yyyy' },
        grid: { color: borderColor },
        ticks: { color: textColor, font: { size: 12 } },
      },
      y: {
        grid: { color: borderColor },
        ticks: {
          color: textColor,
          font: { size: 12 },
          callback: v => hideAmounts ? '***' : showPercent ? v.toFixed(1) + '%' : abbreviateNumber(v),
        },
      },
    },
    plugins: {
      legend: { display: visibleGroupKeys.length > 1, position: 'bottom', labels: { color: textColor, font: { size: 11 }, usePointStyle: true } },
      tooltip: {
        callbacks: {
          label: ctx => hideAmounts
            ? `${ctx.dataset.label}: ${MASKED}`
            : showPercent
              ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
              : `${ctx.dataset.label}: ${fmtCurrency(ctx.parsed.y)}`,
        },
      },
    },
  };

  const currencyToggleLabel = symbolMap[displayCurrency] || displayCurrency;

  return (
    <>
      {/* Zone 1 — Toolbar (streamlined) */}
      <div className="card mb-4" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Breakdown dropdown */}
        <span style={{ fontSize: 13, fontWeight: 600 }}>Breakdown:</span>
        <select
          className="form-control"
          style={{ width: 'auto', minWidth: 140, fontSize: 13 }}
          value={breakdown}
          onChange={e => {
            const val = e.target.value;
            setBreakdown(val);
            setGroupFilter('all');
            sessionStorage.setItem('pv_portfolio_breakdown', val);
          }}
        >
          <option value="type">By Type</option>
          <option value="country">By Country</option>
          <option value="account">By Account</option>
          <option value="currency">By Currency</option>
          <option value="asset">By Asset</option>
        </select>

        {/* Group filter dropdown */}
        {allGroupKeys.size > 1 && (
          <>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Filter:</span>
            <select
              className="form-control"
              style={{ width: 'auto', minWidth: 120, fontSize: 13, padding: '2px 24px 2px 8px' }}
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
            >
              <option value="all">All</option>
              {[...allGroupKeys.entries()].map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </>
        )}

        {/* View mode toggle */}
        <SegmentedControl
          options={[{ value: 'values', label: 'Values' }, { value: 'percent', label: '% Allocation' }]}
          value={showPercent ? 'percent' : 'values'}
          onChange={v => setShowPercent(v === 'percent')}
        />

        {/* Rate mode — gear icon popover */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowRateSettings(prev => !prev)} title="Rate settings">
            <Settings size={16} />
          </button>
          {showRateSettings && (
            <div className="card" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, padding: '10px 14px', zIndex: 20, minWidth: 180, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Rate Mode</span>
              <SegmentedControl
                options={[{ value: 'current', label: 'Current' }, { value: 'snapshot', label: loadingRates ? 'Loading...' : 'Snapshot' }]}
                value={rateMode}
                onChange={v => { handleRateModeChange(v); setShowRateSettings(false); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Zone 2 — Hero Chart (with date range inside) */}
      {chartData.length >= 1 && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              {showPercent
                ? 'Allocation Over Time'
                : groupFilter !== 'all' ? `${allGroupKeys.get(groupFilter) || groupFilter} Over Time` : 'Portfolio Over Time'}
            </h4>
            <SegmentedControl
              options={[
                { value: 'all', label: 'All' },
                { value: '3m', label: '3M' },
                { value: '6m', label: '6M' },
                { value: '1y', label: '1Y' },
                { value: 'ytd', label: 'YTD' },
              ]}
              value={dateRange}
              onChange={setDateRange}
            />
          </div>
          <div style={{ minHeight: 300, height: '40vh', maxHeight: 500 }}>
            <CJSLine
              data={showPercent ? heroPercentData : heroLineData}
              options={heroOptions}
            />
          </div>
        </div>
      )}

      {/* Zone 3 — Delta Bar Chart */}
      {deltaData.length > 0 && (
        <div className="card mb-4" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{showPercent ? '% Change Between Snapshots' : 'Period Change'}</h4>
          <div style={{ height: 250 }}>
            <CJSBar data={deltaChartData} options={deltaOptions} />
          </div>
        </div>
      )}

      {/* Zone 4 — Collapsible Snapshot Table */}
      <div className="card">
        <div
          style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setTableExpanded(e => !e)}
        >
          {tableExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Snapshots ({[...snapshotSummaryMap.values()].length})
          </span>
        </div>
        {tableExpanded && (
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
                {[...filteredSnapshots].reverse().map((s, i) => {
                  const snapKey = s.id ?? (filteredSnapshots.length - 1 - i);
                  const summary = snapshotSummaryMap.get(snapKey);
                  if (!summary) return null;
                  return (
                    <tr key={snapKey} style={{ cursor: 'pointer' }} onClick={() => { setSelectedSnapshot(s); setExpandedTypes({}); }}>
                      <td>{s.snapshot_date}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(summary.net_worth)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtD(summary.total_assets)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtD(summary.total_liabilities)}</td>
                      <td style={{ textAlign: 'right' }}>{summary.asset_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
