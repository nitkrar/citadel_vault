import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import Modal from '../components/Modal';
import FieldDisplay from '../components/FieldDisplay';
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
import useShareData from '../hooks/useShareData';
import useRefreshPrices from '../hooks/useRefreshPrices';
import useLayoutMode from '../hooks/useLayoutMode';
import ImportModal from '../components/ImportModal';
import SaveToast from '../components/SaveToast';
import SortTh from '../components/SortableTh';
import { useHideAmounts } from '../components/Layout';
import { usePlaidLink } from '../integrations/providers/plaid/PlaidConnect';
import { getIntegration, getIntegrationType, setIntegration, removeIntegration } from '../integrations/helpers';
import { getProvider, getProviderDisplayInfo } from '../integrations/modules';
import * as cryptoLib from '../lib/crypto';
import { extractValue, buildRateMap, convertCurrency } from '../lib/portfolioAggregator';
import {
  Plus, Edit2, Trash2, Search, Eye, EyeOff, Copy, Check, Lock,
  KeyRound, AlertTriangle, Undo2, X, Upload,
  Landmark, Briefcase, FileText, Shield, Layers, RefreshCw, Link2, Share2, MoreVertical, ChevronDown,
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
function InlineTextField({ value, isEditing, editValue, saving, onStartEdit, onChange, onSave, onCancel }) {
  if (isEditing) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
        <input
          type="text"
          className="form-control"
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } if (e.key === 'Escape') onCancel(); }}
          autoFocus
          disabled={saving}
          style={{ width: 180, height: 28, fontSize: 13, padding: '2px 6px' }}
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
      onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
      title="Click to edit title"
      style={{
        cursor: 'pointer', padding: '2px 4px', borderRadius: 4,
        border: '1px solid transparent', transition: 'border-color .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
    >
      <span className="font-medium">{value || '(untitled)'}</span>
      <Edit2 size={10} style={{ marginLeft: 4, opacity: 0.4, verticalAlign: -1 }} />
    </span>
  );
}

function InlineNumberField({ label, value, currency, isEditing, editValue, saving, onStartEdit, onChange, onSave, onCancel, masked }) {
  const displayValue = masked ? MASKED : (value ? `${currency ? currency + ' ' : ''}${Number(value).toLocaleString()}` : '—');

  if (isEditing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
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
      onClick={(e) => { e.stopPropagation(); onStartEdit(e); }}
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



export default function VaultPage() {
  const { isUnlocked, encrypt, decryptWithFallback } = useEncryption();
  const { hideAmounts } = useHideAmounts();
  const { entries, decryptedCache, setDecryptedCache, loading, refetch, createEntry, updateEntry, deleteEntry, updateEntryLocal } = useVaultEntries();

  const [error, setError] = useState('');
  const { preferences } = useAuth();

  const { countries } = useCountries();
  const { currencies } = useCurrencies();
  const { handleRefreshAll, refreshing: refreshAllInProgress, refreshToast, clearRefreshToast } = useRefreshPrices();
  const { templates } = useTemplates();
  const { config } = useAppConfig();
  const { exchanges } = useExchanges();
  const { shareCounts, sharesByEntry, refetch: refetchShares } = useShareData();
  const { isMobile } = useLayoutMode();

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
      setSortDir(key === 'title' || key === 'type' ? 'asc' : 'desc');
    }
  };

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [viewEntry, setViewEntry] = useState(null);
  const [parentViewEntry, setParentViewEntry] = useState(null);
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
  // Inline title editing in vault table
  const [inlineTitleEdit, setInlineTitleEdit] = useState(null); // { id, value }
  const [inlineTitleSaving, setInlineTitleSaving] = useState(false);
  // Inline amount editing in vault table (direct-value templates only)
  const [inlineAmountEdit, setInlineAmountEdit] = useState(null); // { id, field, value }
  const [inlineAmountSaving, setInlineAmountSaving] = useState(false);

  // Re-encrypt prompt state
  const [reEncryptEntry, setReEncryptEntry] = useState(null);
  const [reEncrypting, setReEncrypting] = useState(false);

  // Plaid state
  const [integrationMsg, setPlaidMsg] = useState('');
  const [plaidLinkEntryId, setPlaidLinkEntryId] = useState(null); // entry id for "Link to Plaid" flow
  const [plaidAccountPicker, setPlaidAccountPicker] = useState(null); // { accounts, itemId, metadata, entryId }
  const [integrationRefreshing, setIntegrationRefreshing] = useState(false);
  const plaidEnabled = config?.plaid_enabled === 'true';

  // Mobile overflow menus
  const [showActionOverflow, setShowActionOverflow] = useState(false);
  const [showTypeOverflow, setShowTypeOverflow] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // ── Mobile header events ──
  useEffect(() => {
    const handleCurrencyToggle = () => setShowCurrencyPicker(v => !v);
    window.addEventListener('vault:currency-toggle', handleCurrencyToggle);
    return () => window.removeEventListener('vault:currency-toggle', handleCurrencyToggle);
  }, []);


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
        case 'type': {
          const ta = templates.find(t => t.id === a.template_id) || a.template;
          const tb = templates.find(t => t.id === b.template_id) || b.template;
          va = ta?.name || a.entry_type || ''; vb = tb?.name || b.entry_type || ''; break;
        }
        case 'amount':   va = getEntryAmountRaw(a, da); vb = getEntryAmountRaw(b, db); break;
        case 'currency': va = da?.currency || ''; vb = db?.currency || ''; break;
        default:         va = a.updated_at || ''; vb = b.updated_at || '';
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
      return sa < sb ? -dir : sa > sb ? dir : 0;
    });
    return list;
  }, [entries, activeType, search, decryptedCache, sortKey, sortDir, baseCurrency, rateMap, templates]);

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
      const blob = await encrypt(form, cryptoLib.AAD_VAULT_ENTRY);
      const savedType = formType;
      const updated = await updateEntry(editEntry, blob, { ...form }, {
        allowTemplateChange: true,
        newEntryType: formType,
        newTemplateId: formTemplateId,
      });
      setEditEntry(null);
      setForm({});
      // Restore parent view modal if editing a linked asset
      if (parentViewEntry) { setViewEntry(parentViewEntry); setParentViewEntry(null); }
      // Prompt to link/create assets after updating an account
      if (savedType === 'account') {
        setPostSaveAccount(updated);
      }
      // Prompt to re-encrypt shared copies (continuous shares only)
      const continuousShares = (sharesByEntry[editEntry.id] || []).filter(s => s.sync_mode === 'continuous');
      if (continuousShares.length > 0) {
        setReEncryptEntry(updated);
      }
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to update.');
    } finally {
      setSaving(false);
    }
  };

  const handleReEncrypt = async () => {
    if (!reEncryptEntry) return;
    setReEncrypting(true);
    try {
      const d = decryptedCache[reEncryptEntry.id];
      const shares = (sharesByEntry[reEncryptEntry.id] || []).filter(s => s.sync_mode === 'continuous');
      const updates = [];
      for (const share of shares) {
        if (share.status === 'pending') continue;
        try {
          const { data: keyResp } = await api.get(
            `/sharing.php?action=recipient-key&identifier=${encodeURIComponent(share.recipient_identifier)}`
          );
          const { public_key } = apiData({ data: keyResp });
          const recipientPubKey = await cryptoLib.importPublicKey(public_key);
          const encryptedData = await cryptoLib.hybridEncrypt(JSON.stringify(d), recipientPubKey);
          updates.push({ user_id: share.recipient_id, encrypted_data: encryptedData });
        } catch { /* skip this recipient */ }
      }
      if (updates.length > 0) {
        await api.post('/sharing.php?action=update', {
          source_entry_id: reEncryptEntry.id,
          recipients: updates,
        });
      }
      setReEncryptEntry(null);
      refetchShares();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update shared copies.');
    } finally {
      setReEncrypting(false);
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
          const d = await decryptWithFallback(entry.encrypted_data, cryptoLib.AAD_VAULT_ENTRY);
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

  // ── Inline edit entry title ─────────────────────────────────────
  const saveInlineTitleEdit = async (entry) => {
    const d = decryptedCache[entry.id];
    if (!d) return;
    const newTitle = inlineTitleEdit?.value?.trim();
    if (!newTitle || newTitle === d.title) { setInlineTitleEdit(null); return; }
    setInlineTitleSaving(true);
    try {
      await updateEntryLocal(entry.id, { ...d, title: newTitle });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update title.');
    } finally {
      setInlineTitleSaving(false);
      setInlineTitleEdit(null);
    }
  };

  // ── Inline edit entry amount (direct-value templates only) ──────
  const saveInlineAmountEdit = async (entry) => {
    const d = decryptedCache[entry.id];
    if (!d || !inlineAmountEdit) return;
    const { field, value } = inlineAmountEdit;
    if (value === d[field]) { setInlineAmountEdit(null); return; }
    setInlineAmountSaving(true);
    try {
      await updateEntryLocal(entry.id, { ...d, [field]: value });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update.');
    } finally {
      setInlineAmountSaving(false);
      setInlineAmountEdit(null);
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

  const openAdd = useCallback((type = 'password') => {
    setFormType(type);
    const tpl = templates.find(t => t.template_key === type && !t.owner_id && !t.country_code && !t.subtype);
    setFormTemplateId(tpl?.id || null);
    setForm({ title: '' });
    setShowAdd(true);
    setFormError('');
  }, [templates]);

  // ── Mobile header "+" button triggers add modal via custom event ──
  useEffect(() => {
    const handleVaultAdd = () => openAdd(activeType && activeType !== 'all' ? activeType : 'password');
    window.addEventListener('vault:add', handleVaultAdd);
    return () => window.removeEventListener('vault:add', handleVaultAdd);
  }, [activeType, openAdd]);

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
      {isMobile ? (
        <>
          {/* Mobile: currency picker dropdown (triggered from header icon) */}
          {showCurrencyPicker && currencies.length > 0 && (
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
                      background: baseCurrency === c.code ? 'var(--hover-bg)' : undefined }}
                    onClick={() => { setDisplayCurrency(c.code); setShowCurrencyPicker(false); }}>
                    {c.symbol} {c.code}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        /* Desktop: full page header */
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
                    <button className="btn btn-secondary btn-sm" disabled={refreshAllInProgress}
                      onClick={() => handleRefreshAll(plaidItemIds)}>
                      <RefreshCw size={14} className={refreshAllInProgress ? 'spin' : ''} /> {refreshAllInProgress ? 'Refreshing...' : 'Refresh All'}
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
            {currencies.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Display:</span>
                <select className="form-control"
                  style={{ width: 'auto', minWidth: 90, padding: '4px 30px 4px 8px', fontSize: 13 }}
                  value={baseCurrency}
                  onChange={e => setDisplayCurrency(e.target.value)}
                >
                  {currencies.filter(c => c.is_active === 1 || c.is_active === '1' || c.is_active === true).map(c => (
                    <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                  ))}
                </select>
              </div>
            )}
            <button className="btn btn-primary" onClick={() => openAdd(activeType !== 'all' ? activeType : 'password')}><Plus size={16} /> New Entry</button>
          </div>
        </div>
      )}

      {/* Type filter tabs */}
      {isMobile ? (
        /* Mobile: tabs row — Accounts, Assets, More types dropdown, spacer, ... menu */
        <div className="flex gap-2 mb-4" style={{ flexWrap: 'nowrap', alignItems: 'center', overflow: 'hidden' }}>
          {['account', 'asset'].map(type => {
            const meta = TYPE_META[type];
            const Icon = meta?.icon || Layers;
            return (
              <button key={type} className={`btn btn-sm ${activeType === type ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap' }}
                onClick={() => { setActiveType(type); sessionStorage.setItem('pv_vault_last_tab', type); }}>
                <Icon size={14} /> {meta?.label || type}
                {counts[type] > 0 && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts[type]}</span>}
              </button>
            );
          })}
          {(() => {
            const dropdownTypes = ['all', ...TAB_ORDER.filter(t => t !== 'account' && t !== 'asset')];
            const isDropdownActive = dropdownTypes.includes(activeType) || !activeType || activeType === 'all';
            const activeLabel = !activeType || activeType === 'all' ? `All (${counts.all})` : (TYPE_META[activeType]?.label || activeType);
            return (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button className={`btn btn-sm ${isDropdownActive ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setShowTypeOverflow(v => !v)}>
                  {isDropdownActive ? activeLabel : 'More'}
                  <ChevronDown size={14} />
                </button>
                {showTypeOverflow && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 900 }} onClick={() => setShowTypeOverflow(false)} />
                    <div style={{
                      position: 'fixed', left: 16, zIndex: 901,
                      background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', minWidth: 160, overflow: 'hidden',
                    }}>
                      {dropdownTypes.map(type => {
                        const isAll = type === 'all';
                        const meta = TYPE_META[type];
                        const Icon = isAll ? Layers : (meta?.icon || Layers);
                        const label = isAll ? 'All' : (meta?.label || type);
                        const count = isAll ? counts.all : counts[type];
                        const isActive = isAll ? (!activeType || activeType === 'all') : activeType === type;
                        return (
                          <button key={type} className="btn btn-ghost btn-sm"
                            style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px',
                              background: isActive ? 'var(--hover-bg)' : undefined }}
                            onClick={() => { setActiveType(type); sessionStorage.setItem('pv_vault_last_tab', type); setShowTypeOverflow(false); }}>
                            <Icon size={14} /> {label}
                            {count > 0 && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {/* Spacer pushes ... to right */}
          <div style={{ flex: 1 }} />
          {/* ... overflow menu */}
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
                      <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px' }}
                        onClick={() => { loadDeleted(); setShowActionOverflow(false); }}>
                        <Undo2 size={14} /> Recently Deleted
                      </button>
                      {canRefresh && (
                        <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px' }}
                          disabled={refreshAllInProgress}
                          onClick={() => { handleRefreshAll(plaidItemIds); setShowActionOverflow(false); }}>
                          <RefreshCw size={14} className={refreshAllInProgress ? 'spin' : ''} /> {refreshAllInProgress ? 'Refreshing...' : 'Refresh All'}
                        </button>
                      )}
                      {plaidEnabled && (
                        <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0, padding: '10px 14px' }}
                          disabled={plaidConnectLoading}
                          onClick={() => { openPlaidConnect(); setShowActionOverflow(false); }}>
                          <Landmark size={14} /> {plaidConnectLoading ? 'Connecting...' : 'Connect Bank'}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        /* Desktop: all tabs visible */
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
      )}

      {/* Search */}
      <div className="flex gap-3 mb-4">
        <div style={{ position: 'relative', flex: '1 1 auto' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input className="form-control" style={{ paddingLeft: 36 }} placeholder="Search across all fields..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Refresh All toast */}
      {refreshToast && (
        <SaveToast key={refreshToast.key} message={refreshToast.message} type={refreshToast.type} onDismiss={clearRefreshToast} />
      )}
      {/* Plaid messages */}
      {integrationMsg && <div className="alert alert-success mb-3"><Check size={16} /><span>{integrationMsg}</span></div>}
      {(plaidConnectError || plaidLinkError) && <div className="alert alert-danger mb-3"><AlertTriangle size={16} /><span>{plaidConnectError || plaidLinkError}</span></div>}

      {/* Re-encrypt shared copies prompt (continuous shares only) */}
      {reEncryptEntry && (() => {
        const continuousCount = (sharesByEntry[reEncryptEntry.id] || []).filter(s => s.sync_mode === 'continuous').length;
        return continuousCount > 0 ? (
          <div className="alert alert-info mb-3" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div className="flex items-center gap-2" style={{ flex: '1 1 auto' }}>
              <Share2 size={16} style={{ flexShrink: 0 }} />
              <span>This entry has {continuousCount} continuous {continuousCount === 1 ? 'share' : 'shares'}. Update {continuousCount === 1 ? 'the recipient\'s copy' : 'their copies'}?</span>
            </div>
            <div className="flex gap-2" style={{ flexShrink: 0 }}>
              <button className="btn btn-sm btn-primary" onClick={handleReEncrypt} disabled={reEncrypting}>
                {reEncrypting ? 'Updating...' : 'Update'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setReEncryptEntry(null)}>Dismiss</button>
            </div>
          </div>
        ) : null;
      })()}

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
                    <SortTh sortKey="type" current={sortKey} dir={sortDir} onSort={toggleSort}>Details</SortTh>
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
                    // Direct value field for inline amount editing (skip accounts and qty×price templates)
                    const tplFields = Array.isArray(fields) ? fields : [];
                    const directValueField = entry.entry_type !== 'account'
                      ? tplFields.find(f => f.portfolio_role === 'value') || (!tplFields.some(f => f.portfolio_role === 'quantity') ? tplFields.find(f => ['value', 'current_value', 'face_value'].includes(f.key) && f.type === 'number') : null)
                      : null;
                    return (
                      <tr key={entry.id} style={{ cursor: 'pointer' }} onClick={() => { setViewEntry(entry); }}>
                        <td><Icon size={16} style={{ color: meta.color }} /></td>
                        <td>
                          <InlineTextField
                            value={title}
                            isEditing={inlineTitleEdit?.id === entry.id}
                            editValue={inlineTitleEdit?.id === entry.id ? inlineTitleEdit.value : ''}
                            saving={inlineTitleSaving}
                            onStartEdit={() => setInlineTitleEdit({ id: entry.id, value: d?.title || '' })}
                            onChange={(v) => setInlineTitleEdit(prev => ({ ...prev, value: v }))}
                            onSave={() => saveInlineTitleEdit(entry)}
                            onCancel={() => setInlineTitleEdit(null)}
                          />
                          {shareCounts[entry.id] > 0 && (
                            <Share2 size={12} style={{ marginLeft: 4, color: 'var(--color-primary)', verticalAlign: -1 }}
                              title={`Shared with ${shareCounts[entry.id]} ${shareCounts[entry.id] === 1 ? 'person' : 'people'}`} />
                          )}
                        </td>
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
                        <td style={{ textAlign: 'right' }}>
                          {directValueField && d ? (
                            <InlineNumberField
                              label={directValueField.label}
                              value={d[directValueField.key] || ''}
                              currency={d.currency}
                              masked={hideAmounts}
                              isEditing={inlineAmountEdit?.id === entry.id}
                              editValue={inlineAmountEdit?.id === entry.id ? inlineAmountEdit.value : ''}
                              saving={inlineAmountSaving}
                              onStartEdit={(e) => { if (e) e.stopPropagation(); setInlineAmountEdit({ id: entry.id, field: directValueField.key, value: d[directValueField.key] || '' }); }}
                              onChange={(v) => setInlineAmountEdit(prev => ({ ...prev, value: v }))}
                              onSave={() => saveInlineAmountEdit(entry)}
                              onCancel={() => setInlineAmountEdit(null)}
                            />
                          ) : (
                            <span className="font-medium" style={{ fontSize: 13 }}>{amount || '--'}</span>
                          )}
                        </td>
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
      <Modal isOpen={!!editEntry} onClose={() => { setEditEntry(null); setVisibleSecrets({}); if (parentViewEntry) { setViewEntry(parentViewEntry); setParentViewEntry(null); } }} title="Edit Entry">
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
            <button type="button" className="btn btn-secondary" onClick={() => { setEditEntry(null); if (parentViewEntry) { setViewEntry(parentViewEntry); setParentViewEntry(null); } }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Update'}</button>
          </div>
        </form>
      </Modal>

      {/* View Modal */}
      <Modal isOpen={!!viewEntry} onClose={() => { if (parentViewEntry) { setViewEntry(parentViewEntry); setParentViewEntry(null); } else { setViewEntry(null); } }} title={parentViewEntry ? `← ${decryptedCache[viewEntry?.id]?.title || 'Asset Details'}` : (decryptedCache[viewEntry?.id]?.title || 'Entry Details')}>
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
                            <button className="btn btn-ghost btn-sm" onClick={() => { setParentViewEntry(viewEntry); setViewEntry(asset); }} title="View details">
                              <Eye size={13} />
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => { setParentViewEntry(viewEntry); setViewEntry(null); openEdit(asset); }} title="Edit">
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
        {viewEntry && sharesByEntry[viewEntry.id]?.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <label className="form-label" style={{ margin: 0, marginBottom: 8 }}>
              <Share2 size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
              Shared with {sharesByEntry[viewEntry.id].length} {sharesByEntry[viewEntry.id].length === 1 ? 'person' : 'people'}
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sharesByEntry[viewEntry.id].map(share => (
                <div key={share.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderRadius: 6, background: 'var(--hover-bg, #f5f5f5)' }}>
                  <div>
                    <span className="font-medium" style={{ fontSize: 13 }}>{share.recipient_identifier}</span>
                    <span style={{ marginLeft: 8 }}>
                      {share.status === 'pending'
                        ? <span className="badge badge-warning" style={{ fontSize: 10 }}>Pending</span>
                        : <span className="badge badge-success" style={{ fontSize: 10 }}>Active</span>}
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-sm text-danger" onClick={async (e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Revoke share with ${share.recipient_identifier}?`)) return;
                    try {
                      await api.post('/sharing.php?action=revoke', {
                        source_entry_id: viewEntry.id,
                        user_ids: [share.recipient_id],
                      });
                      refetchShares();
                    } catch (err) {
                      alert(err.response?.data?.error || 'Revoke failed.');
                    }
                  }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
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

