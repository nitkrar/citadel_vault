import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HelpCircle,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Server,
  Shield,
  ArrowLeft,
} from 'lucide-react';

const faqSections = [
  {
    title: 'Encryption & Privacy',
    items: [
      {
        q: 'What is the vault key?',
        a: 'The vault key is a key that you set during initial setup. It derives the wrapping key (via PBKDF2 with 100,000 iterations) that protects your Data Encryption Key (DEK). You must enter it each session to unlock your data. The server never stores or sees your vault key in plaintext.',
      },
      {
        q: 'What is the recovery key?',
        a: 'The recovery key is a randomly generated backup key shown once during vault setup. It independently wraps your DEK, providing a second way to decrypt your data. If you forget your password or vault key, the recovery key is the only way to regain access. You can view it anytime from your Profile page while your vault is unlocked, and regenerate it if needed.',
      },
      {
        q: 'Can admins see my data?',
        a: 'No. All sensitive data is encrypted with AES-256-GCM using your personal DEK. Administrators can manage user accounts (reset passwords, disable users) but cannot decrypt any vault data. This is a zero-knowledge architecture — the server never has access to your vault key.',
      },
      {
        q: 'What data is stored unencrypted?',
        a: 'Only the bare minimum needed for the app to function is stored unencrypted: your username, email, password hash (bcrypt, not reversible), account type selections, currency/country references, and timestamps. Everything sensitive — account names, balances, account numbers, passwords, license keys, insurance details, asset amounts, and all custom fields — is encrypted with your personal DEK using AES-256-GCM before being written to the database. Even if someone gains full database access, they cannot read your data without your vault key.',
      },
      {
        q: 'What happens if I forget my vault key?',
        a: 'Use your recovery key to change it. Go to your Profile page or the vault key modal and select the "Recovery Key" method. This re-wraps your DEK with a new vault key. The recovery key is rotated after use for security.',
      },
      {
        q: 'What happens if I lose my recovery key AND forget my vault key?',
        a: 'Your encrypted data becomes permanently inaccessible. This is by design — there are no backdoors, no admin overrides, and no way to recover the DEK without one of these keys. Always keep your recovery key in a safe place.',
      },
    ],
  },
  {
    title: 'Account Security',
    items: [
      {
        q: 'What happens if someone tries to guess my password?',
        a: 'Citadel uses progressive account lockout to protect against brute-force attacks. After repeated failed login attempts, your account is temporarily locked with escalating cooldown periods, and you receive an email notification. After too many failures, your account is fully locked and you will need to change your password to regain access. All lockout thresholds are configurable by the administrator.',
      },
      {
        q: 'What happens if someone tries to guess my vault key?',
        a: 'The same progressive lockout applies to vault unlock attempts. After repeated failed attempts, your vault is temporarily locked with escalating cooldowns. After too many failures, your vault is fully locked and you will need to change your vault key using either your old vault key or your recovery key. You receive an email notification at each lockout stage.',
      },
      {
        q: 'Can I reuse an old password?',
        a: 'No. Citadel keeps a history of your recent passwords and prevents you from reusing them. This applies to all password changes — whether voluntary, admin-forced, or via the forgot-password flow.',
      },
      {
        q: 'How do passkeys work?',
        a: 'Passkeys use the WebAuthn standard to let you authenticate with biometrics (fingerprint, face recognition) or a device PIN. Set up a passkey from your Profile page. Once registered, use it as an alternative to password-based login. You can have multiple passkeys and rename or delete them anytime.',
      },
      {
        q: 'Can I change or regenerate my recovery key?',
        a: 'Yes. Go to your Profile page and find the Recovery Key section. You can view your current key, or click "Regenerate" to create a new one. The old key is immediately invalidated. Your recovery key is also automatically rotated whenever you use it for a password reset or vault key change. You can view the activity log to see when your recovery key was last used or regenerated.',
      },
      {
        q: 'What does "Forgot password?" do?',
        a: 'Password reset works via your recovery key — not email. From the login page, click "Forgot password?" and enter your username plus your recovery key to set a new password. You will be logged in automatically and given a new recovery key. This ensures that even if someone has access to your email, they cannot reset your password without the recovery key.',
      },
      {
        q: 'How do invitations work?',
        a: 'Any existing user can invite new users from their Profile page by entering the invitee\'s email. This generates a unique invite link valid for 7 days, tied to that specific email. The invitee must register using the exact email the invite was created for. Each invite can only be used once. You can view your invite history and copy pending invite links from the Profile page.',
      },
    ],
  },
  {
    title: 'Features',
    items: [
      {
        q: 'What are account detail templates?',
        a: 'Templates save the field structure (e.g., Sort Code, Account Number) for a given account type + country combination. When you add a new account with the same combination, the fields auto-populate. You can save personal templates, and admins can create shared global templates. Personal templates always override global ones. You can also browse and reuse templates from other combinations via the "Browse Templates" button.',
      },
      {
        q: 'How do I use the "Browse Templates" button?',
        a: 'When adding an account and no template auto-matches, a "Browse Templates" button appears in the Account Details section. Click it to see all your personal and shared templates with their field names. Click "Use" on any template to load its fields into your current form. This is useful for reusing field structures across different account types.',
      },
      {
        q: 'How does sorting work on tables?',
        a: 'Click any column header to sort by that column. Click again to reverse the sort direction. The small arrow indicators show which column is active and the current direction. This works on all tables across the app — accounts, assets, insurance, licenses, vault entries, admin panels, and more.',
      },
      {
        q: 'How do I share data with another user?',
        a: 'Citadel uses RSA hybrid encryption for sharing. When you share an item, it is encrypted with the recipient\'s public key so only they can decrypt it. Navigate to the Sharing page to send or receive shared items.',
      },
      {
        q: 'What currencies are supported?',
        a: 'Citadel supports 140+ currencies with automatic exchange rate updates. GBP, INR, and USD are pinned to the top of all selectors for quick access. Exchange rates are refreshed periodically from public rate APIs. You can enable additional currencies from the admin panel.',
      },
      {
        q: 'How does the portfolio tracker work?',
        a: 'The Portfolio page aggregates all your assets and liabilities across currencies, converting them to your base currency using current exchange rates. You can view breakdowns by country, account, asset type, and currency. Portfolio snapshots are saved daily so you can track your net worth over time.',
      },
    ],
  },
  {
    title: 'General',
    items: [
      {
        q: 'Is my data backed up?',
        a: 'Your encrypted data is stored in the database. Standard database backup procedures apply (e.g., MariaDB dumps). However, since all encryption is derived from your vault key (which only you know), backups contain only encrypted data. Without your vault key or recovery key, backed-up data cannot be decrypted.',
      },
      {
        q: 'Where is the source code?',
        a: 'Citadel is fully open source. The complete source code is available at github.com/nitkrar/citadel_vault. You are encouraged to audit the code and verify the security claims yourself.',
      },
    ],
  },
];

function AccordionItem({ item }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-color)',
          fontSize: '0.9rem',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        {open ? (
          <ChevronDown size={16} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={16} style={{ flexShrink: 0 }} />
        )}
        {item.q}
      </button>
      {open && (
        <div
          style={{
            padding: '0 16px 14px 42px',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
            lineHeight: 1.6,
          }}
        >
          {item.a}
        </div>
      )}
    </div>
  );
}

function FaqSection({ section }) {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px 0',
          fontSize: '0.9rem',
          fontWeight: 600,
          color: 'var(--text-color)',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {section.title}
        <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>
          ({section.items.length})
        </span>
      </button>
      {open && section.items.map((item, i) => (
        <AccordionItem key={i} item={item} />
      ))}
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="auth-page" style={{ minHeight: '100vh', height: 'auto', padding: '24px 16px', alignItems: 'flex-start' }}>
      <div style={{ maxWidth: 820, width: '100%', margin: '0 auto' }}>
        {/* Nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <Link to="/home" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={20} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Citadel</span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link to="/login" style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>Sign In</Link>
            <Link to="/features" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.875rem' }}>Features</Link>
            <Link to="/dev-guide" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.875rem' }}>Dev Guide</Link>
          </div>
        </div>

        <div className="page-header">
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HelpCircle size={24} /> Help &amp; FAQ
          </h2>
        </div>

      {/* Section 1: Getting Started */}
      <div
        className="card"
        style={{
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            fontSize: '1.05rem',
          }}
        >
          <BookOpen size={18} style={{ color: 'var(--primary)' }} />
          Getting Started
        </h3>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          Citadel encrypts all your sensitive data with keys only you control.
          Here is the typical workflow:
        </p>
        <ol
          style={{
            paddingLeft: 20,
            color: 'var(--text-muted)',
            fontSize: '0.875rem',
            lineHeight: 1.8,
            margin: 0,
          }}
        >
          <li>
            <strong>Sign up</strong> &mdash; Create your account with a username
            and password.
          </li>
          <li>
            <strong>Set up your vault key</strong> &mdash; Choose a vault key.
            This derives the key that encrypts all your data.
          </li>
          <li>
            <strong>Save your recovery key</strong> &mdash; You will be shown a
            one-time recovery key. Store it safely &mdash; it is the only backup
            if you forget your vault key.
          </li>
          <li>
            <strong>Add your data</strong> &mdash; Add financial accounts,
            assets, passwords, licenses, and insurance policies.
          </li>
          <li>
            <strong>Everything is encrypted</strong> &mdash; All sensitive fields
            are encrypted with AES-256-GCM before being stored in the database.
          </li>
          <li>
            <strong>Unlock each session</strong> &mdash; Enter your vault key at
            the start of each session to decrypt your data.
          </li>
        </ol>
      </div>

      {/* Section 2: FAQ */}
      <div style={{ marginBottom: 24 }}>
        <h3
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            fontSize: '1.05rem',
          }}
        >
          <HelpCircle size={18} style={{ color: 'var(--primary)' }} />
          Frequently Asked Questions
        </h3>
        {faqSections.map((section) => (
          <FaqSection key={section.title} section={section} />
        ))}
      </div>

      {/* Section 3: Architecture Overview */}
      <div
        className="card"
        style={{
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            fontSize: '1.05rem',
          }}
        >
          <Server size={18} style={{ color: 'var(--primary)' }} />
          Architecture Overview
        </h3>

        <h4
          style={{
            fontSize: '0.9rem',
            marginBottom: 8,
            color: 'var(--text-color)',
          }}
        >
          System Stack
        </h4>
        <pre
          style={{
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: 16,
            fontSize: '0.8rem',
            lineHeight: 1.7,
            overflowX: 'auto',
            color: 'var(--text-muted)',
            marginBottom: 20,
          }}
        >
{`Client (React SPA)
   |
   |  HTTPS / JSON
   v
PHP REST API (src/api/)
   |
   |  PDO
   v
MariaDB / MySQL`}
        </pre>

        <h4
          style={{
            fontSize: '0.9rem',
            marginBottom: 8,
            color: 'var(--text-color)',
          }}
        >
          Encryption Flow
        </h4>
        <pre
          style={{
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: 16,
            fontSize: '0.8rem',
            lineHeight: 1.7,
            overflowX: 'auto',
            color: 'var(--text-muted)',
            marginBottom: 20,
          }}
        >
{`Vault Key (numeric, user-provided)
   |
   |  PBKDF2 (100,000 iterations, per-user salt)
   v
Wrapping Key
   |
   |  AES-256-GCM unwrap
   v
DEK (Data Encryption Key, random 32 bytes per user)
   |
   |  AES-256-GCM encrypt/decrypt
   v
Encrypted data at rest (all sensitive fields)`}
        </pre>

        <h4
          style={{
            fontSize: '0.9rem',
            marginBottom: 8,
            color: 'var(--text-color)',
          }}
        >
          Data at Rest
        </h4>
        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          All sensitive fields (account numbers, balances, passwords, policy
          details, etc.) are encrypted with the user&apos;s DEK using
          AES-256-GCM before being written to the database. The DEK itself is
          stored wrapped &mdash; once by the vault key&apos;s wrapping key and
          independently by the recovery key. The server never has access to the
          plaintext DEK outside of an active, unlocked session.
        </p>
      </div>
      </div>
    </div>
  );
}
