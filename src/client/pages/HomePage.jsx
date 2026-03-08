import { Link } from 'react-router-dom';
import {
  Shield,
  Lock,
  EyeOff,
  Code,
  DollarSign,
  Fingerprint,
} from 'lucide-react';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'Citadel';

const features = [
  {
    icon: Lock,
    title: 'End-to-End Encryption',
    desc: 'Your data is encrypted with AES-256-GCM using a key derived from your personal vault key. Not even administrators can read your data.',
  },
  {
    icon: EyeOff,
    title: 'Zero Knowledge',
    desc: "We don't log browsing patterns, track usage analytics, or collect any data beyond your login credentials. Your vault, your business.",
  },
  {
    icon: Code,
    title: 'Open Source',
    desc: 'Every line of code is public at github.com/nitkrar/citadel_vault. Audit it yourself \u2014 transparency is not optional, it\u2019s the design.',
  },
  {
    icon: Shield,
    title: 'Recovery Key System',
    desc: 'Forgot your password? Use your recovery key to reset it. No email verification, no third parties \u2014 you hold the only backup.',
  },
  {
    icon: DollarSign,
    title: 'Multi-Currency Support',
    desc: 'Track assets across 140+ currencies with automatic exchange rate updates. Pin your preferred currencies to the top.',
  },
  {
    icon: Fingerprint,
    title: 'Passkey Authentication',
    desc: 'Sign in with your fingerprint, face, or device PIN. Modern WebAuthn authentication alongside traditional passwords.',
  },
];

export default function HomePage() {
  return (
    <div className="auth-page">
      <div
        className="auth-card"
        style={{ maxWidth: 860, width: '100%', padding: '40px 36px' }}
      >
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div
            style={{
              width: 64,
              height: 64,
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Shield size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: 4 }}>
            {APP_NAME}
          </h1>
          <p
            style={{
              fontSize: '1.125rem',
              color: 'var(--primary)',
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            Your Personal Encrypted Vault
          </p>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '0.95rem',
              maxWidth: 560,
              margin: '0 auto 24px',
              lineHeight: 1.6,
            }}
          >
            A secure, self-hosted platform to manage your financial accounts,
            assets, passwords, licenses, and insurance &mdash; all encrypted
            with keys only you control.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Link to="/login" className="btn btn-primary btn-lg">
              Sign In
            </Link>
            <Link to="/register" className="btn btn-outline btn-lg">
              Create Account
            </Link>
          </div>
        </div>

        {/* Feature cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
            marginBottom: 32,
          }}
        >
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  padding: '20px 16px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Icon size={18} style={{ color: 'var(--primary)' }} />
                  <strong style={{ fontSize: '0.9rem' }}>{f.title}</strong>
                </div>
                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-muted)',
                    lineHeight: 1.55,
                    margin: 0,
                  }}
                >
                  {f.desc}
                </p>
              </div>
            );
          })}
        </div>

        {/* Bottom links */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            flexWrap: 'wrap',
          }}
        >
          <Link
            to="/features"
            style={{
              color: 'var(--primary)',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Features &amp; Changelog
          </Link>
          <Link
            to="/help"
            style={{
              color: 'var(--primary)',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Help &amp; FAQ
          </Link>
          <Link
            to="/dev-guide"
            style={{
              color: 'var(--primary)',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Developer Guide
          </Link>
        </div>
      </div>
    </div>
  );
}
