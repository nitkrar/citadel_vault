import { useState, useMemo, useCallback, useEffect } from 'react';
import api from '../api/client';
import Modal from '../components/Modal';
import SearchableSelect from '../components/SearchableSelect';
import { useEncryption } from '../contexts/EncryptionContext';
import { entryStore } from '../lib/entryStore';
import { VALID_ENTRY_TYPES } from '../lib/defaults';
import { apiData } from '../lib/checks';
import ImportModal from '../components/ImportModal';
import {
  Plus, Edit2, Trash2, Search, Eye, EyeOff, Copy, Check, Lock,
  KeyRound, RefreshCw, AlertTriangle, Undo2, X, ChevronDown, Upload,
  Landmark, Briefcase, FileText, Shield, Layers,
} from 'lucide-react';

const TYPE_META = {
  password:  { icon: KeyRound,  label: 'Passwords',  color: '#3b82f6' },
  account:   { icon: Landmark,  label: 'Accounts',   color: '#22c55e' },
  asset:     { icon: Briefcase, label: 'Assets',      color: '#f59e0b' },
  license:   { icon: FileText,  label: 'Licenses',    color: '#8b5cf6' },
  insurance: { icon: Shield,    label: 'Insurance',   color: '#ec4899' },
  custom:    { icon: Layers,    label: 'Custom',      color: '#06b6d4' },
};

// Types that get country/currency selectors
const TYPES_WITH_COUNTRY = ['account', 'asset', 'insurance', 'license'];

function generatePassword(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => chars[v % chars.length]).join('');
}

export default function VaultPage() {
  const { isUnlocked, encrypt, decrypt } = useEncryption();

  const [entries, setEntries] = useState([]);
  const [decryptedCache, setDecryptedCache] = useState({});
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Reference data
  const [countries, setCountries] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  // Filters
  const [activeType, setActiveType] = useState('all');
  const [search, setSearch] = useState('');

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

  // Post-save prompt for accounts (link/create assets)
  const [postSaveAccount, setPostSaveAccount] = useState(null); // entry object after save

  // ── Fetch reference data (countries + currencies) ─────────────────
  useEffect(() => {
    if (!isUnlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const [cRes, curRes] = await Promise.all([
          api.get('/reference.php?resource=countries'),
          api.get('/reference.php?resource=currencies'),
        ]);
        if (cancelled) return;
        const rawCountries = apiData({ data: cRes.data }) || [];
        const rawCurrencies = apiData({ data: curRes.data }) || [];
        setCountries(rawCountries);
        setCurrencies(rawCurrencies);
      } catch {
        // Non-critical — selectors will just be empty
      }
    })();
    return () => { cancelled = true; };
  }, [isUnlocked]);

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
    // Index currencies by ID for fast lookup (handle both string and number IDs)
    const currById = {};
    for (const cu of currencies) {
      currById[Number(cu.id)] = cu.code;
    }
    for (const c of countries) {
      if (c.default_currency_id) {
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

  // ── Load data from IndexedDB ─────────────────────────────────────
  const loadEntries = useCallback(async () => {
    if (!isUnlocked) { setEntries([]); setDecryptedCache({}); setLoading(false); return; }
    setLoading(true);
    try {
      const raw = await entryStore.getAll();
      const tpl = await entryStore.getAllTemplates();
      setTemplates(tpl);

      // Decrypt all entries
      const cache = {};
      for (const entry of raw) {
        try {
          cache[entry.id] = await decrypt(entry.data);
        } catch {
          cache[entry.id] = null;
        }
      }
      setEntries(raw);
      setDecryptedCache(cache);
    } catch (err) {
      setError('Failed to load entries.');
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, decrypt]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // ── Refresh from server ──────────────────────────────────────────
  const refetch = useCallback(async () => {
    const { data: resp } = await api.get('/vault.php');
    const raw = apiData({ data: resp }) || [];
    await entryStore.putAll(raw);
    // Re-decrypt
    const cache = {};
    for (const entry of raw) {
      try { cache[entry.id] = await decrypt(entry.data); } catch { cache[entry.id] = null; }
    }
    setEntries(raw);
    setDecryptedCache(cache);
  }, [decrypt]);

  // ── Filtering ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = entries;
    if (activeType !== 'all') list = list.filter(e => e.entry_type === activeType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => {
        const d = decryptedCache[e.id];
        if (!d) return false;
        return Object.values(d).some(v => typeof v === 'string' && v.toLowerCase().includes(q));
      });
    }
    return list;
  }, [entries, activeType, search, decryptedCache]);

  // ── Counts ───────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: entries.length };
    VALID_ENTRY_TYPES.forEach(t => { c[t] = entries.filter(e => e.entry_type === t).length; });
    return c;
  }, [entries]);

  // ── Get template fields for an entry ─────────────────────────────
  const getTemplateFields = (entry) => {
    if (entry.template?.fields) return entry.template.fields;
    const tpl = templates.find(t => t.id === entry.template_id);
    return tpl?.fields || [];
  };

  // ── Check if current form requires currency/country ─────────────
  const formRequiresCurrency = () => {
    if (!TYPES_WITH_COUNTRY.includes(formType)) return false;
    const fields = getFormFields();
    const MONETARY_KEYS = ['balance', 'value', 'current_value', 'purchase_price', 'face_value',
      'premium_amount', 'coverage_amount', 'cash_value', 'credit_limit', 'price_per_share'];
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

    setSaving(true);
    try {
      const blob = await encrypt(form);
      const { data: resp } = await api.post('/vault.php', {
        entry_type: formType,
        template_id: formTemplateId,
        encrypted_data: blob,
      });
      const newId = apiData({ data: resp })?.id;
      // Add to local store
      const savedForm = { ...form };
      const savedType = formType;
      const newEntry = { id: newId, entry_type: formType, template_id: formTemplateId, data: blob, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await entryStore.put(newEntry);
      setDecryptedCache(prev => ({ ...prev, [newId]: savedForm }));
      setEntries(prev => [newEntry, ...prev]);
      setShowAdd(false);
      setForm({});
      // Prompt to link/create assets after saving an account
      if (savedType === 'account') {
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

    setSaving(true);
    try {
      const blob = await encrypt(form);
      const payload = { encrypted_data: blob };
      // Send entry_type + template_id if they changed
      if (formType !== editEntry.entry_type) payload.entry_type = formType;
      if (formTemplateId !== editEntry.template_id) payload.template_id = formTemplateId;

      await api.put(`/vault.php?id=${editEntry.id}`, payload);
      // Update local
      const savedForm = { ...form };
      const savedType = formType;
      const updated = {
        ...editEntry,
        data: blob,
        entry_type: formType,
        template_id: formTemplateId,
        updated_at: new Date().toISOString(),
      };
      await entryStore.put(updated);
      setDecryptedCache(prev => ({ ...prev, [editEntry.id]: savedForm }));
      setEntries(prev => prev.map(e => e.id === editEntry.id ? updated : e));
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
      await api.delete(`/vault.php?id=${entry.id}`);
      await entryStore.delete(entry.id);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
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
          const d = await decrypt(entry.data);
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
      const blob = await encrypt(updated);
      await api.put(`/vault.php?id=${assetEntry.id}`, { encrypted_data: blob });
      const updatedEntry = { ...assetEntry, data: blob, updated_at: new Date().toISOString() };
      await entryStore.put(updatedEntry);
      setDecryptedCache(prev => ({ ...prev, [assetEntry.id]: updated }));
      setEntries(prev => prev.map(e => e.id === assetEntry.id ? updatedEntry : e));
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
    const newForm = { title: form.title || '' };
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
      const MONETARY_KEYS = ['balance', 'value', 'current_value', 'purchase_price', 'face_value',
        'premium_amount', 'coverage_amount', 'cash_value', 'credit_limit', 'price_per_share'];
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
      return (
        <div className="flex gap-1">
          <input className="form-control" type="text" value={form[field.key] || ''}
            onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} style={{ flex: 1 }} />
          {field.key === 'password' && (
            <button type="button" className="btn btn-secondary btn-icon"
              onClick={() => setForm(f => ({ ...f, [field.key]: generatePassword() }))} title="Generate">
              <RefreshCw size={16} />
            </button>
          )}
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
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={loadDeleted}><Undo2 size={14} /> Recently Deleted</button>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Import</button>
          <button className="btn btn-primary" onClick={() => openAdd(activeType !== 'all' ? activeType : 'password')}><Plus size={16} /> New Entry</button>
        </div>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${activeType === 'all' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveType('all')}>
          All <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts.all}</span>
        </button>
        {VALID_ENTRY_TYPES.map(type => {
          const meta = TYPE_META[type];
          const Icon = meta?.icon || Layers;
          return (
            <button key={type} className={`btn btn-sm ${activeType === type ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveType(type)}>
              <Icon size={14} /> {meta?.label || type}
              {counts[type] > 0 && <span className="badge badge-muted" style={{ marginLeft: 4 }}>{counts[type]}</span>}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-4">
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input className="form-control" style={{ paddingLeft: 32 }} placeholder="Search across all fields..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

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
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Type</th>
                  <th>Title</th>
                  <th>Details</th>
                  <th style={{ width: 140 }}>Updated</th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => {
                  const d = decryptedCache[entry.id];
                  const meta = TYPE_META[entry.entry_type] || TYPE_META.custom;
                  const Icon = meta.icon;
                  const title = d?.title || '(encrypted)';
                  // Show first non-title, non-notes field as detail
                  const fields = getTemplateFields(entry);
                  const detailField = fields.find(f => f.key !== 'title' && f.key !== 'notes' && f.key !== 'linked_account_id' && f.type !== 'textarea' && f.type !== 'secret' && f.type !== 'account_link' && d?.[f.key]);
                  const detail = detailField ? d[detailField.key] : '';

                  return (
                    <tr key={entry.id} style={{ cursor: 'pointer' }} onClick={() => { setViewEntry(entry); }}>
                      <td><Icon size={16} style={{ color: meta.color }} /></td>
                      <td><span className="font-medium">{title}</span></td>
                      <td><span className="text-muted">{typeof detail === 'string' ? (detail.length > 40 ? detail.slice(0, 40) + '...' : detail) : ''}</span></td>
                      <td><span className="text-muted" style={{ fontSize: 13 }}>{entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '--'}</span></td>
                      <td>
                        <div className="td-actions">
                          <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setViewEntry(entry); }}><Eye size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openEdit(entry); }}><Edit2 size={14} /></button>
                          <button className="btn btn-ghost btn-sm text-danger" onClick={e => { e.stopPropagation(); handleDelete(entry); }}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Modal */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title={`Add ${TYPE_META[formType]?.label?.replace(/s$/, '') || 'Entry'}`}>
        <form onSubmit={handleCreate}>
          {formError && <div className="alert alert-danger mb-3">{formError}</div>}
          {renderTypeAndTemplateSelectors()}
          {renderFormFields(getFormFields())}
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={!!editEntry} onClose={() => setEditEntry(null)} title="Edit Entry">
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
              <FieldDisplay key={field.key} field={field} value={val} />
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
                    const tplName = (() => {
                      const tpl = templates.find(t => t.id === asset.template_id);
                      return tpl?.subtype ? tpl.name : 'Asset';
                    })();
                    return (
                      <div
                        key={asset.id}
                        onClick={() => setViewEntry(asset)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                          background: 'var(--hover-bg, #f5f5f5)', transition: 'background .15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--border)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--hover-bg, #f5f5f5)'}
                      >
                        <div>
                          <span className="font-medium" style={{ fontSize: 14 }}>{ad?.title || '(encrypted)'}</span>
                          <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{tplName}</span>
                        </div>
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          {ad?.currency || ''}{ad?.value ? ` ${ad.currency ? ' ' : ''}${ad.value}` : ''}
                          {ad?.shares ? ` ${ad.shares} shares` : ''}
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
              <div className="flex gap-2 mt-4">
                <button className="btn btn-primary" onClick={() => { openAddLinkedAsset(postSaveAccount); setPostSaveAccount(null); }}>
                  <Plus size={14} /> Create New Asset
                </button>
                <button className="btn btn-secondary" onClick={() => setPostSaveAccount(null)}>
                  Skip
                </button>
              </div>
            </div>
          );
        })()}
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
function FieldDisplay({ field, value }) {
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
            {isSecret && !visible ? '••••••••' : value}
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
