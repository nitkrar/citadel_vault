import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import SegmentedControl from '../SegmentedControl';

function computeSummary(assets) {
  if (!assets?.length) return null;
  const s = { net_worth: 0, total_assets: 0, total_liabilities: 0, asset_count: assets.length };
  for (const a of assets) {
    const v = a.displayValue ?? a.rawValue ?? a.raw_value ?? 0;
    if (a.is_liability) s.total_liabilities += Math.abs(v);
    else s.total_assets += v;
  }
  s.net_worth = s.total_assets - s.total_liabilities;
  return s;
}

const fmtVal = (v) => typeof v === 'number'
  ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : String(v ?? '');

export default function SharedPortfolioView({ data }) {
  const [groupBy, setGroupBy] = useState('type');
  const [expandedGroups, setExpandedGroups] = useState({});

  if (!data) return null;

  const summary = data.summary || computeSummary(data.assets);
  const currencyPrefix = data.display_currency || '';
  const isSnapshot = data.type === 'portfolio_snapshot';
  const isSummaryType = data.type === 'portfolio_summary';
  const assets = data.assets || [];

  // -- a. Snapshot date -------------------------------------------------------
  const snapshotDateBlock = data.snapshot_date ? (
    <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
      Snapshot: <strong>{data.snapshot_date}</strong>
      {isSnapshot && <span className="badge badge-primary" style={{ marginLeft: 8 }}>(Saved)</span>}
    </div>
  ) : null;

  // -- b. Summary cards -------------------------------------------------------
  const summaryCards = summary ? (
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
            {c.raw ? c.value : `${currencyPrefix}${fmtVal(c.value)}`}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  // -- c. Group-by toggle -----------------------------------------------------
  const hasAccountData = useMemo(
    () => assets.some(a => a.linked_account?.id || a.linked_account?.name),
    [assets]
  );

  // Reset groupBy to 'type' if account data is not available
  useEffect(() => {
    if (!hasAccountData && groupBy === 'account') setGroupBy('type');
  }, [hasAccountData, groupBy]);

  const groupToggle = assets.length > 0 && hasAccountData ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Group By:</span>
      <SegmentedControl
        options={[{ value: 'type', label: 'Type' }, { value: 'account', label: 'Account' }]}
        value={groupBy}
        onChange={v => { setGroupBy(v); setExpandedGroups({}); }}
      />
    </div>
  ) : null;

  // -- d. Collapsible group sections ------------------------------------------
  const groups = {};
  for (const a of assets) {
    let key, label;
    if (groupBy === 'account') {
      const acctId = a.linked_account?.id;
      key = acctId ? String(acctId) : '_unlinked';
      label = a.linked_account?.name || 'Not linked to an account';
    } else {
      key = a.subtype || a.template_name || 'Other';
      label = key;
    }
    if (!groups[key]) groups[key] = { label, entries: [], total: 0, isLiability: a.is_liability };
    groups[key].entries.push(a);
    const val = a.displayValue ?? a.rawValue ?? a.raw_value ?? 0;
    groups[key].total += a.is_liability ? Math.abs(val) : val;
  }

  const toggleGroup = (key) =>
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const groupSections = assets.length > 0 ? (
    Object.entries(groups).map(([key, group]) => {
      const isOpen = !!expandedGroups[key];
      return (
        <div key={key} style={{ marginBottom: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={() => toggleGroup(key)}
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
              {currencyPrefix}{fmtVal(group.total)}
            </span>
          </button>
          {isOpen && (
            <div style={{ padding: '4px 0 0 0' }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    {groupBy === 'account' && <th>Type</th>}
                    <th>Currency</th>
                    <th style={{ textAlign: 'right' }}>Value ({currencyPrefix})</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((e, j) => (
                    <tr key={j}>
                      <td className="font-medium">{e.name}</td>
                      {groupBy === 'account' && (
                        <td><span className="badge badge-primary">{e.template_name || e.subtype || '--'}</span></td>
                      )}
                      <td className="text-muted">{e.currency || '--'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500, color: e.is_liability ? 'var(--danger)' : undefined }}>
                        {fmtVal(e.displayValue ?? e.rawValue ?? e.raw_value ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    })
  ) : null;

  // -- e. Breakdown tables (portfolio_summary only) ---------------------------
  const breakdownTables = isSummaryType ? (
    <>
      {data.by_country && Object.keys(data.by_country).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label className="form-label">By Country</label>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Country</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.by_country).map(([country, info]) => (
                  <tr key={country}>
                    <td>{country}</td>
                    <td style={{ textAlign: 'right' }}>{currencyPrefix}{fmtVal(info.total ?? info)}</td>
                    <td style={{ textAlign: 'right' }}>{info.count ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data.by_type && Object.keys(data.by_type).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label className="form-label">By Type</label>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.by_type).map(([type, info]) => (
                  <tr key={type}>
                    <td>{type}</td>
                    <td style={{ textAlign: 'right' }}>{currencyPrefix}{fmtVal(info.total ?? info)}</td>
                    <td style={{ textAlign: 'right' }}>{info.count ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  ) : null;

  // -- f. Meta fallback (old shares) ------------------------------------------
  const metaFallback = (!summary && !assets.length && data.meta) ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
      {Object.entries(data.meta)
        .filter(([, v]) => typeof v === 'number')
        .map(([key, value]) => (
          <div key={key} style={{
            background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 16px',
            textAlign: 'center', border: '1px solid var(--border)',
          }}>
            <div className="text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
              {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtVal(value)}</div>
          </div>
        ))}
    </div>
  ) : null;

  return (
    <div>
      {snapshotDateBlock}
      {summaryCards}
      {groupToggle}
      {groupSections}
      {breakdownTables}
      {metaFallback}
    </div>
  );
}
