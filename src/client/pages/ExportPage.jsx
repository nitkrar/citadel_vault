import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api/client';
import { useHideAmounts } from '../components/Layout';
import { useEncryption } from '../contexts/EncryptionContext';
import html2canvas from 'html2canvas';
import { FileDown, FileText, Image, Printer, Lock } from 'lucide-react';
import { fmtCurrency, MASKED } from '../lib/checks';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';

const ALL_SECTIONS = [
  { key: 'portfolio',  label: 'Portfolio Summary' },
  { key: 'accounts',   label: 'Accounts' },
  { key: 'by_country', label: 'By Country' },
  { key: 'by_type',    label: 'By Type' },
  { key: 'licenses',   label: 'Licenses' },
  { key: 'vault',      label: 'Vault Titles' },
  { key: 'rates',      label: 'Exchange Rates' },
];

const sectionHeadingStyle = {
  fontSize: 14, textTransform: 'uppercase', letterSpacing: 1,
  color: 'var(--text-muted)', marginBottom: 'var(--space-sm)',
  borderBottom: '1px solid var(--border)', paddingBottom: 'var(--space-xs)',
};

export default function ExportPage() {
  const { hideAmounts } = useHideAmounts();
  const { vaultUnlocked } = useEncryption();
  const previewRef = useRef(null);

  const [source, setSource] = useState('live');
  const [selectedSections, setSelectedSections] = useState(
    ALL_SECTIONS.reduce((acc, s) => ({ ...acc, [s.key]: true }), {}),
  );
  const [portfolio, setPortfolio] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [vaultEntries, setVaultEntries] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes, lRes, vRes] = await Promise.allSettled([
        api.get('/portfolio.php'), api.get('/portfolio.php?action=snapshots'),
        api.get('/licenses.php'), api.get('/vault.php'),
      ]);
      if (pRes.status === 'fulfilled') { const d = pRes.value.data?.data; if (d) { setPortfolio(d); setCurrencies(d.currencies || []); } }
      if (sRes.status === 'fulfilled') setSnapshots(sRes.value.data?.data || []);
      if (lRes.status === 'fulfilled') setLicenses(lRes.value.data?.data || []);
      if (vRes.status === 'fulfilled') setVaultEntries(vRes.value.data?.data || []);
    } catch (err) { console.error('Failed to load export data:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const baseCurrency = portfolio?.summary?.base_currency || 'GBP';
  const sym = baseCurrency === 'USD' ? '$' : baseCurrency === 'EUR' ? '\u20ac' : baseCurrency === 'GBP' ? '\u00a3' : `${baseCurrency} `;

  const toggleSection = (key) => setSelectedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const setAll = (val) => setSelectedSections(ALL_SECTIONS.reduce((acc, s) => ({ ...acc, [s.key]: val }), {}));
  const activeSections = Object.entries(selectedSections).filter(([, v]) => v).map(([k]) => k);
  const show = (key) => selectedSections[key];

  // Export: CSV via API blob download
  const exportCSV = async () => {
    if (activeSections.length === 0) return;
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: 'csv', sections: activeSections.join(',') });
      if (source !== 'live') params.set('snapshot', source);
      const response = await api.get(`/export.php?${params.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `citadel_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) { console.error('CSV export failed:', err); alert('CSV export failed. Make sure your vault is unlocked.'); }
    finally { setExporting(false); }
  };

  // Export: Image via html2canvas
  const exportImage = async () => {
    if (!previewRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(previewRef.current, { backgroundColor: '#0f172a', scale: 2, useCORS: true });
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `citadel_export_${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
    } catch (err) { console.error('Image export failed:', err); alert('Image export failed.'); }
    finally { setExporting(false); }
  };

  // Derived arrays (computed early for useSort — must be before conditional returns)
  const accounts = useMemo(() => portfolio?.accounts || [], [portfolio]);
  const byCountry = useMemo(() => portfolio?.by_country || [], [portfolio]);
  const byType = useMemo(() => portfolio?.by_type || [], [portfolio]);

  // Sort hooks for all preview tables
  const { sorted: sortedAccounts, sortKey: acctSortKey, sortDir: acctSortDir, onSort: onAcctSort } = useSort(accounts, 'name', 'asc');
  const { sorted: sortedByCountry, sortKey: countrySortKey, sortDir: countrySortDir, onSort: onCountrySort } = useSort(byCountry, 'total', 'desc');
  const { sorted: sortedByType, sortKey: typeSortKey, sortDir: typeSortDir, onSort: onTypeSort } = useSort(byType, 'total', 'desc');
  const { sorted: sortedLicenses, sortKey: licSortKey, sortDir: licSortDir, onSort: onLicSort } = useSort(licenses, 'product_name', 'asc');
  const { sorted: sortedVault, sortKey: vaultSortKey, sortDir: vaultSortDir, onSort: onVaultSort } = useSort(vaultEntries, 'title', 'asc');
  const { sorted: sortedCurrencies, sortKey: curSortKey, sortDir: curSortDir, onSort: onCurSort } = useSort(currencies, 'code', 'asc');

  if (loading) {
    return <div className="page-content"><div className="loading-center"><div className="spinner" /></div></div>;
  }

  const summary = portfolio?.summary;

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Export Data</h1>
          <p className="page-subtitle">Download your vault data as CSV, PDF, or image.</p>
        </div>
      </div>

      {/* Configuration */}
      <div className="card mb-4">
        <div className="card-header"><span className="card-title">Export Configuration</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
            <div>
              <label className="form-label" style={{ marginBottom: 'var(--space-sm)', display: 'block' }}>Data Source</label>
              <select className="form-control" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%' }}>
                <option value="live">Live Data</option>
                {snapshots.map((s) => <option key={s.id} value={s.snapshot_date}>Snapshot: {s.snapshot_date}</option>)}
              </select>
              <p className="text-sm text-muted" style={{ marginTop: 'var(--space-xs)' }}>
                {source === 'live' ? 'Uses current account data with cached exchange rates.' : `Snapshot from ${source}. Summary data only.`}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-sm)' }}>
                <label className="form-label" style={{ margin: 0 }}>Sections to Export</label>
                <div className="flex items-center gap-2">
                  <button className="btn btn-sm btn-outline" onClick={() => setAll(true)}>All</button>
                  <button className="btn btn-sm btn-outline" onClick={() => setAll(false)}>None</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xs)' }}>
                {ALL_SECTIONS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2" style={{ cursor: 'pointer', padding: '4px 0' }}>
                    <input type="checkbox" checked={!!selectedSections[s.key]} onChange={() => toggleSection(s.key)} />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export Buttons */}
      <div className="flex items-center gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={exportCSV} disabled={exporting || activeSections.length === 0}>
          <FileDown size={16} /> {exporting ? 'Exporting...' : 'Download CSV'}
        </button>
        <button className="btn btn-secondary" onClick={() => window.print()}>
          <Printer size={16} /> Print / PDF
        </button>
        <button className="btn btn-secondary" onClick={exportImage} disabled={exporting}>
          <Image size={16} /> Save as Image
        </button>
        {activeSections.length === 0 && <span className="text-sm text-muted">Select at least one section to export.</span>}
      </div>

      {/* Preview */}
      <div className="card">
        <div className="card-header">
          <span className="card-title flex items-center gap-2"><FileText size={16} /> Export Preview</span>
          <span className="badge badge-muted">{source === 'live' ? 'Live' : `Snapshot: ${source}`}</span>
        </div>
        <div className="card-body" ref={previewRef} style={{ padding: 'var(--space-lg)' }}>
          {activeSections.length === 0 && (
            <div className="empty-state"><FileDown size={40} className="empty-icon" /><h3>No sections selected</h3><p>Check at least one section above to see a preview.</p></div>
          )}

          {show('portfolio') && summary && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>Portfolio Summary</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)' }}>
                {[{ label: 'Net Worth', value: summary.net_worth, color: 'var(--info)' },
                  { label: 'Total Assets', value: summary.total_assets, color: 'var(--primary)' },
                  { label: 'Liquid Assets', value: summary.total_liquid, color: 'var(--success)' },
                  { label: 'Liabilities', value: summary.total_liabilities, color: 'var(--danger)' },
                ].map((item) => (
                  <div key={item.label} style={{ padding: 'var(--space-md)', background: 'var(--bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                    <div className="text-sm text-muted">{item.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>{fmtCurrency(item.value, sym, hideAmounts)}</div>
                  </div>
                ))}
                <div style={{ padding: 'var(--space-md)', background: 'var(--bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <div className="text-sm text-muted">Base Currency</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{baseCurrency}</div>
                </div>
              </div>
            </div>
          )}

          {show('accounts') && accounts.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>Accounts ({accounts.length})</h3>
              <div className="table-wrapper"><table>
                <thead><tr>
                  <SortableTh sortKey="name" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort}>Name</SortableTh>
                  <SortableTh sortKey="institution" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort}>Institution</SortableTh>
                  <SortableTh sortKey="type_name" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort}>Type</SortableTh>
                  <SortableTh sortKey="country_code" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort}>Country</SortableTh>
                  <SortableTh sortKey="currency_code" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort}>Currency</SortableTh>
                  <SortableTh sortKey="amount" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort} style={{ textAlign: 'right' }}>Amount</SortableTh>
                  <SortableTh sortKey="is_liquid" current={acctSortKey} dir={acctSortDir} onSort={onAcctSort}>Liquid</SortableTh>
                </tr></thead>
                <tbody>
                  {sortedAccounts.slice(0, 50).map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">{a.name}</td>
                      <td className="td-muted">{a.institution || '--'}</td>
                      <td><span className="badge badge-primary">{a.type_name}</span></td>
                      <td>{a.flag_emoji} {a.country_code}</td>
                      <td>{a.currency_code}</td>
                      <td style={{ textAlign: 'right' }}>{fmtCurrency(a.amount, a.currency_symbol, hideAmounts)}</td>
                      <td>{a.is_liquid ? <span className="badge badge-success">Yes</span> : <span className="badge badge-muted">No</span>}</td>
                    </tr>
                  ))}
                  {accounts.length > 50 && <tr><td colSpan={7} className="text-center text-muted">...and {accounts.length - 50} more (all included in CSV)</td></tr>}
                </tbody>
              </table></div>
            </div>
          )}

          {show('by_country') && byCountry.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>By Country</h3>
              <div className="table-wrapper"><table>
                <thead><tr>
                  <SortableTh sortKey="country_name" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Country</SortableTh>
                  <SortableTh sortKey="total" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort} style={{ textAlign: 'right' }}>Total ({baseCurrency})</SortableTh>
                  <SortableTh sortKey="count" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort} style={{ textAlign: 'right' }}>Accounts</SortableTh>
                </tr></thead>
                <tbody>
                  {sortedByCountry.map((c) => (
                    <tr key={c.country_code}><td>{c.flag_emoji} {c.country_name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(c.total, sym, hideAmounts)}</td>
                      <td style={{ textAlign: 'right' }}>{c.count}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {show('by_type') && byType.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>By Type</h3>
              <div className="table-wrapper"><table>
                <thead><tr>
                  <SortableTh sortKey="type_name" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort}>Type</SortableTh>
                  <SortableTh sortKey="total" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort} style={{ textAlign: 'right' }}>Total ({baseCurrency})</SortableTh>
                  <SortableTh sortKey="count" current={typeSortKey} dir={typeSortDir} onSort={onTypeSort} style={{ textAlign: 'right' }}>Count</SortableTh>
                </tr></thead>
                <tbody>
                  {sortedByType.map((t) => (
                    <tr key={t.type_name}><td className="font-medium">{t.type_name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: t.total < 0 ? 'var(--danger)' : 'var(--text)' }}>{fmtCurrency(t.total, sym, hideAmounts)}</td>
                      <td style={{ textAlign: 'right' }}>{t.count}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {show('licenses') && licenses.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>Licenses ({licenses.length})</h3>
              <div className="table-wrapper"><table>
                <thead><tr>
                  <SortableTh sortKey="product_name" current={licSortKey} dir={licSortDir} onSort={onLicSort}>Product</SortableTh>
                  <SortableTh sortKey="vendor" current={licSortKey} dir={licSortDir} onSort={onLicSort}>Vendor</SortableTh>
                  <SortableTh sortKey="category" current={licSortKey} dir={licSortDir} onSort={onLicSort}>Category</SortableTh>
                  <SortableTh sortKey="purchase_date" current={licSortKey} dir={licSortDir} onSort={onLicSort}>Purchase Date</SortableTh>
                  <SortableTh sortKey="expiry_date" current={licSortKey} dir={licSortDir} onSort={onLicSort}>Expiry Date</SortableTh>
                  <SortableTh sortKey="seats" current={licSortKey} dir={licSortDir} onSort={onLicSort} style={{ textAlign: 'right' }}>Seats</SortableTh>
                </tr></thead>
                <tbody>
                  {sortedLicenses.map((lic) => (
                    <tr key={lic.id}><td className="font-medium">{lic.product_name || '--'}</td><td className="td-muted">{lic.vendor || '--'}</td>
                      <td><span className="badge badge-muted">{lic.category}</span></td><td>{lic.purchase_date || '--'}</td>
                      <td>{lic.expiry_date || '--'}</td><td style={{ textAlign: 'right' }}>{lic.seats}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {show('vault') && vaultEntries.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>Vault Entries ({vaultEntries.length}) &mdash; Titles Only</h3>
              <div className="table-wrapper"><table>
                <thead><tr>
                  <SortableTh sortKey="title" current={vaultSortKey} dir={vaultSortDir} onSort={onVaultSort}>Title</SortableTh>
                  <SortableTh sortKey="website_url" current={vaultSortKey} dir={vaultSortDir} onSort={onVaultSort}>Website</SortableTh>
                  <SortableTh sortKey="category" current={vaultSortKey} dir={vaultSortDir} onSort={onVaultSort}>Category</SortableTh>
                </tr></thead>
                <tbody>
                  {sortedVault.map((v) => (
                    <tr key={v.id}><td className="font-medium">{v.title || '--'}</td><td className="td-muted">{v.website_url || '--'}</td>
                      <td><span className="badge badge-muted">{v.category}</span></td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {show('rates') && currencies.length > 0 && (
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <h3 style={sectionHeadingStyle}>Exchange Rates</h3>
              <div className="table-wrapper"><table>
                <thead><tr>
                  <SortableTh sortKey="name" current={curSortKey} dir={curSortDir} onSort={onCurSort}>Currency</SortableTh>
                  <SortableTh sortKey="code" current={curSortKey} dir={curSortDir} onSort={onCurSort}>Code</SortableTh>
                  <SortableTh sortKey="symbol" current={curSortKey} dir={curSortDir} onSort={onCurSort}>Symbol</SortableTh>
                  <SortableTh sortKey="exchange_rate_to_base" current={curSortKey} dir={curSortDir} onSort={onCurSort} style={{ textAlign: 'right' }}>Rate to {baseCurrency}</SortableTh>
                </tr></thead>
                <tbody>
                  {sortedCurrencies.map((c) => (
                    <tr key={c.code}><td>{c.name}</td><td className="font-mono font-medium">{c.code}</td><td>{c.symbol}</td>
                      <td style={{ textAlign: 'right' }} className="font-mono">{c.code === baseCurrency ? '1.0000 (base)' : c.exchange_rate_to_base?.toFixed(6) || '--'}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
