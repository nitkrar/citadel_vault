import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';
import { invalidateReferenceCache } from '../hooks/useReferenceData';
import useSort from '../hooks/useSort';
import SortableTh from '../components/SortableTh';
import {
  Globe, DollarSign, Plus,
  Trash2, AlertTriangle, RefreshCw, Check, X, Search, TrendingUp, Database,
} from 'lucide-react';

const TABS = [
  { key: 'countries',  label: 'Countries',  icon: Globe },
  { key: 'currencies', label: 'Currencies', icon: DollarSign },
  { key: 'exchanges',  label: 'Exchanges',  icon: TrendingUp },
];

export default function ReferenceDataPage() {
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('pv_refdata_last_tab') || 'countries');
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    sessionStorage.setItem('pv_refdata_last_tab', tab);
  };

  // ===== COUNTRIES STATE =====
  const [countries, setCountries] = useState([]);
  const [countriesLoading, setCountriesLoading] = useState(false);

  // ===== CURRENCIES STATE =====
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(false);
  const [refreshingRates, setRefreshingRates] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [togglingCountry, setTogglingCountry] = useState(null);
  const [togglingCurrency, setTogglingCurrency] = useState(null);

  // ===== EXCHANGES STATE =====
  const [exchangeList, setExchangeList] = useState([]);
  const [exchangesLoading, setExchangesLoading] = useState(false);
  const [exchangeForm, setExchangeForm] = useState({ country_code: '', name: '', suffix: '', display_order: 0 });
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [exchangeSearch, setExchangeSearch] = useState('');
  const [exchangeError, setExchangeError] = useState('');

  // ===== TICKER CACHE STATE =====
  const [tickerCache, setTickerCache] = useState([]);
  const [tickerCacheLoading, setTickerCacheLoading] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  // ===== INLINE EDIT STATE =====
  const [inlineEdit, setInlineEdit] = useState(null); // { resource, id, field, value }
  const [inlineEditSaving, setInlineEditSaving] = useState(false);

  // ===== SORTING =====
  const presortedCountries = useMemo(() => [...countries].sort((a, b) => {
    const aa = Number(b.is_active) - Number(a.is_active);
    if (aa !== 0) return aa;
    const od = (a.display_order || 999) - (b.display_order || 999);
    if (od !== 0) return od;
    return (a.name || '').localeCompare(b.name || '');
  }), [countries]);
  const presortedCurrencies = useMemo(() => [...currencies].sort((a, b) => {
    const aa = Number(b.is_active) - Number(a.is_active);
    if (aa !== 0) return aa;
    const od = (a.display_order || 999) - (b.display_order || 999);
    if (od !== 0) return od;
    return (a.name || '').localeCompare(b.name || '');
  }), [currencies]);
  const { sorted: sortedCountries, sortKey: countrySortKey, sortDir: countrySortDir, onSort: onCountrySort } = useSort(presortedCountries, '', 'asc');
  const { sorted: sortedCurrencies, sortKey: currSortKey, sortDir: currSortDir, onSort: onCurrSort } = useSort(presortedCurrencies, '', 'asc');
  const { sorted: sortedExchanges, sortKey: exSortKey, sortDir: exSortDir, onSort: onExSort } = useSort(exchangeList, 'country_code', 'asc');

  // ===== LOAD FUNCTIONS =====
  const loadCountries = useCallback(async () => {
    setCountriesLoading(true);
    try {
      const res = await api.get('/reference.php?resource=countries&all=1');
      setCountries(res.data.data || []);
    } catch { /* ignore */ }
    setCountriesLoading(false);
  }, []);

  const loadCurrencies = useCallback(async () => {
    setCurrenciesLoading(true);
    try {
      const res = await api.get('/reference.php?resource=currencies&all=1');
      setCurrencies(res.data.data || []);
    } catch { /* ignore */ }
    setCurrenciesLoading(false);
  }, []);

  const loadExchanges = useCallback(async () => {
    setExchangesLoading(true);
    try {
      const res = await api.get('/reference.php?resource=exchanges');
      setExchangeList(res.data.data || []);
    } catch { /* ignore */ }
    setExchangesLoading(false);
  }, []);

  const loadTickerCache = useCallback(async () => {
    setTickerCacheLoading(true);
    try {
      const res = await api.get('/prices.php?action=cache');
      setTickerCache(res.data.data || []);
    } catch { /* ignore */ }
    setTickerCacheLoading(false);
  }, []);

  // Load data for active tab
  useEffect(() => {
    switch (activeTab) {
      case 'countries': loadCountries(); loadCurrencies(); break;
      case 'currencies': loadCurrencies(); break;
      case 'exchanges': loadExchanges(); loadTickerCache(); break;
    }
  }, [activeTab, loadCountries, loadCurrencies, loadExchanges, loadTickerCache]);

  // ===== CURRENCIES: REFRESH RATES =====
  const refreshRates = async () => {
    setRefreshingRates(true);
    try {
      await api.post('/prices.php?action=refresh', { type: 'forex', force: true });
      invalidateReferenceCache('currencies');
      await loadCurrencies();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to refresh rates.');
    }
    setRefreshingRates(false);
  };

  // ===== EXCHANGE CRUD =====
  const addExchange = async () => {
    setExchangeError('');
    if (!exchangeForm.country_code.trim() || !exchangeForm.name.trim()) {
      setExchangeError('Country code and name are required.');
      return;
    }
    setExchangeSaving(true);
    try {
      await api.post('/reference.php?resource=exchanges', {
        country_code: exchangeForm.country_code.trim(),
        name: exchangeForm.name.trim(),
        suffix: exchangeForm.suffix.trim(),
        display_order: Number(exchangeForm.display_order) || 0,
      });
      setExchangeForm({ country_code: '', name: '', suffix: '', display_order: 0 });
      invalidateReferenceCache('exchanges');
      await loadExchanges();
    } catch (err) {
      setExchangeError(err.response?.data?.error || 'Failed to add exchange.');
    }
    setExchangeSaving(false);
  };

  const deleteExchange = async (ex) => {
    if (!window.confirm(`Delete exchange "${ex.name}" (${ex.country_code})?`)) return;
    try {
      await api.delete(`/reference.php?resource=exchanges&id=${ex.id}`);
      invalidateReferenceCache('exchanges');
      await loadExchanges();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete exchange.');
    }
  };

  const clearTickerCache = async () => {
    if (!window.confirm('Clear all cached ticker prices?')) return;
    setClearingCache(true);
    try {
      await api.delete('/prices.php?action=cache');
      setTickerCache([]);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to clear cache.');
    }
    setClearingCache(false);
  };

  // ===== COUNTRY TOGGLE =====
  const toggleCountryActive = async (c) => {
    const newActive = c.is_active ? 0 : 1;
    setTogglingCountry(c.id);
    try {
      await api.put(`/reference.php?resource=countries&id=${c.id}`, { is_active: newActive });
      invalidateReferenceCache('countries');
      setCountries(prev => prev.map(co => co.id === c.id ? { ...co, is_active: newActive } : co));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to toggle country.');
    }
    setTogglingCountry(null);
  };

  // ===== CURRENCY TOGGLE =====
  const toggleCurrencyActive = async (c) => {
    const newActive = c.is_active ? 0 : 1;
    setTogglingCurrency(c.id);
    try {
      await api.put(`/reference.php?resource=currencies&id=${c.id}`, { is_active: newActive });
      invalidateReferenceCache('currencies');
      setCurrencies(prev => prev.map(cur => cur.id === c.id ? { ...cur, is_active: newActive } : cur));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to toggle currency.');
    }
    setTogglingCurrency(null);
  };

  // ===== INLINE EDIT SAVE =====
  const saveInlineEdit = async () => {
    if (!inlineEdit) return;
    const { resource, id, field, value } = inlineEdit;
    setInlineEditSaving(true);
    try {
      await api.put(`/reference.php?resource=${resource}&id=${id}`, { [field]: value });
      invalidateReferenceCache(resource);
      if (resource === 'countries') await loadCountries();
      else if (resource === 'currencies') await loadCurrencies();
      else if (resource === 'exchanges') await loadExchanges();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save.');
    }
    setInlineEditSaving(false);
    setInlineEdit(null);
  };

  const EditableCell = ({ resource, id, field, value, className, type }) => {
    const isEditing = inlineEdit?.resource === resource && inlineEdit?.id === id && inlineEdit?.field === field;
    if (isEditing) {
      if (type === 'currency-select') {
        const handleSelectChange = async (e) => {
          const newVal = e.target.value ? Number(e.target.value) : null;
          setInlineEdit(prev => ({ ...prev, value: newVal }));
          // Save immediately on selection
          setInlineEditSaving(true);
          try {
            await api.put(`/reference.php?resource=${resource}&id=${id}`, { default_currency_id: newVal });
            invalidateReferenceCache(resource);
            await loadCountries();
          } catch (err) {
            alert(err.response?.data?.error || 'Failed to save.');
          }
          setInlineEditSaving(false);
          setInlineEdit(null);
        };
        return (
          <select
            autoFocus
            className="form-control form-control-sm"
            value={inlineEdit.value ?? ''}
            onChange={handleSelectChange}
            onBlur={() => setInlineEdit(null)}
            onKeyDown={e => { if (e.key === 'Escape') setInlineEdit(null); }}
            disabled={inlineEditSaving}
          >
            <option value="">-- None --</option>
            {currencies.map(cur => (
              <option key={cur.id} value={cur.id}>{cur.code} ({cur.symbol}){Number(cur.is_active) ? '' : ' [inactive]'}</option>
            ))}
          </select>
        );
      }
      return (
        <input
          autoFocus
          className="form-control form-control-sm"
          value={inlineEdit.value}
          onChange={e => setInlineEdit(prev => ({ ...prev, value: e.target.value }))}
          onBlur={saveInlineEdit}
          onKeyDown={e => { if (e.key === 'Enter') saveInlineEdit(); if (e.key === 'Escape') setInlineEdit(null); }}
          disabled={inlineEditSaving}
        />
      );
    }
    if (type === 'currency-select') {
      const cur = value ? currencies.find(c => c.id == value) : null;
      const isInactive = cur && !Number(cur.is_active);
      const label = cur ? `${cur.code} (${cur.symbol})` : '--';
      return (
        <span
          className={className}
          style={{ cursor: 'pointer', color: isInactive ? 'var(--color-warning)' : undefined }}
          title={isInactive ? 'This currency is inactive' : undefined}
          onClick={() => setInlineEdit({ resource, id, field, value: value ?? '' })}
        >
          {label}{isInactive && <AlertTriangle size={13} style={{ marginLeft: 4, verticalAlign: -2 }} />}
        </span>
      );
    }
    return (
      <span className={className} style={{ cursor: 'pointer' }} onClick={() => setInlineEdit({ resource, id, field, value: value ?? '' })}>
        {value || '--'}
      </span>
    );
  };

  // ===== RENDER HELPERS =====
  const isTabLoading = () => {
    switch (activeTab) {
      case 'countries': return countriesLoading;
      case 'currencies': return currenciesLoading;
      case 'exchanges': return exchangesLoading;
      default: return false;
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title"><Database size={20} style={{ marginRight: 8, verticalAlign: -3 }} />Reference Data</h2>
          <p className="page-subtitle">Manage countries, currencies, and exchanges</p>
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
              onClick={() => handleTabChange(t.key)}
            >
              <span className="flex items-center gap-1"><Icon size={14} /> {t.label}</span>
            </button>
          );
        })}
      </div>

      {isTabLoading() && (
        <div className="loading-center"><div className="spinner" /></div>
      )}

      {/* ===== COUNTRIES TAB ===== */}
      {activeTab === 'countries' && !countriesLoading && (() => {
        const activeCount = countries.filter(c => Number(c.is_active)).length;
        return (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{activeCount} of {countries.length} active</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <SortableTh sortKey="is_active" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort} style={{ width: 60 }}>Active</SortableTh>
                  <SortableTh sortKey="flag_emoji" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Flag</SortableTh>
                  <SortableTh sortKey="name" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Country</SortableTh>
                  <SortableTh sortKey="code" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Country Code</SortableTh>
                  <SortableTh sortKey="default_currency_code" current={countrySortKey} dir={countrySortDir} onSort={onCountrySort}>Default Currency</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedCountries.map(c => (
                    <tr key={c.id} style={{ opacity: Number(c.is_active) ? 1 : 0.55 }}>
                      <td>
                        <button
                          className={`btn btn-ghost btn-sm btn-icon ${Number(c.is_active) ? 'text-success' : 'text-muted'}`}
                          title={Number(c.is_active) ? 'Click to deactivate' : 'Click to activate'}
                          onClick={() => toggleCountryActive(c)}
                          disabled={togglingCountry === c.id}
                        >
                          {Number(c.is_active) ? <Check size={16} /> : <X size={16} />}
                        </button>
                      </td>
                      <td style={{ fontSize: 18 }}>
                        <EditableCell resource="countries" id={c.id} field="flag_emoji" value={c.flag_emoji} />
                      </td>
                      <td>
                        <EditableCell resource="countries" id={c.id} field="name" value={c.name} className="font-medium" />
                      </td>
                      <td>
                        <EditableCell resource="countries" id={c.id} field="code" value={c.code} className="td-muted font-mono" />
                      </td>
                      <td>
                        <EditableCell resource="countries" id={c.id} field="default_currency_id" value={c.default_currency_id} type="currency-select" className="td-muted" />
                      </td>
                    </tr>
                ))}
                {countries.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted">No countries</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {/* ===== CURRENCIES TAB ===== */}
      {activeTab === 'currencies' && !currenciesLoading && (() => {
        const activeCount = currencies.filter(c => Number(c.is_active)).length;
        const q = currencySearch.toLowerCase().trim();
        const filtered = q
          ? sortedCurrencies.filter(c => c.code.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))
          : sortedCurrencies;
        return (
          <div className="card">
            <div className="card-header">
              <span className="card-title">{activeCount} of {currencies.length} active</span>
              <div className="flex items-center gap-2">
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search currencies..."
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    style={{ paddingLeft: 28, height: 32, fontSize: 13, width: 200 }}
                  />
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={refreshRates}
                  disabled={refreshingRates}
                >
                  <RefreshCw size={14} className={refreshingRates ? 'spin' : ''} />
                  {refreshingRates ? 'Refreshing...' : 'Refresh Rates'}
                </button>
              </div>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <SortableTh sortKey="is_active" current={currSortKey} dir={currSortDir} onSort={onCurrSort} style={{ width: 60 }}>Active</SortableTh>
                    <SortableTh sortKey="code" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Code</SortableTh>
                    <SortableTh sortKey="name" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Name</SortableTh>
                    <SortableTh sortKey="symbol" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Symbol</SortableTh>
                    <SortableTh sortKey="exchange_rate_to_base" current={currSortKey} dir={currSortDir} onSort={onCurrSort} style={{ textAlign: 'right' }}>Rate to Base</SortableTh>
                    <SortableTh sortKey="last_updated" current={currSortKey} dir={currSortDir} onSort={onCurrSort}>Updated</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} style={{ opacity: Number(c.is_active) ? 1 : 0.55 }}>
                      <td>
                        <button
                          className={`btn btn-ghost btn-sm btn-icon ${Number(c.is_active) ? 'text-success' : 'text-muted'}`}
                          title={Number(c.is_active) ? 'Click to deactivate' : 'Click to activate'}
                          onClick={() => toggleCurrencyActive(c)}
                          disabled={togglingCurrency === c.id}
                        >
                          {Number(c.is_active) ? <Check size={16} /> : <X size={16} />}
                        </button>
                      </td>
                      <td>
                        <EditableCell resource="currencies" id={c.id} field="code" value={c.code} className="font-medium font-mono" />
                      </td>
                      <td>
                        <EditableCell resource="currencies" id={c.id} field="name" value={c.name} />
                      </td>
                      <td>
                        <EditableCell resource="currencies" id={c.id} field="symbol" value={c.symbol} />
                      </td>
                      <td style={{ textAlign: 'right' }} className="font-mono">
                        {c.exchange_rate_to_base != null && Number(c.exchange_rate_to_base) !== 0
                          ? Number(c.exchange_rate_to_base).toFixed(6)
                          : '--'}
                      </td>
                      <td className="td-muted">
                        {c.last_updated ? new Date(c.last_updated + 'Z').toLocaleDateString() : '--'}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-muted">
                      {q ? 'No currencies match your search' : 'No currencies'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ===== EXCHANGES TAB ===== */}
      {activeTab === 'exchanges' && !exchangesLoading && (() => {
        const q = exchangeSearch.toLowerCase().trim();
        const filtered = q
          ? sortedExchanges.filter(e => e.name.toLowerCase().includes(q) || e.country_code.toLowerCase().includes(q) || (e.country_name || '').toLowerCase().includes(q))
          : sortedExchanges;
        return (
          <>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Exchanges ({exchangeList.length})</span>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search exchanges..."
                    value={exchangeSearch}
                    onChange={(e) => setExchangeSearch(e.target.value)}
                    style={{ paddingLeft: 28, height: 32, fontSize: 13, width: 200 }}
                  />
                </div>
              </div>
              {exchangeError && (
                <div className="alert alert-danger mb-3" style={{ margin: '0 16px' }}><AlertTriangle size={16} /><span>{exchangeError}</span></div>
              )}
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <SortableTh sortKey="country_code" current={exSortKey} dir={exSortDir} onSort={onExSort}>Country</SortableTh>
                      <SortableTh sortKey="name" current={exSortKey} dir={exSortDir} onSort={onExSort}>Exchange</SortableTh>
                      <SortableTh sortKey="suffix" current={exSortKey} dir={exSortDir} onSort={onExSort}>Suffix</SortableTh>
                      <SortableTh sortKey="display_order" current={exSortKey} dir={exSortDir} onSort={onExSort}>Order</SortableTh>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(ex => (
                      <tr key={ex.id}>
                        <td>
                          <EditableCell resource="exchanges" id={ex.id} field="country_code" value={ex.country_code} className="font-mono" />
                          {ex.country_name && <span className="td-muted" style={{ marginLeft: 6, fontSize: 12 }}>{ex.country_name}</span>}
                        </td>
                        <td>
                          <EditableCell resource="exchanges" id={ex.id} field="name" value={ex.name} className="font-medium" />
                        </td>
                        <td>
                          <EditableCell resource="exchanges" id={ex.id} field="suffix" value={ex.suffix} className="font-mono" />
                        </td>
                        <td>
                          <EditableCell resource="exchanges" id={ex.id} field="display_order" value={ex.display_order} />
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm btn-icon text-danger"
                            title="Delete"
                            onClick={() => deleteExchange(ex)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={5} className="text-center text-muted">
                        {q ? 'No exchanges match your search' : 'No exchanges'}
                      </td></tr>
                    )}
                    {/* Add new exchange row */}
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <td>
                        <input
                          className="form-control form-control-sm"
                          placeholder="CC"
                          value={exchangeForm.country_code}
                          onChange={e => setExchangeForm(p => ({ ...p, country_code: e.target.value }))}
                          style={{ width: 60 }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-control form-control-sm"
                          placeholder="Exchange name"
                          value={exchangeForm.name}
                          onChange={e => setExchangeForm(p => ({ ...p, name: e.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          className="form-control form-control-sm"
                          placeholder="Suffix"
                          value={exchangeForm.suffix}
                          onChange={e => setExchangeForm(p => ({ ...p, suffix: e.target.value }))}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-control form-control-sm"
                          type="number"
                          value={exchangeForm.display_order}
                          onChange={e => setExchangeForm(p => ({ ...p, display_order: e.target.value }))}
                          style={{ width: 60 }}
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={addExchange}
                          disabled={exchangeSaving}
                        >
                          <Plus size={14} /> {exchangeSaving ? 'Adding...' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ticker Price Cache */}
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">
                <span className="card-title"><Database size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Ticker Price Cache ({tickerCache.length})</span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={clearTickerCache}
                  disabled={clearingCache}
                >
                  <Trash2 size={14} /> {clearingCache ? 'Clearing...' : 'Clear Cache'}
                </button>
              </div>
              {tickerCacheLoading ? (
                <div className="loading-center" style={{ padding: 24 }}><div className="spinner" /></div>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Price</th>
                        <th>Currency</th>
                        <th>Exchange</th>
                        <th>Fetched At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickerCache.map(t => (
                        <tr key={t.ticker}>
                          <td className="font-medium font-mono">{t.ticker}</td>
                          <td className="font-mono">{Number(t.price).toFixed(2)}</td>
                          <td>{t.currency}</td>
                          <td className="td-muted">{t.exchange || '--'}</td>
                          <td className="td-muted">
                            {t.fetched_at ? new Date(t.fetched_at + 'Z').toLocaleString() : '--'}
                          </td>
                        </tr>
                      ))}
                      {tickerCache.length === 0 && (
                        <tr><td colSpan={5} className="text-center text-muted">No cached prices</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}
