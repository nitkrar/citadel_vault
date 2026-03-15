import { useState, useEffect } from 'react';
import api from '../api/client';
import { Settings, Save, Clock } from 'lucide-react';

const TTL_OPTIONS = [
  { label: '1 hour',   value: '3600' },
  { label: '6 hours',  value: '21600' },
  { label: '12 hours', value: '43200' },
  { label: '24 hours', value: '86400' },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Local form state
  const [tickerPriceTtl, setTickerPriceTtl] = useState('86400');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get('/settings.php');
        const data = res.data?.data || res.data || {};
        if (!cancelled) {
          setSettings(data);
          setTickerPriceTtl(data.ticker_price_ttl || '86400');
        }
      } catch (err) {
        if (!cancelled) setError('Failed to load settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      await api.put('/settings.php', {
        ticker_price_ttl: tickerPriceTtl,
      });
      setSuccess('Settings saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-spinner">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><Settings size={22} /> System Settings</h2>
        <p className="text-muted">Configure global application settings.</p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <div className="card-header">
          <h3><Clock size={18} /> Price Cache</h3>
        </div>
        <div className="card-body">
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label htmlFor="ticker-price-ttl">Price Cache Duration</label>
              <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
                How long to cache fetched stock/crypto prices before refreshing from the source.
              </p>
              <select
                id="ticker-price-ttl"
                className="form-control"
                value={tickerPriceTtl}
                onChange={(e) => setTickerPriceTtl(e.target.value)}
                style={{ maxWidth: 240 }}
              >
                {TTL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
