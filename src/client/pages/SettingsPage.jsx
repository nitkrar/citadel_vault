import { useState, useEffect, useMemo } from 'react';
import api from '../api/client';
import { Settings, Save, UserPlus, ShieldCheck, KeyRound, Clock, Zap, Database, Plug, Trash2 } from 'lucide-react';
import Section from '../components/Section';

const CATEGORY_META = {
  registration:  { title: 'Registration',    icon: UserPlus },
  security:      { title: 'Security',        icon: ShieldCheck },
  vault:         { title: 'Vault',           icon: KeyRound },
  pricing:       { title: 'Pricing',         icon: Clock },
  integrations:  { title: 'Integrations',    icon: Plug },
  performance:   { title: 'Performance',     icon: Zap },
  cache:         { title: 'Cache & Storage', icon: Database },
  general:       { title: 'General',         icon: Settings },
};

const CATEGORY_ORDER = ['registration', 'security', 'vault', 'pricing', 'integrations', 'cache', 'performance', 'general'];

function SettingInput({ settingKey, setting, value, onChange }) {
  const { description, options, type } = setting;
  const id = `setting-${settingKey}`;

  const isBool = value === 'true' || value === 'false';

  let input;
  if (options) {
    input = (
      <select id={id} className="form-control" value={value}
        onChange={e => onChange(settingKey, e.target.value)}
        style={{ maxWidth: 360 }}>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  } else if (isBool) {
    input = (
      <select id={id} className="form-control" value={value}
        onChange={e => onChange(settingKey, e.target.value)}
        style={{ maxWidth: 240 }}>
        <option value="true">Enabled</option>
        <option value="false">Disabled</option>
      </select>
    );
  } else if (value !== '' && !isNaN(value)) {
    input = (
      <input id={id} type="number" className="form-control" value={value}
        onChange={e => onChange(settingKey, e.target.value)}
        style={{ maxWidth: 240 }} />
    );
  } else {
    input = (
      <input id={id} type="text" className="form-control" value={value}
        onChange={e => onChange(settingKey, e.target.value)}
        style={{ maxWidth: 360 }} />
    );
  }

  return (
    <div className="form-group">
      <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {description || settingKey}
        {type === 'gatekeeper' && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4,
            background: '#dbeafe', color: '#2563eb', fontWeight: 600,
          }}>
            gatekeeper
          </span>
        )}
      </label>
      <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
        {settingKey}
      </p>
      {input}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [changes, setChanges] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/settings.php')
      .then(res => {
        if (!cancelled) setSettings(res.data?.data || res.data || {});
      })
      .catch(() => { if (!cancelled) setError('Failed to load settings.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    if (!settings) return {};
    const groups = {};
    for (const [key, setting] of Object.entries(settings)) {
      const cat = setting.category || 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ key, ...setting });
    }
    return groups;
  }, [settings]);

  const getValue = (key) => {
    if (key in changes) return changes[key];
    return settings?.[key]?.value ?? '';
  };

  const handleChange = (key, value) => {
    const original = settings?.[key]?.value;
    setChanges(prev => {
      const next = { ...prev };
      if (value === original) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (Object.keys(changes).length === 0) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.put('/settings.php', changes);
      setSettings(prev => {
        const updated = { ...prev };
        for (const [k, v] of Object.entries(changes)) {
          if (updated[k]) updated[k] = { ...updated[k], value: v };
        }
        return updated;
      });
      setChanges({});
      setSuccess('Settings saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-spinner"><div className="spinner" /></div>;

  const hasChanges = Object.keys(changes).length > 0;
  // Show known categories in order, then any unknown categories at the end
  const knownCategories = CATEGORY_ORDER.filter(c => grouped[c]);
  const unknownCategories = Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c));
  const sortedCategories = [...knownCategories, ...unknownCategories];

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><Settings size={22} /> System Settings</h2>
        <p className="text-muted">Configure global application settings.</p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form onSubmit={handleSave}>
        {sortedCategories.map(cat => {
          const meta = CATEGORY_META[cat] || { title: cat, icon: Settings };
          return (
            <Section key={cat} icon={meta.icon} title={meta.title} defaultOpen={false}>
              {grouped[cat].map(item => (
                <SettingInput
                  key={item.key}
                  settingKey={item.key}
                  setting={item}
                  value={getValue(item.key)}
                  onChange={handleChange}
                />
              ))}
            </Section>
          );
        })}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !hasChanges}>
            <Save size={16} /> {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
          </button>
        </div>
      </form>

      <Section icon={Trash2} title="Data Cleanup" defaultOpen={false}>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Purge stale security data: rate limit entries (&gt;7 days), rejected invite requests (&gt;30 days),
          and operational audit logs (&gt;30 days). Security audit events are kept for 90 days.
        </p>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={cleaningUp}
          onClick={async () => {
            setCleaningUp(true);
            setCleanupResult(null);
            try {
              const res = await api.post('/settings.php?action=cleanup');
              const data = res.data?.data || res.data;
              const purged = data.purged || {};
              const total = Object.values(purged).reduce((a, b) => a + b, 0);
              setCleanupResult({ type: 'success', text: `Cleaned up ${total} rows.`, detail: purged });
            } catch (err) {
              setCleanupResult({ type: 'error', text: err.response?.data?.error || 'Cleanup failed.' });
            }
            setCleaningUp(false);
          }}
        >
          <Trash2 size={14} /> {cleaningUp ? 'Cleaning...' : 'Run Cleanup'}
        </button>
        {cleanupResult && (
          <div className={`alert ${cleanupResult.type === 'success' ? 'alert-success' : 'alert-danger'}`} style={{ marginTop: 8, fontSize: 13 }}>
            {cleanupResult.text}
            {cleanupResult.detail && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Rate limits: {cleanupResult.detail.rate_limits || 0},
                Invite requests: {cleanupResult.detail.invite_requests || 0},
                Audit (operational): {cleanupResult.detail.audit_log_operational || 0},
                Audit (old): {cleanupResult.detail.audit_log_old || 0}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
