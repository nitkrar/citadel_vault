import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  KeyRound, Landmark, Briefcase, FileText, Shield, Layers,
  Lock, Users, Clock, AlertTriangle, Info,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useEncryption } from '../contexts/EncryptionContext';
import useVaultData from '../hooks/useVaultData';
import { apiData } from '../lib/checks';

const TYPE_META = {
  password:  { icon: KeyRound,  label: 'Passwords',  color: '#3b82f6' },
  account:   { icon: Landmark,  label: 'Accounts',   color: '#22c55e' },
  asset:     { icon: Briefcase, label: 'Assets',      color: '#f59e0b' },
  license:   { icon: FileText,  label: 'Licenses',    color: '#8b5cf6' },
  insurance: { icon: Shield,    label: 'Insurance',   color: '#ec4899' },
  custom:    { icon: Layers,    label: 'Custom',      color: '#06b6d4' },
};

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { isUnlocked } = useEncryption();

  const fetchStats = useCallback(async () => {
    const [{ data: statsResp }, { data: noticesResp }] = await Promise.all([
      api.get('/dashboard.php?action=stats'),
      api.get('/dashboard.php?action=page-notices'),
    ]);
    return {
      ...apiData({ data: statsResp }),
      _notices: apiData({ data: noticesResp }) || {},
    };
  }, []);

  const { data: stats, loading, errorMessage } = useVaultData(fetchStats, null);

  if (!isUnlocked) {
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">{getGreeting()}, {user?.display_name || user?.username}</h1>
            <p className="page-subtitle">Unlock your vault to see your dashboard</p>
          </div>
        </div>
        <div className="empty-state">
          <Lock size={40} className="empty-icon" />
          <h3>Vault is locked</h3>
          <p>Unlock your vault to view entry counts and activity.</p>
          {!localStorage.getItem('pv_lock_customized') && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, maxWidth: 360 }}>
              Your vault locks on every page refresh by default. You can change this in <strong>Security &rarr; Vault Key</strong> settings.
            </p>
          )}
        </div>
      </div>
    );
  }

  const entryCounts = stats?.entry_counts || {};
  const totalEntries = Object.values(entryCounts).reduce((a, b) => a + b, 0);
  const pageNotices = stats?._notices || {};

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">{getGreeting()}, {user?.display_name || user?.username}</h1>
          <p className="page-subtitle">Your vault at a glance</p>
        </div>
      </div>

      {/* Page notices */}
      {pageNotices?.global && (
        <div className={`alert alert-${pageNotices.global.severity || 'info'} mb-4`}>
          <Info size={16} />
          <span>{pageNotices.global.message}</span>
        </div>
      )}
      {pageNotices?.dashboard && (
        <div className={`alert alert-${pageNotices.dashboard.severity || 'info'} mb-4`}>
          <Info size={16} />
          <span>{pageNotices.dashboard.message}</span>
        </div>
      )}

      {errorMessage ? (
        <div className="alert alert-danger"><AlertTriangle size={16} /><span>{errorMessage}</span></div>
      ) : loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <>
          {/* Entry count cards */}
          <div className="grid grid-cols-3 gap-4 mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
            {Object.entries(TYPE_META).map(([type, meta]) => {
              const Icon = meta.icon;
              const count = entryCounts[type] || 0;
              return (
                <Link key={type} to="/vault" className="card" style={{ textDecoration: 'none', padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ background: meta.color + '15', borderRadius: 8, padding: 10 }}>
                    <Icon size={20} style={{ color: meta.color }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{count}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{meta.label}</div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {/* Total */}
            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center gap-2 mb-2">
                <Layers size={16} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total Entries</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{totalEntries}</div>
            </div>

            {/* Shared with me */}
            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Shared With Me</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats?.shared_with_me_count || 0}</div>
            </div>

            {/* Last activity */}
            <div className="card" style={{ padding: 16 }}>
              <div className="flex items-center gap-2 mb-2">
                <Clock size={16} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Last Login</span>
              </div>
              <div style={{ fontSize: 14 }}>
                {stats?.last_login ? new Date(stats.last_login).toLocaleString() : 'Never'}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
