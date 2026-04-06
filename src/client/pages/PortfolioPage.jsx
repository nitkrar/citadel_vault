import { useState, useMemo, useCallback, useEffect } from 'react';
import SaveToast from '../components/SaveToast';
import useRefreshPrices from '../hooks/useRefreshPrices';
import useLayoutMode from '../hooks/useLayoutMode';
import { Link } from 'react-router-dom';
import {
  PieChart as PieChartIcon, TrendingUp, List, Plus,
  Camera, Lock, AlertTriangle, RefreshCw, MoreVertical,
} from 'lucide-react';
import { Bar as CJSBar, Doughnut as CJSDoughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Filler, Title, Tooltip as CJSTooltip, Legend as CJSLegend, TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import { useHideAmounts } from '../components/Layout';
import usePortfolioData from '../hooks/usePortfolioData';
import AssetsTab from '../components/portfolio/AssetsTab';
import PerformanceTab from '../components/portfolio/PerformanceTab';
import useAppConfig from '../hooks/useAppConfig';
import useCountries from '../hooks/useCountries';
import api from '../api/client';
import { fmtCurrency, MASKED } from '../lib/checks';
import * as workerDispatcher from '../lib/workerDispatcher';
import { AAD_SNAPSHOT_META, AAD_SNAPSHOT_ENTRY } from '../lib/crypto';
import { hasAnyIntegration, getIntegration, getIntegrationType } from '../integrations/helpers';
import { CHART_COLORS, getTypeColor, abbreviateNumber } from '../lib/chartColors';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Title, CJSTooltip, CJSLegend, TimeScale);

const TABS = [
  { key: 'overview',    label: 'Overview',    icon: PieChartIcon },
  { key: 'assets',      label: 'Assets',      icon: List },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
];

// Migration map for old sessionStorage tab keys
const TAB_MIGRATION = { country: 'assets', account: 'assets', type: 'assets', currencies: 'assets', history: 'performance' };

export default function PortfolioPage() {
  const { isUnlocked, decrypt, encrypt, decryptWithFallback } = useEncryption();
  const { decryptedCache } = useVaultEntries();
  const { hideAmounts } = useHideAmounts();
  const {
    portfolio, loading, error, refetch,
    displayCurrency, setDisplayCurrency, baseCurrency, currencies,
    ratesLastUpdated,
  } = usePortfolioData();
  const { handleRefreshAll, refreshing, refreshToast, clearRefreshToast } = useRefreshPrices();
  const { countries } = useCountries();
  const { isMobile } = useLayoutMode();

  const [activeTab, setActiveTab] = useState(() => {
    const saved = sessionStorage.getItem('pv_portfolio_last_tab') || 'overview';
    return TAB_MIGRATION[saved] || saved;
  });
  const [assetsGroupBy, setAssetsGroupBy] = useState(() => sessionStorage.getItem('pv_portfolio_assets_group') || 'none');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotPrompt, setSnapshotPrompt] = useState(null); // { staleCount }
  const { config } = useAppConfig();
  const plaidEnabled = config?.plaid_enabled === 'true';

  // Mobile overflow menus
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showActionOverflow, setShowActionOverflow] = useState(false);

  // Plaid item IDs for the Refresh All handler
  const plaidEntries = useMemo(() => {
    if (!portfolio?.assets) return [];
    return portfolio.assets.filter(a => hasAnyIntegration(a));
  }, [portfolio]);

  const plaidItemIds = useMemo(
    () => plaidEnabled ? [...new Set(plaidEntries.map(e => getIntegration(e, getIntegrationType(e))?.item_id).filter(Boolean))] : [],
    [plaidEnabled, plaidEntries]
  );

  // Mobile header events
  useEffect(() => {
    const handleCurrencyToggle = () => setShowCurrencyPicker(v => !v);
    window.addEventListener('vault:currency-toggle', handleCurrencyToggle);
    return () => window.removeEventListener('vault:currency-toggle', handleCurrencyToggle);
  }, []);

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
  const doSaveSnapshot = async () => {
    if (!portfolio) return;
    setSnapshotSaving(true);
    setSnapshotPrompt(null);
    try {
      const meta = {
        base_currency: baseCurrency,
        date: new Date().toISOString(),
      };
      const encryptedMeta = await encrypt(meta, AAD_SNAPSHOT_META);

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
      const encryptedBlobs = await workerDispatcher.encryptBatch(entryBlobs, null, AAD_SNAPSHOT_ENTRY);
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
      {isMobile ? (
        <>
          {/* Mobile: currency picker dropdown (triggered from header icon) */}
          {showCurrencyPicker && currencies && currencies.length > 0 && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 900 }} onClick={() => setShowCurrencyPicker(false)} />
              <div style={{
                position: 'fixed', right: 16, top: 'calc(56px + env(safe-area-inset-top) + 4px)', zIndex: 901,
                background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 140, overflow: 'hidden',
              }}>
                {currencies.filter(c => c.is_active === 1 || c.is_active === '1' || c.is_active === true).map(c => (
                  <button key={c.code} className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px',
                      background: displayCurrency === c.code ? 'var(--hover-bg)' : undefined }}
                    onClick={() => { setDisplayCurrency(c.code); setShowCurrencyPicker(false); }}>
                    {c.symbol} {c.code}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Mobile: tabs row + snapshot overflow */}
          <div className="flex gap-2 mb-4" style={{ flexWrap: 'nowrap', alignItems: 'center', overflow: 'hidden' }}>
            {TABS.map(t => (
              <button key={t.key}
                className={`btn btn-sm ${activeTab === t.key ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap' }}
                onClick={() => { setActiveTab(t.key); sessionStorage.setItem('pv_portfolio_last_tab', t.key); }}>
                <t.icon size={14} /> {t.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {/* Overflow menu — Snapshot */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowActionOverflow(v => !v)} aria-label="More actions">
                <MoreVertical size={18} />
              </button>
              {showActionOverflow && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 900 }} onClick={() => setShowActionOverflow(false)} />
                  <div style={{
                    position: 'fixed', right: 16, zIndex: 901,
                    background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 180, overflow: 'hidden',
                  }}>
                    <button className="btn btn-ghost btn-sm"
                      style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px' }}
                      disabled={refreshing || isEmpty}
                      onClick={() => { handleRefreshAll(plaidItemIds); setShowActionOverflow(false); }}>
                      <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh All'}
                    </button>
                    <button className="btn btn-ghost btn-sm"
                      style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px' }}
                      disabled={snapshotSaving || isEmpty}
                      onClick={() => { handleSaveSnapshot(); setShowActionOverflow(false); }}>
                      <Camera size={14} /> {snapshotSaving ? 'Saving...' : 'Snapshot'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Desktop: full page header */}
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
              <button className="btn btn-secondary" onClick={() => handleRefreshAll(plaidItemIds)} disabled={refreshing || isEmpty}>
                <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing...' : 'Refresh All'}
              </button>
              <button className="btn btn-primary" onClick={handleSaveSnapshot} disabled={snapshotSaving || isEmpty}>
                <Camera size={16} /> {snapshotSaving ? 'Saving...' : 'Snapshot'}
              </button>
            </div>
          </div>

          {/* Desktop: tabs */}
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
        </>
      )}

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
          {activeTab === 'overview' && <OverviewTab portfolio={p} fmtD={fmtD} hideAmounts={hideAmounts} />}
          {activeTab === 'assets' && <AssetsTab portfolio={p} fmtD={fmtD} groupBy={assetsGroupBy} setGroupBy={setAssetsGroupBy} expandedGroups={expandedGroups} toggleGroup={toggleGroup} />}
          {activeTab === 'performance' && <PerformanceTab decrypt={decrypt} fmtD={fmtD} hideAmounts={hideAmounts} currencies={currencies} countries={countries} displayCurrency={displayCurrency} baseCurrency={baseCurrency} snapshotPrompt={snapshotPrompt} setSnapshotPrompt={setSnapshotPrompt} doSaveSnapshot={doSaveSnapshot} snapshotSaving={snapshotSaving} decryptedCache={decryptedCache} portfolio={portfolio} isMobile={isMobile} />}
        </>
      )}
      {refreshToast && (
        <SaveToast key={refreshToast.key} message={refreshToast.message} type={refreshToast.type} onDismiss={clearRefreshToast} />
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
