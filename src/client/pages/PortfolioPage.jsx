import { useState, useMemo, useCallback } from 'react';
import api from '../api/client';
import { useHideAmounts } from '../components/Layout';
import { useEncryption } from '../contexts/EncryptionContext';
import { isTruthy } from '../lib/checks';
import useVaultData from '../hooks/useVaultData';
import useSelection from '../hooks/useSelection';
import AssetDetailModal from '../components/AssetDetailModal';
import BulkEditModal from '../components/BulkEditModal';
import useReferenceData from '../hooks/useReferenceData';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import {
  PieChart as PieChartIcon, TrendingUp, Globe, Tag, List,
  DollarSign, Clock, Camera, RefreshCw, Lock, Landmark, AlertTriangle,
  Edit2, Trash2, X,
} from 'lucide-react';

const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f97316',
];

const TABS = [
  { key: 'overview',    label: 'Overview',       icon: PieChartIcon },
  { key: 'country',     label: 'By Country',     icon: Globe },
  { key: 'account',     label: 'By Account',     icon: Landmark },
  { key: 'type',        label: 'By Asset Type',  icon: Tag },
  { key: 'assets',      label: 'All Assets',     icon: List },
  { key: 'currencies',  label: 'By Currency',    icon: DollarSign },
  { key: 'history',     label: 'History',        icon: Clock },
];

export default function PortfolioPage() {
  const { hideAmounts } = useHideAmounts();
  const { vaultUnlocked, promptVault, vaultKeyExists } = useEncryption();
  const hidden = hideAmounts;

  // Primary data via useVaultData
  const fetchPortfolioData = useCallback(async () => {
    const [portfolioRes, snapshotsRes] = await Promise.all([
      api.get('/portfolio.php'),
      api.get('/portfolio.php?action=snapshots'),
    ]);
    const p = portfolioRes.data.data;
    return { portfolio: p, snapshots: snapshotsRes.data.data || [] };
  }, []);
  const { data: portfolioData, loading, errorMessage, refetch } = useVaultData(fetchPortfolioData, null);

  const portfolio = portfolioData?.portfolio || null;
  const snapshots = portfolioData?.snapshots || [];
  const currencies = portfolio?.currencies || [];

  const [activeTab, setActiveTab] = useState('overview');
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [expandedCountries, setExpandedCountries] = useState({});
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const [detailAsset, setDetailAsset] = useState(null);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  // Currency conversion helpers
  const baseCurrency = portfolio?.summary?.base_currency || 'GBP';

  const getConversionRate = useCallback(() => {
    if (!selectedCurrency || selectedCurrency === baseCurrency) return 1;
    const cur = currencies.find(c => c.code === selectedCurrency);
    if (!cur || !cur.exchange_rate_to_base) return 1;
    return 1 / cur.exchange_rate_to_base;
  }, [selectedCurrency, baseCurrency, currencies]);

  const displayCurrency = selectedCurrency || baseCurrency;

  const getCurrencySymbol = useCallback(() => {
    const cur = currencies.find(c => c.code === displayCurrency);
    return cur?.symbol || displayCurrency;
  }, [currencies, displayCurrency]);

  const fmt = useCallback((value) => {
    if (hidden) return '******';
    const converted = value * getConversionRate();
    const sym = getCurrencySymbol();
    return `${sym}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [hidden, getConversionRate, getCurrencySymbol]);

  const fmtRaw = useCallback((value) => {
    if (hidden) return '******';
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [hidden]);

  // Selection for All Assets tab (must be before conditional returns — Rules of Hooks)
  const assets = portfolio?.assets;
  const assetsList = useMemo(() => assets || [], [assets]);
  const selection = useSelection(assetsList);

  // Reference data for bulk edit (must be before conditional returns — Rules of Hooks)
  const { assetTypes: refAssetTypes, accounts: refAccounts, currencies: refCurrencies, countries: refCountries } = useReferenceData(
    [
      { key: 'assetTypes', url: '/reference.php?resource=asset-types' },
      { key: 'accounts', url: '/accounts.php' },
      { key: 'currencies', url: '/reference.php?resource=currencies' },
      { key: 'countries', url: '/reference.php?resource=countries' },
    ],
    { deps: [isTruthy(vaultUnlocked)] }
  );

  const bulkReferenceData = useMemo(() => ({
    assetTypes: refAssetTypes || [], accounts: refAccounts || [], currencies: refCurrencies || [], countries: refCountries || [],
  }), [refAssetTypes, refAccounts, refCurrencies, refCountries]);

  // Sort hooks (must be before conditional returns — Rules of Hooks)
  const byTypeSafe = useMemo(() => portfolio?.by_type || [], [portfolio]);
  const snapshotsSafe = useMemo(() => portfolioData?.snapshots || [], [portfolioData]);

  const { sorted: sortedByType, sortKey: typeSortKey, sortDir: typeSortDir, onSort: onTypeSort } = useSort(byTypeSafe, 'type_name', 'asc');
  const { sorted: sortedAssets, sortKey: assetSortKey, sortDir: assetSortDir, onSort: onAssetSort } = useSort(assetsList, 'name', 'asc');
  const { sorted: sortedSnapshots, sortKey: snapSortKey, sortDir: snapSortDir, onSort: onSnapSort } = useSort(snapshotsSafe, 'snapshot_date', 'desc');

  // Sort hooks for expandable sub-tables (country/account tabs)
  const { sorted: sortedCountryAssets, sortKey: countryAssetSortKey, sortDir: countryAssetSortDir, onSort: onCountryAssetSort } = useSort(assetsList, 'name', 'asc');
  const { sorted: sortedAccountAssets, sortKey: accountAssetSortKey, sortDir: accountAssetSortDir, onSort: onAccountAssetSort } = useSort(assetsList, 'name', 'asc');

  // byCurrency computed early so useSort can be called before conditional returns
  const byCurrency = useMemo(() => {
    const map = {};
    (assetsList).forEach(a => {
      const code = a.currency_code || 'Unknown';
      if (!map[code]) map[code] = { currency_code: code, currency_symbol: a.currency_symbol || '', total_base: 0, count: 0 };
      map[code].total_base += parseFloat(a.base_amount) || 0;
      map[code].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total_base - a.total_base);
  }, [assetsList]);

  const { sorted: sortedByCurrency, sortKey: currSortKey, sortDir: currSortDir, onSort: onCurrSort } = useSort(byCurrency, 'total_base', 'desc');

  // Snapshot save
  const saveSnapshot = async () => {
    setSnapshotSaving(true);
    try {
      await api.post('/portfolio.php?action=snapshot', { date: new Date().toISOString().slice(0, 10) });
      await refetch();
    } catch (err) {
      console.error('Failed to save snapshot:', err);
    } finally {
      setSnapshotSaving(false);
    }
  };

  // Toggle country expansion
  const toggleCountry = (code) => {
    setExpandedCountries(prev => ({ ...prev, [code]: !prev[code] }));
  };

  // Toggle account expansion
  const toggleAccount = (key) => {
    setExpandedAccounts(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Loading state
  if (loading) {
    return (
      <div className="page-content">
        <div className="loading-center"><div className="spinner" /></div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <AlertTriangle size={40} style={{ color: 'var(--danger)' }} />
          <h3>Failed to load portfolio</h3>
          <p className="text-muted">{errorMessage}</p>
          <button className="btn btn-primary mt-3" onClick={refetch}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>{isTruthy(vaultKeyExists) ? 'Unlock your vault to view portfolio data.' : 'Set up your vault key to get started.'}</p>
          <button className="btn btn-primary mt-3" onClick={promptVault}>
            <Lock size={16} /> {isTruthy(vaultKeyExists) ? 'Unlock Vault' : 'Setup Vault'}
          </button>
        </div>
      </div>
    );
  }

  const { summary, by_country, by_type, by_account } = portfolio;
  const rate = getConversionRate();

  const handleBulkDelete = async () => {
    const items = selection.getSelectedItems();
    if (items.length === 0) return;
    if (!window.confirm(`Delete ${items.length} selected asset${items.length !== 1 ? 's' : ''}?`)) return;
    try {
      await api.post('/bulk.php?action=delete', { entity: 'assets', ids: items.map((i) => i.id) });
      selection.clearSelection();
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Bulk delete failed.');
    }
  };

  // Chart data preparation
  const countryPieData = (by_country || [])
    .filter(c => c.assets > 0)
    .map(c => ({ name: c.country_name, value: Math.round(c.assets * rate) }));

  const typePieData = (by_type || [])
    .filter(t => t.total > 0)
    .map(t => ({ name: t.type_name, value: Math.round(t.total * rate) }));

  const countryBarData = (by_country || []).map(c => ({
    name: c.country_code,
    assets: Math.round(c.assets * rate),
    liquid: Math.round((c.assets - (c.liabilities || 0)) * rate),
  }));

  const snapshotLineData = [...snapshots]
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
    .map(s => ({
      date: s.snapshot_date,
      netWorth: Math.round(s.net_worth * rate),
    }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: '#1e293b', border: '1px solid #334155',
        borderRadius: 8, padding: '8px 12px', fontSize: 13,
      }}>
        <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label || payload[0]?.name}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color || '#e2e8f0' }}>
            {p.name}: {hidden ? '******' : `${getCurrencySymbol()}${p.value?.toLocaleString()}`}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Portfolio</h1>
          <p className="page-subtitle">
            Full financial overview &mdash; base currency: {baseCurrency}
            {portfolio.rates_last_updated && (
              <span className="badge badge-info" style={{ marginLeft: 8 }}>
                Rates as of {new Date(portfolio.rates_last_updated + 'Z').toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="form-control"
            style={{ width: 160 }}
            value={selectedCurrency || ''}
            onChange={e => setSelectedCurrency(e.target.value || null)}
          >
            <option value="">Base ({baseCurrency})</option>
            {currencies.map(c => (
              <option key={c.code} value={c.code}>{c.code} &mdash; {c.name}</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={refetch} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <span className="flex items-center gap-1">
                <Icon size={14} /> {t.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === 'overview' && (
        <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Total Assets',  value: summary.total_assets,      color: 'var(--primary)' },
              { label: 'Liquid Assets',  value: summary.total_liquid,      color: 'var(--success)' },
              { label: 'Liabilities',    value: summary.total_liabilities, color: 'var(--danger)' },
              { label: 'Net Worth',      value: summary.net_worth,         color: 'var(--info)' },
            ].map(card => (
              <div key={card.label} className="card card-body">
                <div className="text-sm text-muted" style={{ marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>
                  {fmt(card.value)}
                </div>
              </div>
            ))}
          </div>

          {/* Pie charts side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div className="card">
              <div className="card-header"><span className="card-title">By Country</span></div>
              <div className="card-body" style={{ height: 300 }}>
                {countryPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={countryPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name }) => name}>
                        {countryPieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="empty-state"><p>No data</p></div>}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><span className="card-title">By Asset Type</span></div>
              <div className="card-body" style={{ height: 300 }}>
                {typePieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={typePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name }) => name}>
                        {typePieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="empty-state"><p>No data</p></div>}
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <div className="card">
            <div className="card-header"><span className="card-title">Assets vs Net by Country</span></div>
            <div className="card-body" style={{ height: 320 }}>
              {countryBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={countryBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={v => hidden ? '***' : v.toLocaleString()} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="assets" name="Assets" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="liquid" name="Net" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="empty-state"><p>No data</p></div>}
            </div>
          </div>
        </div>
      )}

      {/* ===== BY COUNTRY TAB ===== */}
      {activeTab === 'country' && (
        <div>
          {(by_country || []).map(country => {
            const isExpanded = expandedCountries[country.country_code];
            const countryAssetsFiltered = sortedCountryAssets.filter(a => a.country_code === country.country_code);
            return (
              <div key={country.country_code} className="card" style={{ marginBottom: 12 }}>
                <div
                  className="card-header"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleCountry(country.country_code)}
                >
                  <span className="card-title flex items-center gap-2">
                    <span style={{ fontSize: 18 }}>{country.flag_emoji}</span>
                    {country.country_name}
                    <span className="badge badge-muted">{country.count} assets</span>
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {fmt(country.total)}
                  </span>
                </div>
                {isExpanded && (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <SortableTh sortKey="name" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort}>Name</SortableTh>
                          <SortableTh sortKey="account_name" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort}>Account</SortableTh>
                          <SortableTh sortKey="asset_type_name" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort}>Type</SortableTh>
                          <SortableTh sortKey="currency_code" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort}>Currency</SortableTh>
                          <SortableTh sortKey="amount" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort} style={{ textAlign: 'right' }}>Amount</SortableTh>
                          <SortableTh sortKey="base_amount" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort} style={{ textAlign: 'right' }}>Base Amount</SortableTh>
                          <SortableTh sortKey="is_liquid" current={countryAssetSortKey} dir={countryAssetSortDir} onSort={onCountryAssetSort}>Liquid</SortableTh>
                        </tr>
                      </thead>
                      <tbody>
                        {countryAssetsFiltered.map(a => (
                          <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setDetailAsset(a)}>
                            <td className="font-medium">{a.name}</td>
                            <td className="td-muted">{a.account_name || '--'}</td>
                            <td><span className="badge badge-primary">{a.asset_type_name || a.type_name || '--'}</span></td>
                            <td>{a.currency_code}</td>
                            <td style={{ textAlign: 'right' }}>{hidden ? '******' : `${a.currency_symbol || ''}${fmtRaw(a.amount)}`}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(a.base_amount)}</td>
                            <td>{a.is_liquid ? <span className="badge badge-success">Yes</span> : <span className="badge badge-muted">No</span>}</td>
                          </tr>
                        ))}
                        {countryAssetsFiltered.length === 0 && (
                          <tr><td colSpan={7} className="text-center text-muted">No assets</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {(!by_country || by_country.length === 0) && (
            <div className="empty-state"><Globe size={40} /><h3>No country data</h3></div>
          )}
        </div>
      )}

      {/* ===== BY ACCOUNT TAB ===== */}
      {activeTab === 'account' && (
        <div>
          {(by_account || []).map(account => {
            const key = account.account_id || 'standalone';
            const isExpanded = expandedAccounts[key];
            const accountAssetsFiltered = sortedAccountAssets.filter(a =>
              account.account_id ? a.account_id === account.account_id : !a.account_id
            );
            return (
              <div key={key} className="card" style={{ marginBottom: 12 }}>
                <div
                  className="card-header"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleAccount(key)}
                >
                  <span className="card-title flex items-center gap-2">
                    <Landmark size={16} />
                    {account.account_name}
                    <span className="badge badge-muted">{account.count} assets</span>
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {fmt(account.total)}
                  </span>
                </div>
                {isExpanded && (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <SortableTh sortKey="name" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort}>Name</SortableTh>
                          <SortableTh sortKey="asset_type_name" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort}>Type</SortableTh>
                          <SortableTh sortKey="country_code" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort}>Country</SortableTh>
                          <SortableTh sortKey="currency_code" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort}>Currency</SortableTh>
                          <SortableTh sortKey="amount" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort} style={{ textAlign: 'right' }}>Amount</SortableTh>
                          <SortableTh sortKey="base_amount" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort} style={{ textAlign: 'right' }}>Base Amount</SortableTh>
                          <SortableTh sortKey="is_liquid" current={accountAssetSortKey} dir={accountAssetSortDir} onSort={onAccountAssetSort}>Liquid</SortableTh>
                        </tr>
                      </thead>
                      <tbody>
                        {accountAssetsFiltered.map(a => (
                          <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setDetailAsset(a)}>
                            <td className="font-medium">{a.name}</td>
                            <td><span className="badge badge-primary">{a.asset_type_name || '--'}</span></td>
                            <td>
                              <span className="flex items-center gap-1">
                                <span>{a.flag_emoji}</span> {a.country_code || '--'}
                              </span>
                            </td>
                            <td>{a.currency_code}</td>
                            <td style={{ textAlign: 'right' }}>{hidden ? '******' : `${a.currency_symbol || ''}${fmtRaw(a.amount)}`}</td>
                            <td style={{ textAlign: 'right' }}>{fmt(a.base_amount)}</td>
                            <td>{a.is_liquid ? <span className="badge badge-success">Yes</span> : <span className="badge badge-muted">No</span>}</td>
                          </tr>
                        ))}
                        {accountAssetsFiltered.length === 0 && (
                          <tr><td colSpan={7} className="text-center text-muted">No assets</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {(!by_account || by_account.length === 0) && (
            <div className="empty-state"><Landmark size={40} /><h3>No account data</h3></div>
          )}
        </div>
      )}

      {/* ===== BY ASSET TYPE TAB ===== */}
      {activeTab === 'type' && (
        <div className="card">
          <div className="card-header"><span className="card-title">Asset Types</span></div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="type_name" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort}>Type</SortableTh>
                  <SortableTh sortKey="is_liability" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort}>Category</SortableTh>
                  <SortableTh sortKey="total" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort} style={{ textAlign: 'right' }}>Total ({displayCurrency})</SortableTh>
                  <th style={{ textAlign: 'right' }}>Liquid ({displayCurrency})</th>
                  <SortableTh sortKey="count" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort} style={{ textAlign: 'right' }}>Count</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedByType.map(t => {
                  const typeAssets = (assets || []).filter(a => a.type_name === t.type_name || a.account_type_name === t.type_name);
                  const liquidTotal = typeAssets.filter(a => a.is_liquid && !a.is_liability).reduce((s, a) => s + (a.base_amount || 0), 0);
                  return (
                    <tr key={t.type_name}>
                      <td className="font-medium">{t.type_name}</td>
                      <td>
                        {t.is_liability
                          ? <span className="badge badge-danger">Liability</span>
                          : <span className="badge badge-success">Asset</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: t.total < 0 ? 'var(--danger)' : 'var(--text)' }}>
                        {fmt(t.total)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmt(liquidTotal)}</td>
                      <td style={{ textAlign: 'right' }}>{t.count}</td>
                    </tr>
                  );
                })}
                {(!by_type || by_type.length === 0) && (
                  <tr><td colSpan={5} className="text-center text-muted">No type data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== ALL ASSETS TAB ===== */}
      {activeTab === 'assets' && (
        <div>
          {selection.selectionMode && (
            <div className="bulk-toolbar">
              <span className="bulk-count">{selection.selectedCount} selected</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkEdit(true)}><Edit2 size={14} /> Edit Selected</button>
              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}><Trash2 size={14} /> Delete Selected</button>
              <button className="btn btn-ghost btn-sm" onClick={selection.clearSelection}><X size={14} /> Clear</button>
            </div>
          )}
          <div className="card">
          <div className="card-header">
            <span className="card-title">All Assets ({(assets || []).length})</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="th-checkbox">
                    <input type="checkbox" checked={selection.isAllSelected(assetsList)}
                      ref={(el) => { if (el) el.indeterminate = selection.isSomeSelected(assetsList); }}
                      onChange={() => selection.toggleAll(assetsList)} />
                  </th>
                  <SortableTh sortKey="name" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Name</SortableTh>
                  <SortableTh sortKey="account_name" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Account</SortableTh>
                  <SortableTh sortKey="asset_type_name" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Type</SortableTh>
                  <SortableTh sortKey="country_code" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Country</SortableTh>
                  <SortableTh sortKey="currency_code" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Currency</SortableTh>
                  <SortableTh sortKey="amount" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort} style={{ textAlign: 'right' }}>Amount</SortableTh>
                  <SortableTh sortKey="base_amount" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort} style={{ textAlign: 'right' }}>In {displayCurrency}</SortableTh>
                  <SortableTh sortKey="is_liquid" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Liquid</SortableTh>
                  <SortableTh sortKey="is_liability" current={assetSortKey} dir={assetSortDir} onSort={onAssetSort}>Category</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedAssets.map(a => (
                  <tr key={a.id} className={selection.isSelected(a.id) ? 'row-selected' : ''} style={{ cursor: 'pointer' }} onClick={() => setDetailAsset(a)}>
                    <td className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selection.isSelected(a.id)} onChange={() => selection.toggle(a.id)} />
                    </td>
                    <td className="font-medium">{a.name}</td>
                    <td className="td-muted">{a.account_name || '--'}</td>
                    <td><span className="badge badge-primary">{a.asset_type_name || a.type_name || '--'}</span></td>
                    <td>
                      <span className="flex items-center gap-1">
                        <span>{a.flag_emoji}</span> {a.country_code || '--'}
                      </span>
                    </td>
                    <td>{a.currency_code}</td>
                    <td style={{ textAlign: 'right' }}>
                      {hidden ? '******' : `${a.currency_symbol || ''}${fmtRaw(a.amount)}`}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {fmt(a.base_amount)}
                    </td>
                    <td>
                      {a.is_liquid
                        ? <span className="badge badge-success">Yes</span>
                        : <span className="badge badge-muted">No</span>}
                    </td>
                    <td>
                      {a.is_liability
                        ? <span className="badge badge-danger">Liability</span>
                        : <span className="badge badge-success">Asset</span>}
                    </td>
                  </tr>
                ))}
                {(!assets || assets.length === 0) && (
                  <tr><td colSpan={10} className="text-center text-muted">No assets found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {/* ===== BY CURRENCY TAB ===== */}
      {activeTab === 'currencies' && (
        <div className="card">
          <div className="card-header"><span className="card-title">Portfolio by Currency</span></div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="currency_code" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Currency</SortableTh>
                  <SortableTh sortKey="currency_symbol" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Symbol</SortableTh>
                  <SortableTh sortKey="total_base" current={currSortKey} dir={currSortDir} onSort={onCurrSort} style={{ textAlign: 'right' }}>Total ({displayCurrency})</SortableTh>
                  <SortableTh sortKey="count" current={currSortKey} dir={currSortDir} onSort={onCurrSort} style={{ textAlign: 'right' }}>Asset Count</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedByCurrency.map(c => (
                  <tr key={c.currency_code}>
                    <td className="font-medium font-mono">{c.currency_code}</td>
                    <td>{c.currency_symbol}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {fmt(c.total_base)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{c.count}</td>
                  </tr>
                ))}
                {byCurrency.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted">No assets found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== HISTORY TAB ===== */}
      {activeTab === 'history' && (
        <div>
          {/* Net worth chart */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <span className="card-title flex items-center gap-1">
                <TrendingUp size={16} /> Net Worth Over Time
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={saveSnapshot}
                disabled={snapshotSaving}
              >
                <Camera size={14} /> {snapshotSaving ? 'Saving...' : 'Save Snapshot'}
              </button>
            </div>
            <div className="card-body" style={{ height: 340 }}>
              {snapshotLineData.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={snapshotLineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => hidden ? '***' : v.toLocaleString()} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone" dataKey="netWorth" name="Net Worth"
                      stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <Camera size={40} />
                  <h3>Not enough snapshots</h3>
                  <p>Save at least 2 snapshots to see the net worth trend chart.</p>
                </div>
              )}
            </div>
          </div>

          {/* Snapshots table */}
          <div className="card">
            <div className="card-header"><span className="card-title">Snapshots</span></div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <SortableTh sortKey="snapshot_date" current={snapSortKey} dir={snapSortDir} onSort={onSnapSort}>Date</SortableTh>
                    <SortableTh sortKey="total_assets" current={snapSortKey} dir={snapSortDir} onSort={onSnapSort} style={{ textAlign: 'right' }}>Assets</SortableTh>
                    <SortableTh sortKey="total_liquid" current={snapSortKey} dir={snapSortDir} onSort={onSnapSort} style={{ textAlign: 'right' }}>Liquid</SortableTh>
                    <SortableTh sortKey="total_liabilities" current={snapSortKey} dir={snapSortDir} onSort={onSnapSort} style={{ textAlign: 'right' }}>Liabilities</SortableTh>
                    <SortableTh sortKey="net_worth" current={snapSortKey} dir={snapSortDir} onSort={onSnapSort} style={{ textAlign: 'right' }}>Net Worth</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedSnapshots.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.snapshot_date}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.total_assets)}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(s.total_liquid)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{fmt(s.total_liabilities)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--info)' }}>{fmt(s.net_worth)}</td>
                    </tr>
                  ))}
                  {snapshots.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-muted">No snapshots yet. Click "Save Snapshot" to capture your current portfolio.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Asset Detail Modal */}
      <AssetDetailModal
        isOpen={!!detailAsset}
        onClose={() => setDetailAsset(null)}
        item={detailAsset}
      />

      <BulkEditModal isOpen={showBulkEdit} onClose={() => setShowBulkEdit(false)} entityType="assets"
        selectedItems={selection.getSelectedItems()} onSaveComplete={() => { selection.clearSelection(); refetch(); }}
        referenceData={bulkReferenceData} />
    </div>
  );
}
