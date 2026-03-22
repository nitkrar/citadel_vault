import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import Modal from '../components/Modal';
import SearchableSelect from '../components/SearchableSelect';
import { useAuth } from '../contexts/AuthContext';
import { useEncryption } from '../contexts/EncryptionContext';
import { useVaultEntries } from '../contexts/VaultDataContext';
import { VALID_ENTRY_TYPES } from '../lib/defaults';
import { apiData } from '../lib/checks';
import useCountries from '../hooks/useCountries';
import useCurrencies from '../hooks/useCurrencies';
import useTemplates from '../hooks/useTemplates';
import useAppConfig from '../hooks/useAppConfig';
import useExchanges from '../hooks/useExchanges';
import ImportModal from '../components/ImportModal';
import { useHideAmounts } from '../components/Layout';
import { usePlaidLink } from '../integrations/providers/plaid/PlaidConnect';
import { getIntegration, getIntegrationType, setIntegration, removeIntegration } from '../integrations/helpers';
import { getProvider, getProviderDisplayInfo } from '../integrations/modules';
import { extractValue, buildRateMap, convertCurrency } from '../lib/portfolioAggregator';
import {
  Plus, Edit2, Trash2, Search, Eye, EyeOff, Copy, Check, Lock,
  KeyRound, AlertTriangle, Undo2, X, ChevronDown, ChevronUp, Upload,
  Landmark, Briefcase, FileText, Shield, Layers, RefreshCw, Link2,
} from 'lucide-react';

const TYPE_META = {
  password:  { icon: KeyRound,  label: 'Passwords',  color: '#3b82f6' },
  account:   { icon: Landmark,  label: 'Accounts',   color: '#22c55e' },
  asset:     { icon: Briefcase, label: 'Assets',      color: '#f59e0b' },
  license:   { icon: FileText,  label: 'Licenses',    color: '#8b5cf6' },
  insurance: { icon: Shield,    label: 'Insurance',   color: '#ec4899' },
  custom:    { icon: Layers,    label: 'Custom',      color: '#06b6d4' },
};

// Tab display order (different from VALID_ENTRY_TYPES validation order)
const TAB_ORDER = ['account', 'asset', 'insurance', 'license', 'password', 'custom'];

// Types that get country/currency selectors
const TYPES_WITH_COUNTRY = ['account', 'asset', 'insurance', 'license'];

const MASKED = '••••••';
const MONETARY_KEYS = ['balance', 'value', 'current_value', 'purchase_price', 'face_value',
  'premium_amount', 'coverage_amount', 'cash_value', 'credit_limit', 'price_per_share'];

// Inline editable number field for linked asset values
function InlineNumberField({ label, value, currency, isEditing, editValue, saving, onStartEdit, onChange, onSave, onCancel, masked }) {
  const displayValue = masked ? MASKED : (value ? `${currency ? currency + ' ' : ''}${Number(value).toLocaleString()}` : '—');

  if (isEditing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="text-muted" style={{ fontSize: 11 }}>{label}:</span>
        <input
          type="number"
          className="form-control"
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } if (e.key === 'Escape') onCancel(); }}
          autoFocus
          disabled={saving}
          step="any"
          style={{ width: 110, height: 28, fontSize: 13, padding: '2px 6px' }}
        />
        <button className="btn btn-ghost btn-sm" onClick={onSave} disabled={saving} style={{ padding: '2px 4px' }}>
          <Check size={13} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} style={{ padding: '2px 4px' }}>
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <span
      onClick={onStartEdit}
      title={`Click to edit ${label}`}
      style={{
        fontSize: 13, cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
        border: '1px solid transparent', transition: 'border-color .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
    >
      <span className="text-muted" style={{ fontSize: 11 }}>{label}: </span>
      <span className="font-medium">{displayValue}</span>
      <Edit2 size={10} style={{ marginLeft: 4, opacity: 0.4, verticalAlign: -1 }} />
    </span>
  );
}

// Sortable table header
function SortTh({ sortKey: key, current, dir, onSort, style, children }) {
  const active = current === key;
  return (
    <th
      style={{ ...style, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(key)}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {children}
        {active
          ? (dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)
          : <ChevronDown size={13} style={{ opacity: 0.25 }} />
        }
      </span>
    </th>
  );
}


export default function VaultPage() {
  const { isUnlocked, encrypt, decrypt } = useEncryption();
  const { hideAmounts } = useHideAmounts();
  const { entries, decryptedCache, setDecryptedCache, loading, refetch, createEntry, updateEntry, deleteEntry, updateEntryLocal } = useVaultEntries();

  const [error, setError] = useState('');
  const { preferences } = useAuth();

  const { countries } = useCountries();
  const { currencies } = useCurrencies();
  const { templates } = useTemplates();
  const { config } = useAppConfig();
  const { exchanges } = useExchanges();

  // Ticker verification state
  const [tickerVerified, setTickerVerified] = useState(false);
  const [tickerResult, setTickerResult] = useState(null);
  const [tickerVerifying, setTickerVerifying] = useState(false);

  // Filters
  const [searchParams] = useSearchParams();
  const isValidTab = (t) => t && (VALID_ENTRY_TYPES.includes(t) || t === 'all');
  const userPref = preferences?.default_vault_tab;
  const siteDefault = config.default_vault_tab;
  const [activeType, setActiveType] = useState(() => {
    // Priority: query param > last tab (refresh) > rest deferred until loaded
    const t = searchParams.get('type');
    if (isValidTab(t)) return t;
    const lastTab = sessionStorage.getItem('pv_vault_last_tab');
    if (isValidTab(lastTab)) return lastTab;
    return ''; // placeholder until preferences/config load
  });
  // Apply user preference or site default once loaded
  useEffect(() => {
    if (activeType) return; // already set from query param or session
    if (isValidTab(userPref)) { setActiveType(userPref); return; }
    if (isValidTab(siteDefault)) { setActiveType(siteDefault); return; }
  }, [activeType, userPref, siteDefault]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('updated_at');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
  };

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deletedEntries, setDeletedEntries] = useState([]);

  // Form state
  const [form, setForm] = useState({});
  const [formType, setFormType] = useState('password');
  const [formTemplateId, setFormTemplateId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Secret field visibility toggles
  const [visibleSecrets, setVisibleSecrets] = useState({});

  // Post-save prompt for accounts (link/create assets)
  const [postSaveAccount, setPostSaveAccount] = useState(null); // entry object after save
  // Inline cash balance for account creation (Option B)
  const [inlineCashBalance, setInlineCashBalance] = useState('');
  // Inline editing of linked asset values
  const [inlineEditAsset, setInlineEditAsset] = useState(null); // { id, field, value }
  const [inlineEditSaving, setInlineEditSaving] = useState(false);

  // Plaid state
  const [integrationMsg, setPlaidMsg] = useState('');
  const [plaidLinkEntryId, setPlaidLinkEntryId] = useState(null); // entry id for "Link to Plaid" flow
  const [plaidAccountPicker, setPlaidAccountPicker] = useState(null); // { accounts, itemId, metadata, entryId }
  const [integrationRefreshing, setIntegrationRefreshing] = useState(false);
  const plaidEnabled = config?.plaid_enabled === 'true';

  // ── Plaid Connect Bank success handler ─────────────────────────────
  const handlePlaidConnectSuccess = useCallback(async ({ itemId, accounts, metadata }) => {
    const institutionName = metadata?.institution?.name || 'Bank';
    let created = 0;
    for (const acct of accounts) {
      try {
        const plaidMeta = {
          item_id: itemId,
          account_id: acct.account_id,
          institution_name: institutionName,
          account_name: acct.name,
          account_type: acct.type,
          account_subtype: acct.subtype,
          last_refreshed: new Date().toISOString(),
        };

        // Smart template mapping: match Plaid account type/subtype to Citadel template
        // Ref: https://plaid.com/docs/api/accounts/
        const plaidSubtype = acct.subtype || '';
        const plaidType = acct.type || '';
        const findAcctTpl = (subtype) => templates.find(t => t.template_key === 'account' && t.subtype === subtype && !t.owner_id);
        const genericAcctTpl = templates.find(t => t.template_key === 'account' && !t.owner_id && !t.country_code && !t.subtype);
        const RETIREMENT_SUBTYPES = ['401k', 'roth 401k', 'ira', 'roth', 'sep ira', 'simple ira', '403B', '457b',
          'pension', 'keogh', 'profit sharing plan', 'thrift savings plan', '401a', 'sarsep', 'lira', 'lif',
          'lrif', 'lrsp', 'rrsp', 'rrif', 'rdsp', 'resp', 'prif', 'rlif', 'tfsa', 'sipp'];

        let acctTpl;
        if (plaidType === 'credit') {
          acctTpl = findAcctTpl('credit_card') || genericAcctTpl;
        } else if (plaidSubtype === 'checking' || plaidSubtype === 'cash management') {
          acctTpl = findAcctTpl('checking') || genericAcctTpl;
        } else if (plaidSubtype === 'savings' || plaidSubtype === 'money market' || plaidSubtype === 'cd' || plaidSubtype === 'cash isa' || plaidSubtype === 'isa') {
          acctTpl = findAcctTpl('savings') || genericAcctTpl;
        } else if (plaidSubtype === 'prepaid' || plaidSubtype === 'ebt' || plaidSubtype === 'paypal') {
          acctTpl = findAcctTpl('wallet') || genericAcctTpl;
        } else if (RETIREMENT_SUBTYPES.includes(plaidSubtype)) {
          acctTpl = findAcctTpl('401k') || genericAcctTpl;
        } else if (plaidType === 'investment' || plaidSubtype === 'brokerage' || plaidSubtype === 'non-taxable brokerage account') {
          acctTpl = findAcctTpl('brokerage') || genericAcctTpl;
        } else {
          acctTpl = genericAcctTpl;
        }
        const isLiability = plaidType === 'credit' || plaidType === 'loan';

        const acctForm = setIntegration({
          title: `${acct.name} (${institutionName})`,
          institution: institutionName,
          currency: acct.currency,
        }, 'plaid', plaidMeta);
        const acctEntry = await createEntry('account', acctTpl?.id || null, acctForm);
        const acctId = acctEntry.id;

        // Create linked Cash asset (negative value for credit/liability)
        const cashTpl = templates.find(t => t.template_key === 'asset' && t.subtype === 'cash' && !t.owner_id);
        const balanceValue = isLiability ? -Math.abs(acct.balance || 0) : (acct.balance || 0);
        const cashForm = setIntegration({
          title: `${acct.name} — Balance`,
          linked_account_id: String(acctId),
          value: String(balanceValue),
          currency: acct.currency,
        }, 'plaid', plaidMeta);
        await createEntry('asset', cashTpl?.id || null, cashForm);
        created += 2;
      } catch {
        // continue with next account
      }
    }
    setPlaidMsg(`Created ${created} entries from ${institutionName}`);
    setTimeout(() => setPlaidMsg(''), 5000);
  }, [createEntry, templates]);

  // ── Plaid Link Existing Entry handler ───────────────────────────────
  const handlePlaidLinkExisting = useCallback(async ({ itemId, accounts, metadata }) => {
    if (!plaidLinkEntryId) return;
    setPlaidAccountPicker({ accounts, itemId, metadata, entryId: plaidLinkEntryId });
    setPlaidLinkEntryId(null);
  }, [plaidLinkEntryId]);

  const confirmPlaidLink = useCallback(async (account) => {
    if (!plaidAccountPicker) return;
    const { itemId, metadata, entryId } = plaidAccountPicker;
    const entry = entries.find(e => e.id === entryId);
    const d = decryptedCache[entryId];
    if (!entry || !d) return;

    const plaidMeta = {
      item_id: itemId,
      account_id: account.account_id,
      institution_name: metadata?.institution?.name || '',
      account_name: account.name,
      account_type: account.type,
      account_subtype: account.subtype,
      last_refreshed: new Date().toISOString(),
    };

    const updated = setIntegration({ ...d }, 'plaid', plaidMeta);
    try {
      await updateEntryLocal(entryId, updated);

      // Also update linked Cash asset balance if one exists
      const linkedAssets = entries.filter(e => {
        const ad = decryptedCache[e.id];
        return e.entry_type === 'asset' && ad && String(ad.linked_account_id) === String(entryId);
      });
      for (const asset of linkedAssets) {
        const ad = decryptedCache[asset.id];
        if (ad) {
          const updatedAsset = setIntegration({ ...ad, value: String(account.balance || 0) }, 'plaid', plaidMeta);
          await updateEntryLocal(asset.id, updatedAsset);
        }
      }

      setPlaidMsg('Linked to Plaid successfully');
      setTimeout(() => setPlaidMsg(''), 5000);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to link to Plaid');
    }
    setPlaidAccountPicker(null);
  }, [plaidAccountPicker, entries, decryptedCache, updateEntryLocal]);

  // Plaid hooks — one for connect, one for link existing
  const { open: openPlaidConnect, loading: plaidConnectLoading, error: plaidConnectError } =
    usePlaidLink({ onSuccess: handlePlaidConnectSuccess });
  const { open: openPlaidLinkExisting, loading: plaidLinkLoading, error: plaidLinkError } =
    usePlaidLink({ onSuccess: handlePlaidLinkExisting });

  // ── Formatted options for SearchableSelect ─────────────────────────
  const countryOptions = useMemo(() =>
    countries.map(c => ({
      value: c.code,
      label: `${c.flag_emoji || ''} ${c.name}`.trim(),
    })),
    [countries]
  );

  const currencyOptions = useMemo(() =>
    currencies.map(c => ({
      value: c.code,
      label: `${c.code} — ${c.symbol} ${c.name}`,
    })),
    [currencies]
  );

  // Build a map: country_code → default currency_code
  const countryToCurrency = useMemo(() => {
    const map = {};
    // Prefer default_currency_code from API (JOIN), fallback to ID lookup
    const currById = {};
    for (const cu of currencies) {
      currById[Number(cu.id)] = cu.code;
    }
    for (const c of countries) {
      if (c.default_currency_code) {
        map[c.code] = c.default_currency_code;
      } else if (c.default_currency_id) {
        const code = currById[Number(c.default_currency_id)];
        if (code) map[c.code] = code;
      }
    }
    return map;
  }, [countries, currencies]);

  // Account entries for the linked account selector
  const accountOptions = useMemo(() =>
    entries
      .filter(e => e.entry_type === 'account')
      .map(e => {
        const d = decryptedCache[e.id];
        const title = d?.title || '(encrypted)';
        const inst = d?.institution ? ` — ${d.institution}` : '';
        return { value: String(e.id), label: `${title}${inst}` };
      }),
    [entries, decryptedCache]
  );

  // ── Display currency + rate map for amount display ──────────────
  const defaultCurrency = config?.base_currency || 'GBP';
  const [displayCurrency, setDisplayCurrency] = useState(defaultCurrency);
  useEffect(() => { if (defaultCurrency && !displayCurrency) setDisplayCurrency(defaultCurrency); }, [defaultCurrency]);
  const baseCurrency = displayCurrency || defaultCurrency;
  const rateMap = useMemo(() => buildRateMap(currencies), [currencies]);
  const baseCurrencySymbol = useMemo(() => {
    const c = currencies.find(cu => cu.code === baseCurrency);
    return c?.symbol || '';
  }, [currencies, baseCurrency]);

  // ── Get template fields for an entry ─────────────────────────────
  const getTemplateFields = (entry) => {
    if (entry.template?.fields) return entry.template.fields;
    const tpl = templates.find(t => t.id === entry.template_id);
    return tpl?.fields || [];
  };

  // Raw numeric amount in base currency (used by sort + display)
  const getEntryAmountRaw = (entry, d) => {
    if (!d) return 0;
    if (entry.entry_type === 'account') {
      let total = 0;
      for (const e of entries) {
        if (e.entry_type !== 'asset') continue;
        const ad = decryptedCache[e.id];
        if (!ad || String(ad.linked_account_id) !== String(entry.id)) continue;
        const f = getTemplateFields(e);
        const p = typeof f === 'string' ? JSON.parse(f) : f;
        const raw = extractValue(ad, p);
        if (raw) total += convertCurrency(raw, ad.currency || baseCurrency, baseCurrency, rateMap);
      }
      return total;
    }
    const f = getTemplateFields(entry);
    const p = typeof f === 'string' ? JSON.parse(f) : f;
    const raw = extractValue(d, p);
    return raw ? convertCurrency(raw, d.currency || baseCurrency, baseCurrency, rateMap) : 0;
  };

  // Formatted display string
  const getEntryAmount = (entry, d) => {
    if (!d) return '';
    const val = getEntryAmountRaw(entry, d);
    if (val === 0) return '';
    if (hideAmounts) return MASKED;
    return `${baseCurrencySymbol}${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  // ── Filtering + Sorting ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = entries;
    if (activeType && activeType !== 'all') list = list.filter(e => e.entry_type === activeType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => {
        const d = decryptedCache[e.id];
        if (!d) return false;
        return Object.values(d).some(v => typeof v === 'string' && v.toLowerCase().includes(q));
      });
    }
    // Sort
    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      const da = decryptedCache[a.id];
      const db = decryptedCache[b.id];
      let va, vb;
      switch (sortKey) {
        case 'title':    va = da?.title || ''; vb = db?.title || ''; break;
        case 'amount':   va = getEntryAmountRaw(a, da); vb = getEntryAmountRaw(b, db); break;
        case 'currency': va = da?.currency || ''; vb = db?.currency || ''; break;
        default:         va = a.updated_at || ''; vb = b.updated_at || '';
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
      return sa < sb ? -dir : sa > sb ? dir : 0;
    });
    return list;
  }, [entries, activeType, search, decryptedCache, sortKey, sortDir, baseCurrency, rateMap]);

  // ── Counts ───────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: entries.length };
    VALID_ENTRY_TYPES.forEach(t => { c[t] = entries.filter(e => e.entry_type === t).length; });
    return c;
  }, [entries]);



  // ── Check if current form requires currency/country ─────────────
  const formRequiresCurrency = () => {
    if (!TYPES_WITH_COUNTRY.includes(formType)) return false;
    const fields = getFormFields();
    return fields.some(f => MONETARY_KEYS.includes(f.key) || (f.type === 'number' && f.key !== 'year' && f.key !== 'seats' && f.key !== 'shares' && f.key !== 'quantity'));
  };

  // ── CRUD Operations ──────────────────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.title?.trim()) { setFormError('Title is required.'); return; }
    if (formRequiresCurrency()) {
      if (!form.currency) { setFormError('Currency is required.'); return; }
      if (!form.country) { setFormError('Country is required.'); return; }
    }

    // Auto-verify ticker if stock/crypto and not yet verified
    const subtype = getCurrentSubtype();
    const tickerField = subtype === 'crypto' ? 'coin' : 'ticker';
    if ((subtype === 'stock' || subtype === 'crypto') && form[tickerField]?.trim() && !tickerVerified) {
      setTickerVerifying(true);
      try {
        const { data: resp } = await api.post('/prices.php', { tickers: [form[tickerField].trim()] });
        const result = apiData({ data: resp });
        const priceData = result?.prices?.[form[tickerField].trim()];
        const errorMsg = result?.errors?.[form[tickerField].trim()];
        if (!priceData) {
          setTickerResult({ success: false, error: errorMsg || 'Ticker not found' });
          setTickerVerifying(false);
          setFormError('Ticker verification failed. Please check the ticker symbol.');
          return;
        }
        setTickerResult({ success: true, ...priceData });
        setTickerVerified(true);
        const priceKey = subtype === 'crypto' ? 'price_per_unit' : 'price_per_share';
        setForm(f => ({ ...f, [priceKey]: String(priceData.price), currency: priceData.currency }));
      } catch {
        setTickerVerifying(false);
        setFormError('Ticker verification failed. Try again or remove the ticker.');
        return;
      } finally {
        setTickerVerifying(false);
      }
    }

    setSaving(true);
    try {
      const newEntry = await createEntry(formType, formTemplateId, form);
      const newId = newEntry.id;
      const savedForm = { ...form };
      const savedType = formType;
      setShowAdd(false);
      setForm({});
      // If inline balance was provided (Option B), auto-create Cash asset
      if (savedType === 'account' && inlineCashBalance && parseFloat(inlineCashBalance) > 0) {
        try {
          await autoCreateCashAsset(newEntry, inlineCashBalance, savedForm);
        } catch {
          // Cash asset failed but account was saved — don't block
        }
        setInlineCashBalance('');
      } else if (savedType === 'account') {
        // No inline balance — show post-save modal (Option A)
        setPostSaveAccount(newEntry);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to create.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.title?.trim()) { setFormError('Title is required.'); return; }
    if (formRequiresCurrency()) {
      if (!form.currency) { setFormError('Currency is required.'); return; }
      if (!form.country) { setFormError('Country is required.'); return; }
    }

    // Auto-verify ticker if stock/crypto and not yet verified
    const subtype = getCurrentSubtype();
    const tickerField = subtype === 'crypto' ? 'coin' : 'ticker';
    if ((subtype === 'stock' || subtype === 'crypto') && form[tickerField]?.trim() && !tickerVerified) {
      setTickerVerifying(true);
      try {
        const { data: resp } = await api.post('/prices.php', { tickers: [form[tickerField].trim()] });
        const result = apiData({ data: resp });
        const priceData = result?.prices?.[form[tickerField].trim()];
        const errorMsg = result?.errors?.[form[tickerField].trim()];
        if (!priceData) {
          setTickerResult({ success: false, error: errorMsg || 'Ticker not found' });
          setTickerVerifying(false);
          setFormError('Ticker verification failed. Please check the ticker symbol.');
          return;
        }
        setTickerResult({ success: true, ...priceData });
        setTickerVerified(true);
        const priceKey = subtype === 'crypto' ? 'price_per_unit' : 'price_per_share';
        setForm(f => ({ ...f, [priceKey]: String(priceData.price), currency: priceData.currency }));
      } catch {
        setTickerVerifying(false);
        setFormError('Ticker verification failed. Try again or remove the ticker.');
        return;
      } finally {
        setTickerVerifying(false);
      }
    }

    setSaving(true);
    try {
      const blob = await encrypt(form);
      const savedType = formType;
      const updated = await updateEntry(editEntry, blob, { ...form }, {
        allowTemplateChange: true,
        newEntryType: formType,
        newTemplateId: formTemplateId,
      });
      setEditEntry(null);
      setForm({});
      // Prompt to link/create assets after updating an account
      if (savedType === 'account') {
        setPostSaveAccount(updated);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete "${decryptedCache[entry.id]?.title || 'this entry'}"? It will be recoverable for 24 hours.`)) return;
    try {
      await deleteEntry(entry);
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed.');
    }
  };

  const loadDeleted = async () => {
    try {
      const { data: resp } = await api.get('/vault.php?action=deleted');
      const raw = apiData({ data: resp }) || [];
      // Decrypt deleted entries
      const decrypted = [];
      for (const entry of raw) {
        try {
          const d = await decrypt(entry.encrypted_data);
          decrypted.push({ ...entry, _decrypted: d });
        } catch {
          decrypted.push({ ...entry, _decrypted: null });
        }
      }
      setDeletedEntries(decrypted);
      setShowDeleted(true);
    } catch {}
  };

  const handleRestore = async (entry) => {
    try {
      await api.post(`/vault.php?action=restore&id=${entry.id}`);
      setDeletedEntries(prev => prev.filter(e => e.id !== entry.id));
      refetch();
    } catch (err) {
      alert(err.response?.data?.error || 'Restore failed.');
    }
  };

  // ── Find assets linked to a given account ───────────────────────
  const getLinkedAssets = useCallback((accountId) => {
    return entries.filter(e => {
      if (e.entry_type !== 'asset') return false;
      const d = decryptedCache[e.id];
      return d && String(d.linked_account_id) === String(accountId);
    });
  }, [entries, decryptedCache]);

  // ── Link an existing asset to an account (re-encrypt with new linked_account_id)
  const linkAssetToAccount = async (assetEntry, accountId) => {
    const d = decryptedCache[assetEntry.id];
    if (!d) return;
    const updated = { ...d, linked_account_id: String(accountId) };
    try {
      await updateEntryLocal(assetEntry.id, updated);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to link asset.');
    }
  };

  // ── Open add-asset modal pre-linked to an account ─────────────
  const openAddLinkedAsset = (accountEntry) => {
    const acctData = decryptedCache[accountEntry.id];
    setFormType('asset');
    const tpl = templates.find(t => t.template_key === 'asset' && !t.owner_id && !t.country_code && !t.subtype);
    setFormTemplateId(tpl?.id || null);
    const newForm = { title: '', linked_account_id: String(accountEntry.id) };
    if (acctData?.country) newForm.country = acctData.country;
    if (acctData?.currency) newForm.currency = acctData.currency;
    setForm(newForm);
    setShowAdd(true);
    setFormError('');
    setViewEntry(null);
  };

  // ── Open add-cash-asset modal pre-linked to an account (Option A) ──
  const openAddCashAsset = (accountEntry) => {
    const acctData = decryptedCache[accountEntry.id];
    setFormType('asset');
    const cashTpl = templates.find(t => t.template_key === 'asset' && t.subtype === 'cash' && !t.owner_id);
    setFormTemplateId(cashTpl?.id || null);
    const newForm = {
      title: `${acctData?.title || 'Account'} — Cash`,
      linked_account_id: String(accountEntry.id),
    };
    if (acctData?.country) newForm.country = acctData.country;
    if (acctData?.currency) newForm.currency = acctData.currency;
    setForm(newForm);
    setShowAdd(true);
    setFormError('');
    setPostSaveAccount(null);
  };

  // ── Auto-create a Cash asset linked to an account (Option B) ──
  const autoCreateCashAsset = async (accountEntry, balance, acctData) => {
    const cashTpl = templates.find(t => t.template_key === 'asset' && t.subtype === 'cash' && !t.owner_id);
    const cashForm = {
      title: `${acctData?.title || 'Account'} — Cash`,
      linked_account_id: String(accountEntry.id),
      value: balance,
    };
    if (acctData?.country) cashForm.country = acctData.country;
    if (acctData?.currency) cashForm.currency = acctData.currency;

    await createEntry('asset', cashTpl?.id || null, cashForm);
  };

  // ── Inline edit a linked asset field ────────────────────────────
  const saveInlineAssetEdit = async (assetEntry, fieldKey, newValue) => {
    const d = decryptedCache[assetEntry.id];
    if (!d) return;
    const updated = { ...d, [fieldKey]: newValue };
    setInlineEditSaving(true);
    try {
      await updateEntryLocal(assetEntry.id, updated);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update.');
    } finally {
      setInlineEditSaving(false);
      setInlineEditAsset(null);
    }
  };

  // ── Open edit modal ──────────────────────────────────────────────
  const openEdit = (entry) => {
    const d = decryptedCache[entry.id];
    if (!d) return;
    setForm({ ...d });
    setFormType(entry.entry_type);
    setFormTemplateId(entry.template_id);
    setEditEntry(entry);
    setFormError('');
  };

  const openAdd = (type = 'password') => {
    setFormType(type);
    const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
    setFormTemplateId(tpl?.id || null);
    setForm({ title: '' });
    setShowAdd(true);
    setFormError('');
  };

  // ── Handle template selection (with country pre-population) ────────
  const handleTemplateChange = (templateId) => {
    setFormTemplateId(templateId);
    setTickerVerified(false);
    setTickerResult(null);
    const newForm = { title: form.title || '' };
    if (form.linked_account_id) newForm.linked_account_id = form.linked_account_id;
    if (form.country) newForm.country = form.country;
    if (form.currency) newForm.currency = form.currency;
    if (templateId) {
      const tpl = templates.find(t => t.id === templateId);
      if (tpl?.country_code) {
        newForm.country = tpl.country_code;
        const defCur = countryToCurrency[tpl.country_code];
        if (defCur) newForm.currency = defCur;
      }
    }
    setForm(newForm);
  };

  // ── Handle country change (always update default currency) ──────────
  const handleCountryChange = (code) => {
    setForm(f => {
      const updated = { ...f, country: code };
      if (code && countryToCurrency[code]) {
        updated.currency = countryToCurrency[code];
      }
      return updated;
    });
  };

  // ── Handle linked account change (pre-fill country + currency) ─────
  const handleLinkedAccountChange = (accountId) => {
    setForm(f => {
      const updated = { ...f, linked_account_id: accountId };
      if (accountId) {
        const entry = entries.find(e => String(e.id) === accountId);
        if (entry) {
          const d = decryptedCache[entry.id];
          if (d) {
            if (d.country && !f.country) updated.country = d.country;
            if (d.currency && !f.currency) updated.currency = d.currency;
          }
        }
      }
      return updated;
    });
  };

  // ── Template-driven form rendering ───────────────────────────────
  const renderFormFields = (fields) => {
    if (!fields || fields.length === 0) {
      return (
        <>
          <div className="form-group">
            <label className="form-label">Title <span className="required">*</span></label>
            <input className="form-control" value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={3} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </>
      );
    }

    // Inject country + currency fields for types that support them
    let augmentedFields = [...fields];
    if (TYPES_WITH_COUNTRY.includes(formType)) {
      // Check if template has monetary fields (balance, value, price, etc.)
      const hasMonetaryField = augmentedFields.some(f => MONETARY_KEYS.includes(f.key) || (f.type === 'number' && f.key !== 'year' && f.key !== 'seats' && f.key !== 'shares' && f.key !== 'quantity'));
      const hasCurrency = augmentedFields.some(f => f.key === 'currency');
      const hasCountry = augmentedFields.some(f => f.key === 'country');

      // If template lacks currency field, inject it before notes (or at end)
      if (!hasCurrency) {
        const notesIdx = augmentedFields.findIndex(f => f.key === 'notes');
        const insertAt = notesIdx !== -1 ? notesIdx : augmentedFields.length;
        augmentedFields.splice(insertAt, 0, { key: 'currency', label: 'Currency', type: 'text', required: hasMonetaryField });
      } else if (hasMonetaryField) {
        // Upgrade existing currency field to required
        augmentedFields = augmentedFields.map(f => f.key === 'currency' ? { ...f, required: true } : f);
      }

      // Inject country before currency (required when currency is required)
      if (!hasCountry) {
        const currencyIdx = augmentedFields.findIndex(f => f.key === 'currency');
        if (currencyIdx !== -1) {
          augmentedFields.splice(currencyIdx, 0, { key: 'country', label: 'Country', type: 'country', required: hasMonetaryField });
        }
      }
    }

    return augmentedFields.map(field => (
      <div className="form-group" key={field.key}>
        <label className="form-label">
          {field.label} {field.required && <span className="required">*</span>}
        </label>
        {renderFieldInput(field)}
      </div>
    ));
  };

  // ── Ticker verification ──────────────────────────────────────────
  const verifyTicker = async (tickerValue) => {
    if (!tickerValue?.trim()) return;
    setTickerVerifying(true);
    setTickerResult(null);
    try {
      const { data: resp } = await api.post('/prices.php', { tickers: [tickerValue.trim()] });
      const result = apiData({ data: resp });
      const priceData = result?.prices?.[tickerValue.trim()];
      const errorMsg = result?.errors?.[tickerValue.trim()];
      if (priceData) {
        setTickerResult({ success: true, ...priceData });
        setTickerVerified(true);
        // Auto-fill price and currency in form
        const currentTpl = formTemplateId ? templates.find(t => t.id === formTemplateId) : null;
        const subtype = currentTpl?.subtype;
        const priceKey = subtype === 'crypto' ? 'price_per_unit' : 'price_per_share';
        setForm(f => ({
          ...f,
          [priceKey]: String(priceData.price),
          currency: priceData.currency,
        }));
      } else {
        setTickerResult({ success: false, error: errorMsg || 'Ticker not found' });
      }
    } catch (err) {
      setTickerResult({ success: false, error: err.response?.data?.error || 'Verification failed' });
    } finally {
      setTickerVerifying(false);
    }
  };

  // Get current template subtype for ticker-related logic
  const getCurrentSubtype = () => {
    if (formTemplateId) {
      const tpl = templates.find(t => t.id === formTemplateId);
      return tpl?.subtype || null;
    }
    return null;
  };

  // ── Render individual field input ──────────────────────────────────
  const renderFieldInput = (field) => {
    // Country selector
    if (field.key === 'country' || field.type === 'country') {
      return (
        <SearchableSelect
          options={countryOptions}
          value={form.country || ''}
          onChange={handleCountryChange}
          placeholder="Select country..."
        />
      );
    }

    // Currency selector
    if (field.key === 'currency') {
      return (
        <SearchableSelect
          options={currencyOptions}
          value={form.currency || ''}
          onChange={val => setForm(f => ({ ...f, currency: val }))}
          placeholder="Select currency..."
        />
      );
    }

    // Linked account selector
    if (field.type === 'account_link') {
      return (
        <SearchableSelect
          options={accountOptions}
          value={form.linked_account_id || ''}
          onChange={handleLinkedAccountChange}
          placeholder="Link to an account..."
        />
      );
    }

    if (field.type === 'textarea') {
      return (
        <textarea className="form-control" rows={3} value={form[field.key] || ''}
          onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
      );
    }

    if (field.type === 'secret') {
      const isVisible = visibleSecrets[field.key];
      return (
        <div className="flex gap-1">
          <input className="form-control" type={isVisible ? 'text' : 'password'} value={form[field.key] || ''}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} style={{ flex: 1 }} />
          <button type="button" className="btn btn-secondary btn-icon"
            onClick={() => setVisibleSecrets(v => ({ ...v, [field.key]: !v[field.key] }))} title={isVisible ? 'Hide' : 'Show'}>
            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      );
    }

    if (field.type === 'date') {
      return (
        <input className="form-control" type="date" value={form[field.key] || ''}
          onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
      );
    }

    if (field.type === 'number') {
      return (
        <input className="form-control" type="number" step="any" value={form[field.key] || ''}
          onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
      );
    }

    if (field.type === 'url') {
      return (
        <input className="form-control" type="url" value={form[field.key] || ''} placeholder="https://..."
          onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
      );
    }

    // Ticker/coin field with verify button and exchange hints
    if (field.key === 'ticker' || field.key === 'coin') {
      const countryExchanges = form.country
        ? exchanges.filter(ex => ex.country_code === form.country)
        : [];
      return (
        <div>
          <div className="flex gap-1">
            <input
              className="form-control"
              type="text"
              value={form[field.key] || ''}
              onChange={e => {
                setForm(f => ({ ...f, [field.key]: e.target.value }));
                setTickerVerified(false);
                setTickerResult(null);
              }}
              placeholder={field.key === 'coin' ? 'e.g. BTC-USD, ETH-USD' : countryExchanges.length > 0 && countryExchanges[0].suffix ? `e.g. SYMBOL.${countryExchanges[0].suffix}` : 'e.g. AAPL, MSFT, TSLA'}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={tickerVerifying || !form[field.key]?.trim()}
              onClick={() => verifyTicker(form[field.key])}
              style={{ whiteSpace: 'nowrap' }}
            >
              {tickerVerifying ? <><RefreshCw size={13} className="spin" /> Verifying...</> : 'Verify'}
            </button>
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
            {field.key === 'coin'
              ? 'Use Yahoo Finance ticker format: BTC-USD, ETH-USD, SOL-USD'
              : countryExchanges.length > 0
                ? <>Add suffix for this market: {countryExchanges.map(ex =>
                    ex.suffix ? <strong key={ex.name}>.{ex.suffix}</strong> : <span key={ex.name}>{ex.name} (no suffix)</span>
                  ).reduce((prev, curr, i) => i === 0 ? [curr] : [...prev, ', ', curr], [])}
                  {' — '}e.g. {countryExchanges[0].suffix ? `SYMBOL.${countryExchanges[0].suffix}` : 'SYMBOL'}
                </>
                : 'Use Yahoo Finance ticker. US stocks: AAPL, META. Other markets add suffix: HDFCBANK.NS (India), BARC.L (UK)'
            }
          </div>
          {tickerResult && (
            <div style={{
              marginTop: 6, padding: '6px 10px', borderRadius: 6, fontSize: 12,
              background: tickerResult.success ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-danger-bg, #fee2e2)',
              color: tickerResult.success ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)',
              border: `1px solid ${tickerResult.success ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)'}`,
              opacity: 0.9,
            }}>
              {tickerResult.success
                ? <><Check size={12} style={{ verticalAlign: -2, marginRight: 4 }} />{tickerResult.name} — {tickerResult.currency} {tickerResult.price} ({tickerResult.exchange})</>
                : tickerResult.error
              }
            </div>
          )}
        </div>
      );
    }

    return (
      <input className="form-control" type="text" value={form[field.key] || ''}
        onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
    );
  };

  // ── Get fields for current form type ─────────────────────────────
  const getFormFields = () => {
    if (formTemplateId) {
      const tpl = templates.find(t => t.id === formTemplateId);
      if (tpl?.fields) return typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields;
    }
    if (editEntry) return getTemplateFields(editEntry);
    return [];
  };

  // ── Type/template selector (shared between add and edit modals) ────
  const renderTypeAndTemplateSelectors = () => (
    <>
      <div className="form-group">
        <label className="form-label">Entry Type</label>
        <select className="form-control" value={formType} onChange={e => {
          const type = e.target.value;
          setFormType(type);
          const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
          setFormTemplateId(tpl?.id || null);
          setForm({ title: form.title || '' });
          setTickerVerified(false);
          setTickerResult(null);
        }}>
          {VALID_ENTRY_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
        </select>
      </div>
      {(() => {
        const subtypes = templates.filter(t => t.template_key === formType && !t.owner_id && (t.subtype || t.country_code));
        if (subtypes.length === 0) return null;
        return (
          <div className="form-group">
            <label className="form-label">Template</label>
            <select className="form-control" value={formTemplateId || ''} onChange={e => {
              const id = e.target.value ? parseInt(e.target.value) : null;
              handleTemplateChange(id);
            }}>
              <option value="">Generic</option>
              {subtypes.map(t => <option key={t.id} value={t.id}>{t.name}{t.country_code ? ` (${t.country_code})` : ''}</option>)}
            </select>
          </div>
        );
      })()}
    </>
  );

  // ── Vault locked state ───────────────────────────────────────────
  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>Unlock your vault to access your data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vault</h1>
          <p className="page-subtitle">All your encrypted entries in one place</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-ghost btn-sm" onClick={loadDeleted}><Undo2 size={14} /> Recently Deleted</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)}><Upload size={14} /> Import</button>
          {(() => {
            const plaidItemIds = plaidEnabled ? [...new Set(
              entries.map(e => {
                const d = decryptedCache[e.id];
                return getIntegration(d, getIntegrationType(d))?.item_id;
              }).filter(Boolean)
            )] : [];
            const hasTickers = entries.some(e => {
              const d = decryptedCache[e.id];
              const tpl = templates.find(t => t.id === e.template_id) || e.template;
              return (tpl?.subtype === 'stock' && d?.ticker) || (tpl?.subtype === 'crypto' && d?.coin);
            });
            const canRefresh = plaidItemIds.length > 0 || hasTickers;
            return (
              <>
                {canRefresh && (
                  <button className="btn btn-secondary btn-sm" disabled={integrationRefreshing}
                    onClick={async () => {
                      const results = [];
                      const promises = [];
                      // Refresh prices
                      if (hasTickers) {
                        const tickers = [];
                        for (const e of entries) {
                          const d = decryptedCache[e.id];
                          const tpl = templates.find(t => t.id === e.template_id) || e.template;
                          if (tpl?.subtype === 'stock' && d?.ticker) tickers.push(d.ticker);
                          else if (tpl?.subtype === 'crypto' && d?.coin) tickers.push(d.coin);
                        }
                        if (tickers.length > 0) {
                          promises.push(
                            api.post('/prices.php', { tickers: [...new Set(tickers)] })
                              .then(async ({ data: resp }) => {
                                const priceResult = apiData({ data: resp });
                                const prices = priceResult?.prices || {};
                                let priceCount = 0;
                                for (const e of entries) {
                                  const d = decryptedCache[e.id];
                                  const tpl = templates.find(t => t.id === e.template_id) || e.template;
                                  const ticker = tpl?.subtype === 'crypto' ? d?.coin : d?.ticker;
                                  if (!ticker || !prices[ticker]) continue;
                                  const priceKey = tpl?.subtype === 'crypto' ? 'price_per_unit' : 'price_per_share';
                                  const updated = { ...d, [priceKey]: String(prices[ticker].price), currency: prices[ticker].currency };
                                  await updateEntryLocal(e.id, updated);
                                  priceCount++;
                                }
                                if (priceCount > 0) results.push(`${priceCount} price${priceCount !== 1 ? 's' : ''}`);
                              })
                              .catch(() => results.push('prices failed'))
                          );
                        }
                      }
                      // Refresh balances
                      if (plaidItemIds.length > 0) {
                        const provider = getProvider('plaid');
                        if (!provider) { results.push('integration not available'); }
                        else {
                        setIntegrationRefreshing(true);
                        promises.push(
                          provider.refresh(plaidItemIds, entries, decryptedCache, encrypt,
                            (id, data) => setDecryptedCache(prev => ({ ...prev, [id]: data })))
                            .then(({ updated }) => { if (updated > 0) results.push(`${updated} balance${updated !== 1 ? 's' : ''}`); })
                            .catch(() => results.push('balances failed'))
                            .finally(() => setIntegrationRefreshing(false))
                        );
                        }
                      }
                      await Promise.all(promises);
                      setPlaidMsg(results.length > 0 ? `Refreshed ${results.join(', ')}` : 'Everything up to date');
                      setTimeout(() => setPlaidMsg(''), 3000);
                    }}>
                    <RefreshCw size={14} className={integrationRefreshing ? 'spin' : ''} /> {integrationRefreshing ? 'Refreshing...' : 'Refresh All'}
                  </button>
                )}
                {plaidEnabled && (
                  <button className="btn btn-secondary" onClick={openPlaidConnect} disabled={plaidConnectLoading}>
                    <Landmark size={14} /> {plaidConnectLoading ? 'Connecting...' : 'Connect Bank'}
                  </button>
                )}
              </>
            );
          })()}
          <button className="btn btn-primary" onClick={() => openAdd(activeType !== 'all' ? activeType : 'password')}><Plus size={16} /> New Entry</button>
        </div>
      </div>

      {/* Type filter tabs */}
      <div className="vault-type-filters flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${!activeType || activeType === 'all' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setActiveType('all'); sessionStorage.setItem('pv_vault_last_tab', 'all'); }}>
          All <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts.all}</span>
        </button>
        {TAB_ORDER.map(type => {
          const meta = TYPE_META[type];
          const Icon = meta?.icon || Layers;
          return (
            <button key={type} className={`btn btn-sm ${activeType === type ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setActiveType(type); sessionStorage.setItem('pv_vault_last_tab', type); }}>
              <Icon size={14} /> {meta?.label || type}
              {counts[type] > 0 && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts[type]}</span>}
            </button>
          );
        })}
      </div>

      {/* Search + currency selector */}
      <div className="flex gap-3 mb-4 items-center" style={{ flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="form-control" style={{ paddingLeft: 36 }} placeholder="Search across all fields..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {currencies.length > 0 && (
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 90, padding: '4px 30px 4px 8px', fontSize: 13 }}
            value={baseCurrency}
            onChange={e => setDisplayCurrency(e.target.value)}
          >
            {currencies.filter(c => c.is_active === 1 || c.is_active === '1' || c.is_active === true).map(c => (
              <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
            ))}
          </select>
        )}
      </div>

      {/* Plaid messages */}
      {integrationMsg && <div className="alert alert-success mb-3"><Check size={16} /><span>{integrationMsg}</span></div>}
      {(plaidConnectError || plaidLinkError) && <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{plaidConnectError || plaidLinkError}</span></div>}

      {/* Content */}
      {error ? (
        <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{error}</span></div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{activeType !== 'all' ? (() => { const Icon = TYPE_META[activeType]?.icon || Layers; return <Icon size={40} />; })() : <KeyRound size={40} />}</div>
          <h3>{search ? 'No results' : `No ${activeType !== 'all' ? TYPE_META[activeType]?.label?.toLowerCase() || 'entries' : 'entries'} yet`}</h3>
          <p>{search ? 'Try a different search.' : 'Add your first entry to get started.'}</p>
          {!search && <button className="btn btn-primary mt-3" onClick={() => openAdd(activeType !== 'all' ? activeType : 'password')}><Plus size={16} /> Add {activeType !== 'all' ? TYPE_META[activeType]?.label?.replace(/s$/, '') : 'Entry'}</button>}
        </div>
      ) : (
        <div className="card">
          {activeType !== 'all' && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="text-muted" style={{ fontSize: 13 }}>{filtered.length} {TYPE_META[activeType]?.label?.toLowerCase() || 'entries'}</span>
              <button className="btn btn-primary btn-sm" onClick={() => openAdd(activeType)}><Plus size={14} /> Add {TYPE_META[activeType]?.label?.replace(/s$/, '') || 'Entry'}</button>
            </div>
          )}

          {/* Desktop table view */}
          <div className="vault-table-desktop">
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Type</th>
                    <SortTh sortKey="title" current={sortKey} dir={sortDir} onSort={toggleSort}>Title</SortTh>
                    <th>Details</th>
                    <SortTh sortKey="amount" current={sortKey} dir={sortDir} onSort={toggleSort} style={{ width: 130, textAlign: 'right' }}>Amount ({baseCurrency})</SortTh>
                    <SortTh sortKey="currency" current={sortKey} dir={sortDir} onSort={toggleSort} style={{ width: 70 }}>Currency</SortTh>
                    <SortTh sortKey="updated_at" current={sortKey} dir={sortDir} onSort={toggleSort} style={{ width: 140 }}>Updated</SortTh>
                    <th style={{ width: 100, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(entry => {
                    const d = decryptedCache[entry.id];
                    const meta = TYPE_META[entry.entry_type] || TYPE_META.custom;
                    const Icon = meta.icon;
                    const title = d?.title || '(encrypted)';
                    const fields = getTemplateFields(entry);
                    const detailField = fields.find(f => f.key !== 'title' && f.key !== 'notes' && f.key !== 'linked_account_id' && f.key !== 'currency' && f.key !== 'country' && f.type !== 'textarea' && f.type !== 'secret' && f.type !== 'account_link' && f.type !== 'number' && d?.[f.key]);
                    const detail = detailField ? d[detailField.key] : '';
                    const amount = getEntryAmount(entry, d);
                    const tpl = templates.find(t => t.id === entry.template_id) || entry.template;
                    const subtype = tpl?.subtype;
                    const integrationId = getIntegrationType(d);
                    const hasIntegration = !!integrationId;
                    const hasTicker = (subtype === 'stock' && d?.ticker) || (subtype === 'crypto' && d?.coin);
                    const canRefresh = hasIntegration || hasTicker;
                    const integrationInfo = integrationId ? getProviderDisplayInfo(integrationId, getIntegration(d, integrationId)) : null;
                    return (
                      <tr key={entry.id} style={{ cursor: 'pointer' }} onClick={() => { setViewEntry(entry); }}>
                        <td><Icon size={16} style={{ color: meta.color }} /></td>
                        <td><span className="font-medium">{title}</span></td>
                        <td>
                          <span className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            {tpl?.name && <span className="badge badge-muted" style={{ fontSize: 11 }}>{tpl.name}</span>}
                            {typeof detail === 'string' && detail ? (detail.length > 40 ? detail.slice(0, 40) + '...' : detail) : ''}
                            {(d?.linked_account_id || hasIntegration) && (
                              <Link2 size={12} style={{ color: integrationInfo ? 'var(--color-primary, #2563eb)' : (d?.linked_account_id ? 'var(--color-success, #16a34a)' : undefined), flexShrink: 0 }}
                                title={integrationInfo ? 'Connected via ' + integrationInfo.label : 'Linked to account'} />
                            )}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}><span className="font-medium" style={{ fontSize: 13 }}>{amount || '--'}</span></td>
                        <td><span className="text-muted" style={{ fontSize: 13 }}>{d?.currency || '--'}</span></td>
                        <td><span className="text-muted" style={{ fontSize: 13 }}>{entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '--'}</span></td>
                        <td>
                          <div className="td-actions">
                            {canRefresh && (
                              <button className="btn btn-ghost btn-sm" title={hasIntegration ? 'Refresh balance' : 'Refresh price'} onClick={async e => {
                                e.stopPropagation();
                                try {
                                  if (hasIntegration) {
                                    const provider = getProvider(integrationId);
                                    const meta = getIntegration(d, integrationId);
                                    setIntegrationRefreshing(true);
                                    try {
                                      await provider.refresh([meta.item_id], entries, decryptedCache, encrypt,
                                        (id, data) => setDecryptedCache(prev => ({ ...prev, [id]: data })));
                                    } finally {
                                      setIntegrationRefreshing(false);
                                    }
                                  } else if (hasTicker) {
                                    const ticker = subtype === 'crypto' ? d.coin : d.ticker;
                                    const { data: resp } = await api.post('/prices.php', { tickers: [ticker] });
                                    const result = apiData({ data: resp });
                                    const priceData = result?.prices?.[ticker];
                                    if (priceData) {
                                      const priceKey = subtype === 'crypto' ? 'price_per_unit' : 'price_per_share';
                                      const updated = { ...d, [priceKey]: String(priceData.price), currency: priceData.currency };
                                      await updateEntryLocal(entry.id, updated);
                                    }
                                  }
                                } catch { /* silent */ }
                              }}><RefreshCw size={14} /></button>
                            )}
                            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(entry); }} title="Edit"><Edit2 size={14} /></button>
                            <button className="btn btn-ghost btn-sm text-danger" onClick={e => { e.stopPropagation(); handleDelete(entry); }} title="Delete"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile card view */}
          <div className="vault-cards-mobile" style={{ padding: '8px' }}>
            {filtered.map(entry => {
              const d = decryptedCache[entry.id];
              const meta = TYPE_META[entry.entry_type] || TYPE_META.custom;
              const Icon = meta.icon;
              const title = d?.title || '(encrypted)';
              const fields = getTemplateFields(entry);
              const detailField = fields.find(f => f.key !== 'title' && f.key !== 'notes' && f.key !== 'linked_account_id' && f.key !== 'currency' && f.key !== 'country' && f.type !== 'textarea' && f.type !== 'secret' && f.type !== 'account_link' && f.type !== 'number' && d?.[f.key]);
              const detail = detailField ? d[detailField.key] : '';
              const amount = getEntryAmount(entry, d);
              const tpl = templates.find(t => t.id === entry.template_id) || entry.template;
              return (
                <div
                  key={entry.id}
                  className="vault-entry-card"
                  onClick={() => setViewEntry(entry)}
                >
                  <div className="vault-entry-card-icon" style={{ background: meta.color + '18' }}>
                    <Icon size={18} style={{ color: meta.color }} />
                  </div>
                  <div className="vault-entry-card-body">
                    <div className="vault-entry-card-title">{title}</div>
                    {(tpl?.name || detail || amount) ? (
                      <div className="vault-entry-card-detail" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        {tpl?.name && <span className="badge badge-muted" style={{ fontSize: 10 }}>{tpl.name}</span>}
                        {detail ? (typeof detail === 'string' ? (detail.length > 50 ? detail.slice(0, 50) + '...' : detail) : '') : ''}
                        {amount && <span className="font-medium">{amount}</span>}
                      </div>
                    ) : null}
                  </div>
                  <div className="vault-entry-card-actions">
                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(entry); }} title="Edit"><Edit2 size={14} /></button>
                    <button className="btn btn-ghost btn-sm text-danger" onClick={e => { e.stopPropagation(); handleDelete(entry); }} title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Modal */}
      <Modal isOpen={showAdd} onClose={() => { setShowAdd(false); setInlineCashBalance(''); setVisibleSecrets({}); }} title={`Add ${TYPE_META[formType]?.label?.replace(/s$/, '') || 'Entry'}`}>
        <form onSubmit={handleCreate}>
          {formError && <div className="alert alert-danger mb-3">{formError}</div>}
          {renderTypeAndTemplateSelectors()}
          {renderFormFields(getFormFields())}
          {/* Option B: Inline cash balance for accounts */}
          {formType === 'account' && (
            <div className="form-group" style={{ marginTop: 12, padding: '12px 14px', background: 'var(--hover-bg, #f8f9fa)', borderRadius: 8, border: '1px dashed var(--border)' }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Briefcase size={14} /> Cash Balance <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>(optional)</span>
              </label>
              <p className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Enter a balance to automatically create a linked Cash asset.
              </p>
              <input
                type="number"
                className="form-control"
                placeholder="0.00"
                step="0.01"
                min="0"
                value={inlineCashBalance}
                onChange={(e) => setInlineCashBalance(e.target.value)}
                style={{ maxWidth: 200 }}
              />
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => { setShowAdd(false); setInlineCashBalance(''); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editEntry} onClose={() => { setEditEntry(null); setVisibleSecrets({}); }} title="Edit Entry">
        <form onSubmit={handleUpdate}>
          {formError && <div className="alert alert-danger mb-3">{formError}</div>}
          {editEntry?.entry_type === 'account' && (
            <div className="text-muted" style={{ fontSize: 13, marginBottom: 12, padding: '8px 10px', background: 'var(--hover-bg, #f5f5f5)', borderRadius: 6 }}>
              <Briefcase size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
              To link or manage assets, view this account after saving.
            </div>
          )}
          {renderTypeAndTemplateSelectors()}
          {renderFormFields(getFormFields())}
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => setEditEntry(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Update'}</button>
          </div>
        </form>
      </Modal>

      {/* View Modal */}
      <Modal isOpen={!!viewEntry} onClose={() => setViewEntry(null)} title={decryptedCache[viewEntry?.id]?.title || 'Entry Details'}>
        {viewEntry && (() => {
          const d = decryptedCache[viewEntry.id];
          if (!d) return <p className="text-muted">Unable to decrypt this entry.</p>;
          const fields = getTemplateFields(viewEntry);
          if (fields.length === 0) {
            // Fallback: show raw JSON keys
            return Object.entries(d).map(([k, v]) => (
              <div key={k} className="form-group">
                <label className="form-label" style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</label>
                <div className="form-control-static">{typeof v === 'string' ? v : JSON.stringify(v)}</div>
              </div>
            ));
          }
          return fields.map(field => {
            const val = d[field.key];
            if (val === undefined || val === null || val === '') return null;
            // Resolve linked account display
            if (field.type === 'account_link' && val) {
              const acctEntry = entries.find(e => String(e.id) === String(val));
              const acctData = acctEntry ? decryptedCache[acctEntry.id] : null;
              const displayName = acctData ? `${acctData.title}${acctData.institution ? ' — ' + acctData.institution : ''}` : `Account #${val}`;
              return (
                <div key={field.key} className="form-group">
                  <label className="form-label">{field.label}</label>
                  <div className="form-control-static">{displayName}</div>
                </div>
              );
            }
            // Resolve country code to name
            if (field.key === 'country' && val) {
              const c = countries.find(co => co.code === val);
              const displayName = c ? `${c.flag_emoji || ''} ${c.name}`.trim() : val;
              return (
                <div key={field.key} className="form-group">
                  <label className="form-label">{field.label}</label>
                  <div className="form-control-static">{displayName}</div>
                </div>
              );
            }
            // Resolve currency code to name
            if (field.key === 'currency' && val) {
              const cur = currencies.find(cu => cu.code === val);
              const displayName = cur ? `${cur.code} — ${cur.symbol} ${cur.name}` : val;
              return (
                <div key={field.key} className="form-group">
                  <label className="form-label">{field.label}</label>
                  <div className="form-control-static">{displayName}</div>
                </div>
              );
            }
            return (
              <FieldDisplay key={field.key} field={field} value={val} masked={hideAmounts && MONETARY_KEYS.includes(field.key)} />
            );
          });
        })()}
        {/* Linked Assets section for accounts */}
        {viewEntry && viewEntry.entry_type === 'account' && (() => {
          const linked = getLinkedAssets(viewEntry.id);
          // Build linkable asset options: all assets, greyed out if already linked elsewhere
          const linkableOptions = entries
            .filter(e => e.entry_type === 'asset')
            .filter(e => {
              const d = decryptedCache[e.id];
              // Exclude assets already linked to THIS account
              return !(d && String(d.linked_account_id) === String(viewEntry.id));
            })
            .map(e => {
              const d = decryptedCache[e.id];
              const title = d?.title || '(encrypted)';
              const linkedTo = d?.linked_account_id;
              const alreadyLinked = linkedTo && String(linkedTo) !== String(viewEntry.id);
              let hint = '';
              if (alreadyLinked) {
                const linkedAcct = entries.find(a => String(a.id) === String(linkedTo));
                const linkedName = linkedAcct ? decryptedCache[linkedAcct.id]?.title : null;
                hint = linkedName ? `linked to ${linkedName}` : 'linked to another account';
              }
              return {
                value: String(e.id),
                label: title,
                disabled: !!alreadyLinked,
                hint,
              };
            });
          const hasLinkable = linkableOptions.some(o => !o.disabled);

          return (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label className="form-label" style={{ margin: 0 }}>
                  <Briefcase size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                  Linked Assets {linked.length > 0 && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{linked.length}</span>}
                </label>
                <button className="btn btn-sm btn-primary" onClick={() => openAddLinkedAsset(viewEntry)}>
                  <Plus size={12} /> New Asset
                </button>
              </div>
              {linked.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {linked.map(asset => {
                    const ad = decryptedCache[asset.id];
                    const tpl = templates.find(t => t.id === asset.template_id);
                    const tplName = tpl?.subtype ? tpl.name : 'Asset';
                    const tplFields = tpl?.fields ? (typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : tpl.fields) : [];
                    // Find the editable value field (portfolio_role=value or portfolio_role=quantity)
                    const valueField = tplFields.find(f => f.portfolio_role === 'value') || tplFields.find(f => f.key === 'value');
                    const qtyField = tplFields.find(f => f.portfolio_role === 'quantity');
                    const priceField = tplFields.find(f => f.portfolio_role === 'price');
                    const isEditing = inlineEditAsset?.id === asset.id;

                    return (
                      <div
                        key={asset.id}
                        style={{
                          padding: '8px 10px', borderRadius: 6,
                          background: 'var(--hover-bg, #f5f5f5)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="font-medium" style={{ fontSize: 14 }}>{ad?.title || '(encrypted)'}</span>
                            <span className="text-muted" style={{ fontSize: 12 }}>{tplName}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setViewEntry(asset)} title="View details">
                              <Eye size={13} />
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(asset)} title="Edit">
                              <Edit2 size={13} />
                            </button>
                          </div>
                        </div>
                        {/* Inline editable value fields */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          {valueField && (
                            <InlineNumberField
                              label={valueField.label}
                              value={ad?.[valueField.key] || ''}
                              currency={ad?.currency}
                              masked={hideAmounts}
                              isEditing={isEditing && inlineEditAsset?.field === valueField.key}
                              editValue={isEditing && inlineEditAsset?.field === valueField.key ? inlineEditAsset.value : ''}
                              saving={inlineEditSaving}
                              onStartEdit={() => setInlineEditAsset({ id: asset.id, field: valueField.key, value: ad?.[valueField.key] || '' })}
                              onChange={(v) => setInlineEditAsset(prev => ({ ...prev, value: v }))}
                              onSave={() => saveInlineAssetEdit(asset, valueField.key, inlineEditAsset?.value || '')}
                              onCancel={() => setInlineEditAsset(null)}
                            />
                          )}
                          {qtyField && (
                            <InlineNumberField
                              label={qtyField.label}
                              value={ad?.[qtyField.key] || ''}
                              masked={hideAmounts}
                              isEditing={isEditing && inlineEditAsset?.field === qtyField.key}
                              editValue={isEditing && inlineEditAsset?.field === qtyField.key ? inlineEditAsset.value : ''}
                              saving={inlineEditSaving}
                              onStartEdit={() => setInlineEditAsset({ id: asset.id, field: qtyField.key, value: ad?.[qtyField.key] || '' })}
                              onChange={(v) => setInlineEditAsset(prev => ({ ...prev, value: v }))}
                              onSave={() => saveInlineAssetEdit(asset, qtyField.key, inlineEditAsset?.value || '')}
                              onCancel={() => setInlineEditAsset(null)}
                            />
                          )}
                          {priceField && (
                            <InlineNumberField
                              label={priceField.label}
                              value={ad?.[priceField.key] || ''}
                              currency={ad?.currency}
                              masked={hideAmounts}
                              isEditing={isEditing && inlineEditAsset?.field === priceField.key}
                              editValue={isEditing && inlineEditAsset?.field === priceField.key ? inlineEditAsset.value : ''}
                              saving={inlineEditSaving}
                              onStartEdit={() => setInlineEditAsset({ id: asset.id, field: priceField.key, value: ad?.[priceField.key] || '' })}
                              onChange={(v) => setInlineEditAsset(prev => ({ ...prev, value: v }))}
                              onSave={() => saveInlineAssetEdit(asset, priceField.key, inlineEditAsset?.value || '')}
                              onCancel={() => setInlineEditAsset(null)}
                            />
                          )}
                          {!valueField && !qtyField && !priceField && (
                            <span className="text-muted" style={{ fontSize: 12 }}>No value fields</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {linkableOptions.length > 0 && (
                <SearchableSelect
                  options={linkableOptions}
                  value=""
                  onChange={(assetId) => {
                    if (!assetId) return;
                    const assetEntry = entries.find(e => String(e.id) === assetId);
                    if (assetEntry) linkAssetToAccount(assetEntry, viewEntry.id);
                  }}
                  placeholder={hasLinkable ? 'Link existing asset...' : 'All assets already linked'}
                  disabled={!hasLinkable}
                />
              )}
              {linked.length === 0 && linkableOptions.length === 0 && (
                <p className="text-muted" style={{ fontSize: 13 }}>No assets yet. Create one to link it here.</p>
              )}
            </div>
          );
        })()}
        {/* Integration connection status for account entries */}
        {viewEntry && viewEntry.entry_type === 'account' && (() => {
          const d = decryptedCache[viewEntry.id];
          if (!d) return null;
          const integrationId = getIntegrationType(d);
          if (integrationId) {
            const meta = getIntegration(d, integrationId);
            const integrationInfo = getProviderDisplayInfo(integrationId, meta);
            return (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--color-success-bg, #dcfce7)', borderRadius: 6, flexWrap: 'wrap' }}>
                  <Link2 size={14} style={{ color: 'var(--color-success, #16a34a)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--color-success, #16a34a)', fontWeight: 500 }}>Connected to {integrationInfo?.label || integrationId}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {meta?.last_refreshed && (
                      <span className="text-muted" style={{ fontSize: 11 }}>
                        {new Date(meta.last_refreshed).toLocaleString()}
                      </span>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      disabled={integrationRefreshing}
                      onClick={async () => {
                        const provider = getProvider(integrationId);
                        setIntegrationRefreshing(true);
                        try {
                          await provider.refresh([meta.item_id], entries, decryptedCache, encrypt,
                            (id, data) => setDecryptedCache(prev => ({ ...prev, [id]: data })));
                          setPlaidMsg('Balance refreshed');
                          setTimeout(() => setPlaidMsg(''), 3000);
                        } catch {
                          setPlaidMsg('Refresh failed');
                          setTimeout(() => setPlaidMsg(''), 5000);
                        } finally {
                          setIntegrationRefreshing(false);
                        }
                      }}
                    >
                      <RefreshCw size={12} className={integrationRefreshing ? 'spin' : ''} /> {integrationRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm text-danger"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={async () => {
                        if (!confirm(`Disconnect this account from ${integrationInfo?.label || integrationId}? The entry will be kept but balance refresh will no longer work.`)) return;
                        try {
                          const provider = getProvider(integrationId);
                          await provider.disconnect(meta.item_id);
                          // Remove integration from this entry and linked assets
                          const updatedData = removeIntegration(d, integrationId);
                          await updateEntryLocal(viewEntry.id, updatedData);
                          // Also remove integration from linked assets
                          for (const entry of entries) {
                            const ad = decryptedCache[entry.id];
                            if (getIntegration(ad, integrationId)?.item_id === meta.item_id) {
                              const cleanData = removeIntegration(ad, integrationId);
                              await updateEntryLocal(entry.id, cleanData);
                            }
                          }
                          setPlaidMsg(`Disconnected from ${integrationInfo?.label || integrationId}`);
                          setTimeout(() => setPlaidMsg(''), 3000);
                        } catch (err) {
                          setPlaidMsg(err.response?.data?.error || 'Disconnect failed');
                          setTimeout(() => setPlaidMsg(''), 5000);
                        }
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            );
          }
          if (plaidEnabled) {
            return (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => { setPlaidLinkEntryId(viewEntry.id); openPlaidLinkExisting(); }}
                  disabled={plaidLinkLoading}
                >
                  <Link2 size={14} /> {plaidLinkLoading ? 'Connecting...' : 'Link to Plaid'}
                </button>
              </div>
            );
          }
          return null;
        })()}
        {viewEntry && (
          <div className="flex gap-2 mt-4">
            <button className="btn btn-secondary" onClick={() => { openEdit(viewEntry); setViewEntry(null); }}><Edit2 size={14} /> Edit</button>
            <button className="btn btn-danger" onClick={() => { handleDelete(viewEntry); setViewEntry(null); }}><Trash2 size={14} /> Delete</button>
          </div>
        )}
      </Modal>

      {/* Recently Deleted Modal */}
      <Modal isOpen={showDeleted} onClose={() => setShowDeleted(false)} title="Recently Deleted">
        {deletedEntries.length === 0 ? (
          <p className="text-muted">No recently deleted entries. Items are permanently removed after 24 hours.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Title</th><th>Type</th><th>Deleted</th><th>Action</th></tr></thead>
              <tbody>
                {deletedEntries.map(entry => (
                  <tr key={entry.id}>
                    <td>{entry._decrypted?.title || '(encrypted)'}</td>
                    <td><span className="badge">{entry.entry_type}</span></td>
                    <td style={{ fontSize: 13 }}>{new Date(entry.deleted_at).toLocaleString()}</td>
                    <td><button className="btn btn-sm btn-secondary" onClick={() => handleRestore(entry)}><Undo2 size={14} /> Restore</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Post-save account → asset linking prompt */}
      <Modal isOpen={!!postSaveAccount} onClose={() => setPostSaveAccount(null)} title="Link Assets to Account">
        {postSaveAccount && (() => {
          const acctData = decryptedCache[postSaveAccount.id];
          const acctName = acctData?.title || 'this account';
          const linked = getLinkedAssets(postSaveAccount.id);
          const linkableOptions = entries
            .filter(e => e.entry_type === 'asset')
            .filter(e => {
              const d = decryptedCache[e.id];
              return !(d && String(d.linked_account_id) === String(postSaveAccount.id));
            })
            .map(e => {
              const d = decryptedCache[e.id];
              const title = d?.title || '(encrypted)';
              const linkedTo = d?.linked_account_id;
              const alreadyLinked = linkedTo && String(linkedTo) !== String(postSaveAccount.id);
              let hint = '';
              if (alreadyLinked) {
                const la = entries.find(a => String(a.id) === String(linkedTo));
                const ln = la ? decryptedCache[la.id]?.title : null;
                hint = ln ? `linked to ${ln}` : 'linked to another account';
              }
              return { value: String(e.id), label: title, disabled: !!alreadyLinked, hint };
            });
          const hasLinkable = linkableOptions.some(o => !o.disabled);

          return (
            <div>
              <p style={{ marginBottom: 12 }}>
                <span className="font-medium">{acctName}</span> saved. Would you like to link assets to it?
              </p>
              {linked.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label" style={{ fontSize: 13 }}>Already linked:</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {linked.map(a => (
                      <span key={a.id} className="text-muted" style={{ fontSize: 13 }}>
                        {decryptedCache[a.id]?.title || '(encrypted)'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {linkableOptions.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Link existing asset</label>
                  <SearchableSelect
                    options={linkableOptions}
                    value=""
                    onChange={(assetId) => {
                      if (!assetId) return;
                      const assetEntry = entries.find(e => String(e.id) === assetId);
                      if (assetEntry) linkAssetToAccount(assetEntry, postSaveAccount.id);
                    }}
                    placeholder={hasLinkable ? 'Select an asset...' : 'All assets already linked'}
                    disabled={!hasLinkable}
                  />
                </div>
              )}
              <div className="flex gap-2 mt-4" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => { openAddCashAsset(postSaveAccount); }}>
                  <Plus size={14} /> Add Cash Balance
                </button>
                <button className="btn btn-outline" onClick={() => { openAddLinkedAsset(postSaveAccount); setPostSaveAccount(null); }}>
                  <Plus size={14} /> Other Asset
                </button>
                <button className="btn btn-secondary" onClick={() => setPostSaveAccount(null)}>
                  Skip
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Plaid Account Picker Modal */}
      <Modal isOpen={!!plaidAccountPicker} onClose={() => setPlaidAccountPicker(null)} title="Select Account to Link">
        {plaidAccountPicker && (
          <div>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Choose which bank account to link to this entry:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {plaidAccountPicker.accounts.map(acct => (
                <button
                  key={acct.account_id}
                  className="btn btn-outline"
                  style={{ textAlign: 'left', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => confirmPlaidLink(acct)}
                >
                  <div>
                    <div className="font-medium">{acct.name}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{acct.type} / {acct.subtype}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="font-medium">{hideAmounts ? MASKED : `${acct.currency} ${Number(acct.balance).toLocaleString()}`}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setPlaidAccountPicker(null)}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import Modal */}
      <ImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        defaultType={activeType !== 'all' ? activeType : undefined}
        onImportComplete={refetch}
      />
    </div>
  );
}

/** Display a single field value with copy support for secrets */
function FieldDisplay({ field, value, masked }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(value); } catch {
      const t = document.createElement('textarea'); t.value = value; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isSecret = field.type === 'secret';

  return (
    <div className="form-group">
      <label className="form-label">{field.label}</label>
      <div className="flex items-center gap-2">
        {field.type === 'url' ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="form-control-static" style={{ wordBreak: 'break-all' }}>{value}</a>
        ) : (
          <span className="form-control-static" style={{ flex: 1, fontFamily: isSecret ? 'monospace' : 'inherit' }}>
            {masked ? MASKED : (isSecret && !visible ? '••••••••' : value)}
          </span>
        )}
        {isSecret && (
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setVisible(!visible)} title={visible ? 'Hide' : 'Show'}>
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" onClick={handleCopy} title="Copy">
          {copied ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
