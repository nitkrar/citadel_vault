import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import SortableTh from '../SortableTh';
import useSort from '../../hooks/useSort';
import api from '../../api/client';

/**
 * AssetsTab — Consolidated data grid with "Group By" dropdown.
 *
 * Modes:
 *   none     → flat sortable table (AllAssets) with checkboxes + bulk delete
 *   country  → expandable groups by country
 *   account  → expandable groups by account
 *   type     → flat type summary table
 *   currency → flat currency summary table
 */
export default function AssetsTab({ portfolio, fmtD, groupBy, setGroupBy, expandedGroups, toggleGroup }) {
  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Group By:</label>
        <select
          className="form-control"
          style={{ width: 'auto', minWidth: 140, fontSize: 13 }}
          value={groupBy}
          onChange={e => {
            setGroupBy(e.target.value);
            sessionStorage.setItem('pv_portfolio_assets_group', e.target.value);
          }}
        >
          <option value="none">None</option>
          <option value="country">Country</option>
          <option value="account">Account</option>
          <option value="type">Asset Type</option>
          <option value="currency">Currency</option>
          <option value="ticker">Ticker</option>
        </select>
      </div>

      {/* Content based on groupBy mode */}
      {groupBy === 'none' && <FlatAssetsView assets={portfolio.assets} fmtD={fmtD} />}
      {groupBy === 'country' && <GroupView groups={portfolio.by_country} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} />}
      {groupBy === 'account' && <GroupView groups={portfolio.by_account} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} />}
      {groupBy === 'type' && <TypeView groups={portfolio.by_type} fmtD={fmtD} />}
      {groupBy === 'currency' && <CurrencyView groups={portfolio.by_currency} fmtD={fmtD} />}
      {groupBy === 'ticker' && <TickerView groups={portfolio.by_ticker} fmtD={fmtD} expanded={expandedGroups} toggle={toggleGroup} />}
    </>
  );
}

// ── Flat Assets (with sort, checkboxes, bulk delete) ─────────────

function FlatAssetsView({ assets, fmtD }) {
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
        <div className="bulk-toolbar-floating">
          <span className="bulk-count">{selected.size} selected</span>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete} disabled={deleting}>
            <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
        </div>
      )}
      <div className="card">
        <div className="table-wrapper">
          <table className="table-sticky-header">
            <thead>
              <tr>
                <th className="th-checkbox">
                  <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0} onChange={toggleAll} />
                </th>
                <SortableTh sortKey="name" current={sortKey} dir={sortDir} onSort={onSort}>Name</SortableTh>
                <th>Type</th>
                <th>Currency</th>
                <SortableTh sortKey="displayValue" current={sortKey} dir={sortDir} onSort={onSort} style={{ textAlign: 'right' }}>Value</SortableTh>
                {hasAnyGainLoss && <SortableTh sortKey="gainLoss" current={sortKey} dir={sortDir} onSort={onSort} style={{ textAlign: 'right' }}>Gain/Loss</SortableTh>}
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

// ── Group View (Country / Account) ───────────────────────────────

function GroupView({ groups, fmtD, expanded, toggle }) {
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
                <table className="table-sticky-header">
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

// ── Type Summary View ────────────────────────────────────────────

function TypeView({ groups, fmtD }) {
  const rows = useMemo(() =>
    Object.entries(groups)
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  [groups]);

  return (
    <div className="card">
      <div className="table-wrapper">
        <table className="table-sticky-header">
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

// ── Currency Summary View ────────────────────────────────────────

function CurrencyView({ groups, fmtD }) {
  const rows = useMemo(() =>
    Object.entries(groups)
      .map(([code, data]) => ({ code, ...data }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  [groups]);

  return (
    <div className="card">
      <div className="table-wrapper">
        <table className="table-sticky-header">
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

// ── Ticker View (Expandable stock holdings) ──────────────────────

function TickerView({ groups, fmtD, expanded, toggle }) {
  const sortedGroups = useMemo(() =>
    Object.entries(groups || {})
      .sort((a, b) => {
        if (a[0] === '_other') return 1;
        if (b[0] === '_other') return -1;
        return Math.abs(b[1].total) - Math.abs(a[1].total);
      }),
  [groups]);

  if (sortedGroups.length === 0) {
    return <div className="empty-state"><p>No data to display.</p></div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sortedGroups.map(([key, group]) => {
        const isOpen = expanded[key];
        const isOther = key === '_other';
        const avgCost = group.costCount > 0 ? group.totalCost / group.costCount : null;
        const totalGainLoss = group.items.reduce((sum, item) => sum + (item.gainLoss || 0), 0);
        const hasGainLoss = group.items.some(item => item.gainLoss !== undefined);

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
              <span style={{ flex: 1 }}>{group.label}</span>
              {!isOther && group.totalShares > 0 && (
                <span className="text-muted" style={{ fontSize: 12, marginRight: 8 }}>
                  {group.totalShares.toLocaleString()} shares
                </span>
              )}
              {!isOther && avgCost !== null && (
                <span className="text-muted" style={{ fontSize: 12, marginRight: 8 }}>
                  Avg {fmtD(avgCost)}
                </span>
              )}
              <span className="badge badge-muted" style={{ marginRight: 8 }}>{group.count}</span>
              {hasGainLoss && !isOther && (
                <span style={{
                  fontSize: 12, marginRight: 8, fontWeight: 500,
                  color: totalGainLoss > 0 ? 'var(--color-success, #16a34a)' : totalGainLoss < 0 ? 'var(--color-danger, #dc2626)' : 'inherit',
                }}>
                  {fmtD(totalGainLoss)}
                </span>
              )}
              <span style={{ fontWeight: 700, fontSize: 15 }}>{fmtD(group.total)}</span>
            </button>
            {isOpen && (
              <div className="table-wrapper">
                <table className="table-sticky-header">
                  <thead>
                    <tr>
                      <th>Name</th>
                      {!isOther && <th style={{ textAlign: 'right' }}>Shares</th>}
                      {!isOther && <th style={{ textAlign: 'right' }}>Price</th>}
                      {!isOther && <th style={{ textAlign: 'right' }}>Cost</th>}
                      <th>Currency</th>
                      <th style={{ textAlign: 'right' }}>Value</th>
                      {hasGainLoss && <th style={{ textAlign: 'right' }}>Gain/Loss</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map(item => (
                      <tr key={item.id}>
                        <td className="font-medium">{item.name}</td>
                        {!isOther && <td style={{ textAlign: 'right' }}>{item.shares ?? '—'}</td>}
                        {!isOther && <td style={{ textAlign: 'right' }}>{item.pricePerShare != null ? fmtD(item.pricePerShare) : '—'}</td>}
                        {!isOther && <td style={{ textAlign: 'right' }}>{item.costPrice != null ? fmtD(item.costPrice) : '—'}</td>}
                        <td className="td-muted">{item.currency}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtD(item.displayValue)}</td>
                        {hasGainLoss && (
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
            )}
          </div>
        );
      })}
    </div>
  );
}
