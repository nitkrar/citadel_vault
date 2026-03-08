import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import {
  TrendingUp, Landmark, KeyRound, FileText, DollarSign, Lock,
  AlertTriangle, PieChart as PieChartIcon, Briefcase, ShieldCheck, Layers,
} from 'lucide-react';
import api from '../api/client';
import { useHideAmounts } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import useVaultData from '../hooks/useVaultData';
import BulkWizard from '../components/BulkWizard';
import { fmtCurrency, MASKED } from '../lib/checks';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { hideAmounts } = useHideAmounts();
  const [showWizard, setShowWizard] = useState(false);

  const fetchDashboard = useCallback(async () => {
    const results = await Promise.allSettled([
      api.get('/portfolio.php'),
      api.get('/vault.php'),
      api.get('/licenses.php'),
      api.get('/assets.php'),
    ]);

    const dash = { portfolio: null, vaultCount: 0, licenseCount: 0, assetCount: 0, expiringLicenses: [] };

    if (results[0].status === 'fulfilled') {
      dash.portfolio = results[0].value.data?.data || null;
    }
    if (results[1].status === 'fulfilled') {
      const d = results[1].value.data?.data;
      if (Array.isArray(d)) dash.vaultCount = d.length;
    }
    if (results[2].status === 'fulfilled') {
      const d = results[2].value.data?.data;
      if (Array.isArray(d)) {
        dash.licenseCount = d.length;
        const now = new Date();
        const cutoff = new Date(now.getTime() + 30 * 86400000);
        dash.expiringLicenses = d.filter((l) => {
          if (!l.expiry_date) return false;
          const exp = new Date(l.expiry_date);
          return exp >= now && exp <= cutoff;
        });
      }
    }
    if (results[3].status === 'fulfilled') {
      const d = results[3].value.data?.data;
      if (Array.isArray(d)) dash.assetCount = d.length;
    }
    return dash;
  }, []);

  const emptyDash = { portfolio: null, vaultCount: 0, licenseCount: 0, assetCount: 0, expiringLicenses: [] };
  const { data: dash, loading, errorMessage } = useVaultData(fetchDashboard, emptyDash);
  const { portfolio, vaultCount, licenseCount, assetCount, expiringLicenses } = dash || emptyDash;

  const bc = portfolio?.summary?.base_currency;
  const sym = bc === 'USD' ? '$' : bc === 'EUR' ? '\u20ac' : bc === 'GBP' ? '\u00a3' : bc ? `${bc} ` : '';

  // Country data computed early for useSort (must be before conditional returns)
  const countryData = useMemo(() => (portfolio?.by_country || []).map((c) => ({
    name: c.country_name, value: Math.abs(c.total), flag: c.flag_emoji,
    code: c.country_code, total: c.total, assets: c.assets,
    liabilities: c.liabilities, count: c.count,
  })), [portfolio]);

  const { sorted: sortedCountryData, sortKey: countrySortKey, sortDir: countrySortDir, onSort: onCountrySort } = useSort(countryData, 'total', 'desc');

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
        <div className="alert alert-danger mb-3">
          <AlertTriangle size={16} />
          <span>{errorMessage}</span>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: 'Net Worth', value: portfolio?.summary?.net_worth, icon: <TrendingUp size={20} />, color: 'var(--primary)' },
    { label: 'Liquid Assets', value: portfolio?.summary?.total_liquid, icon: <DollarSign size={20} />, color: 'var(--success)' },
    { label: 'Assets', value: assetCount || (portfolio?.assets?.length ?? 0), icon: <Briefcase size={20} />, color: 'var(--info)', isMoney: false },
    { label: 'Vault Entries', value: vaultCount, icon: <KeyRound size={20} />, color: 'var(--warning)', isMoney: false },
  ];

  const quickLinks = [
    { to: '/accounts', icon: <Landmark size={22} />, title: 'Accounts', desc: 'Manage financial accounts' },
    { to: '/assets', icon: <Briefcase size={22} />, title: 'Assets', desc: 'Track assets & liabilities' },
    { to: '/insurance', icon: <ShieldCheck size={22} />, title: 'Insurance', desc: 'Insurance policies' },
    { to: '/vault', icon: <KeyRound size={22} />, title: 'Vault', desc: 'Passwords & credentials' },
    { to: '/licenses', icon: <FileText size={22} />, title: 'Licenses', desc: 'Software license keys' },
    { to: '/portfolio', icon: <PieChartIcon size={22} />, title: 'Portfolio', desc: 'Portfolio overview & snapshots' },
  ];

  const gridStyle = (min) => ({
    display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`,
    gap: 'var(--space-md)', marginBottom: 'var(--space-lg)',
  });

  return (
    <div className="page-content">
      {/* Greeting */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{getGreeting()}, {user?.username || 'User'}</h1>
          <p className="page-subtitle">
            Here is your personal vault overview.
            {portfolio?.rates_last_updated && (
              <span className="badge badge-info" style={{ marginLeft: 8 }}>
                Rates as of {new Date(portfolio.rates_last_updated + 'Z').toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => setShowWizard(true)}>
          <Layers size={16} /> Bulk Setup Wizard
        </button>
      </div>


      {/* Stat Cards */}
      <div style={gridStyle('220px')}>
        {statCards.map((card) => {
          const isMoney = card.isMoney !== false;
          let display;
          if (isMoney && !portfolio) display = <span style={{ color: 'var(--text-muted)' }}>Locked</span>;
          else if (isMoney && hideAmounts) display = MASKED;
          else if (isMoney) display = fmtCurrency(card.value, sym);
          else display = card.value;

          return (
            <div key={card.label} className="card" style={{ padding: 'var(--space-lg)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted">{card.label}</span>
                <span style={{ color: card.color }}>{card.icon}</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{display}</div>
            </div>
          );
        })}
      </div>

      {/* Expiring Licenses Alert */}
      {expiringLicenses.length > 0 && (
        <div className="card mb-4" style={{ borderColor: 'rgba(245,158,11,0.4)' }}>
          <div className="card-header" style={{ borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
              <span className="card-title" style={{ color: 'var(--warning)' }}>Licenses Expiring Soon</span>
            </div>
            <span className="badge badge-warning">{expiringLicenses.length}</span>
          </div>
          <div className="card-body" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {expiringLicenses.map((lic) => (
                <li key={lic.id} className="flex items-center justify-between"
                  style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{lic.product_name || 'Unnamed License'}</span>
                  <span className="text-sm text-muted">Expires: {new Date(lic.expiry_date).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Chart + Quick Access */}
      <div style={{ ...gridStyle('320px'), gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {/* Pie Chart */}
        <div className="card">
          <div className="card-header"><span className="card-title">Portfolio by Country</span></div>
          <div className="card-body">
            {countryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <RechartsPieChart>
                  <Pie data={countryData} cx="50%" cy="50%" innerRadius={55} outerRadius={100}
                    dataKey="value" nameKey="name" paddingAngle={2}>
                    {countryData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)', color: 'var(--text)', fontSize: 13 }}
                    formatter={(v) => fmtCurrency(v, sym, hideAmounts)}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><p>No portfolio data available.</p></div>
            )}
          </div>
        </div>

        {/* Quick Access */}
        <div className="card">
          <div className="card-header"><span className="card-title">Quick Access</span></div>
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)' }}>
            {quickLinks.map((link) => (
              <Link key={link.to} to={link.to}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-sm)',
                  padding: 'var(--space-md)', background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', textDecoration: 'none', color: 'var(--text)',
                  transition: 'background var(--transition-fast), border-color var(--transition-fast)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                <span style={{ color: 'var(--primary)' }}>{link.icon}</span>
                <span className="font-medium">{link.title}</span>
                <span className="text-sm text-muted" style={{ textAlign: 'center' }}>{link.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Country Breakdown Table */}
      {countryData.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Country Breakdown</span></div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="name" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Country</SortableTh>
                  <SortableTh sortKey="total" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort} style={{ textAlign: 'right' }}>Total</SortableTh>
                  <th style={{ textAlign: 'right' }}>Liquid</th>
                  <SortableTh sortKey="count" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort} style={{ textAlign: 'right' }}>Assets</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedCountryData.map((c) => {
                  const liq = (portfolio?.assets || [])
                    .filter((a) => a.country_code === c.code && a.is_liquid && !a.is_liability)
                    .reduce((s, a) => s + (a.base_amount || 0), 0);
                  return (
                    <tr key={c.code}>
                      <td><span className="flex items-center gap-2"><span>{c.flag}</span><span>{c.name}</span></span></td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCurrency(c.total, sym, hideAmounts)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtCurrency(liq, sym, hideAmounts)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{c.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BulkWizard isOpen={showWizard} onClose={() => setShowWizard(false)} />
    </div>
  );
}
