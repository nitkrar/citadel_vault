import { Link } from 'react-router-dom';
import {
  Code,
  FolderTree,
  ShieldCheck,
  Lock,
  Server,
  Database,
  Shield,
  ArrowLeft,
} from 'lucide-react';

const sectionCard = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  padding: 24,
  marginBottom: 24,
};

const sectionTitle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
  fontSize: '1.05rem',
};

const codeBlock = {
  background: 'var(--bg-color)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: 16,
  fontSize: '0.8rem',
  lineHeight: 1.7,
  overflowX: 'auto',
  color: 'var(--text-muted)',
};

const tableStyle = {
  width: '100%',
  fontSize: '0.85rem',
  borderCollapse: 'collapse',
};

const thStyle = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--border-color)',
  color: 'var(--text-color)',
  fontWeight: 600,
};

const tdStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-color)',
  color: 'var(--text-muted)',
};

const tdCodeStyle = {
  ...tdStyle,
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  color: 'var(--text-color)',
};

const projectDirs = [
  ['config/', 'PHP configuration and .env environment variables'],
  ['src/api/', 'PHP REST API endpoints'],
  ['src/core/', 'PHP classes (Auth, Encryption, Response, WebAuthn)'],
  ['src/client/', 'React source code (compiles to public/)'],
  ['database/', 'MySQL/MariaDB schema and migrations'],
  ['public/', 'Built frontend output (committed, deployed)'],
  ['static/', 'Static assets (CSS, favicon) copied by Vite'],
];

const apiEndpoints = [
  ['auth.php', 'Login, register, forgot-password, profile, password change'],
  ['encryption.php', 'Vault setup, unlock, change vault key, recovery key'],
  ['accounts.php', 'CRUD for financial accounts'],
  ['assets.php', 'CRUD for assets'],
  ['insurance.php', 'CRUD for insurance policies'],
  ['licenses.php', 'CRUD for software/product licenses'],
  ['vault.php', 'CRUD for password vault entries'],
  ['portfolio.php', 'Portfolio aggregation and snapshots'],
  ['sharing.php', 'RSA hybrid encrypted data sharing between users'],
  ['reference.php', 'Currencies, countries, account/asset types'],
  ['users.php', 'Admin user management'],
];

export default function DevGuidePage() {
  return (
    <div className="auth-page" style={{ minHeight: '100vh', height: 'auto', padding: '24px 16px', alignItems: 'flex-start' }}>
      <div style={{ maxWidth: 860, width: '100%', margin: '0 auto' }}>
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
            <Link to="/help" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.875rem' }}>Help & FAQ</Link>
          </div>
        </div>

        <div className="page-header">
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Code size={24} /> Developer Guide
          </h2>
        </div>

      {/* 1. Project Structure */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>
          <FolderTree size={18} style={{ color: 'var(--primary)' }} />
          Project Structure
        </h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Directory</th>
              <th style={thStyle}>Description</th>
            </tr>
          </thead>
          <tbody>
            {projectDirs.map(([dir, desc]) => (
              <tr key={dir}>
                <td style={tdCodeStyle}>{dir}</td>
                <td style={tdStyle}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 2. Authentication Flow */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>
          <ShieldCheck size={18} style={{ color: 'var(--primary)' }} />
          Authentication Flow
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 }}>
          Citadel uses JWT-based authentication with optional WebAuthn passkey support.
        </p>
        <pre style={{ ...codeBlock, marginBottom: 16 }}>
{`Password Login:
  1. Client sends username + password to /api/auth.php?action=login
  2. Server verifies password with bcrypt
  3. Server issues JWT (JSON Web Token) with user ID and expiry
  4. Client stores JWT in localStorage
  5. JWT attached to all API requests via Authorization: Bearer header

Passkey Login (WebAuthn):
  1. Client requests authentication challenge from /api/webauthn.php
  2. Browser prompts biometric/PIN verification
  3. Signed assertion sent to server
  4. Server verifies against stored public key
  5. JWT issued on success (same as password flow)`}
        </pre>
      </div>

      {/* 3. Encryption Architecture */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>
          <Lock size={18} style={{ color: 'var(--primary)' }} />
          Encryption Architecture
        </h3>
        <pre style={{ ...codeBlock, marginBottom: 16 }}>
{`Key Derivation:
  Vault Key (numeric, user-provided)
      |
      | PBKDF2-SHA256 (600,000 iterations, per-user random salt)
      v
  Wrapping Key (256-bit)

DEK Management:
  - DEK (Data Encryption Key): random 32 bytes, generated per user at vault setup
  - DEK wrapped (encrypted) with Wrapping Key using AES-256-GCM  -->  stored in DB
  - DEK wrapped independently with Recovery Key using AES-256-GCM  -->  stored in DB

Session Flow:
  1. User enters vault key
  2. Server derives Wrapping Key via PBKDF2
  3. Wrapping Key unwraps (decrypts) the DEK
  4. DEK re-encrypted with server secret  -->  stored in HttpOnly cookie
  5. Subsequent requests decrypt cookie to obtain DEK in memory
  6. DEK used to AES-256-GCM encrypt/decrypt all sensitive fields

Recovery Flow:
  1. User provides recovery key
  2. Recovery key unwraps the independently-wrapped DEK copy
  3. User sets a new vault key
  4. DEK re-wrapped with new Wrapping Key derived from new vault key`}
        </pre>
      </div>

      {/* 4. API Design */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>
          <Server size={18} style={{ color: 'var(--primary)' }} />
          API Design
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 }}>
          RESTful PHP endpoints in <code>src/api/</code>. All protected endpoints require a valid JWT in the
          Authorization header. Encryption-dependent endpoints also require an active vault session (DEK cookie).
        </p>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Endpoint</th>
              <th style={thStyle}>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {apiEndpoints.map(([ep, desc]) => (
              <tr key={ep}>
                <td style={tdCodeStyle}>{ep}</td>
                <td style={tdStyle}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. Database */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>
          <Database size={18} style={{ color: 'var(--primary)' }} />
          Database
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
          MariaDB/MySQL with 17 tables. The full schema is defined in{' '}
          <code>database/01-schema.sql</code> with incremental migrations in{' '}
          <code>database/migrations/</code>.
        </p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          Key tables include: <code>users</code>, <code>encryption_keys</code>,{' '}
          <code>accounts</code>, <code>assets</code>, <code>insurance_policies</code>,{' '}
          <code>vault_entries</code>, <code>licenses</code>, <code>shared_items</code>,{' '}
          <code>portfolio_snapshots</code>, <code>currencies</code>,{' '}
          <code>audit_log</code>, and reference tables for account types, asset types, and countries.
        </p>
      </div>

      {/* 6. Key Security Properties */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>
          <ShieldCheck size={18} style={{ color: 'var(--primary)' }} />
          Key Security Properties
        </h3>
        <ul
          style={{
            paddingLeft: 20,
            color: 'var(--text-muted)',
            fontSize: '0.875rem',
            lineHeight: 1.8,
            margin: 0,
          }}
        >
          <li>
            <strong>Zero-knowledge:</strong> The server never sees the vault key
            or DEK in plaintext. The DEK exists in server memory only during an
            active unlocked session and is discarded when the session ends.
          </li>
          <li>
            <strong>Recovery key rotation:</strong> The recovery key is rotated
            only when it is used to recover access, ensuring the old key cannot
            be reused.
          </li>
          <li>
            <strong>Audit logging:</strong> Recovery key operations and
            administrative actions are recorded in the audit log for
            accountability.
          </li>
          <li>
            <strong>Ghost user (id=0):</strong> A system-level user with ID 0 is
            used for system operations and reference data ownership, ensuring no
            real user is implicated in automated processes.
          </li>
          <li>
            <strong>Per-user isolation:</strong> Each user has their own DEK,
            salt, and wrapped key entries. Compromising one user&apos;s vault key
            does not affect any other user.
          </li>
          <li>
            <strong>No plaintext secrets in DB:</strong> Passwords are bcrypt-hashed,
            DEKs are wrapped (encrypted), and all sensitive vault data is
            AES-256-GCM encrypted.
          </li>
        </ul>
      </div>
      </div>
    </div>
  );
}
