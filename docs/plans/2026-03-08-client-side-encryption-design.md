# Client-Side Encryption — Design Document

**Date:** 2026-03-08
**Status:** Approved (brainstorming complete)
**Scope:** Migrate Citadel from server-side encryption to client-side zero-knowledge encryption with PWA support

---

## 1. Goals & Principles

- **Zero-knowledge architecture** — Server never sees plaintext data, vault keys, or DEKs
- **Offline capability** — PWA with IndexedDB cache, offline viewing, online-only mutations
- **Server = dumb blob store** — Authenticate, store blobs, return blobs. No crypto.
- **All computation client-side** — Portfolio aggregation, export, search, sort, filter
- **Reusable crypto module** — Pure JS/TS using Web Crypto API, portable to React Native later

## 2. Migration Strategy

**Clean break.** Zero users = zero migration cost. No hybrid server/client mode. Same repo, surgery on ~5-6 core files. ~70% of codebase unchanged.

**What's reused:** Auth system (JWT, bcrypt, WebAuthn), database infrastructure, all React UI components/pages, API endpoint structure, .htaccess/deployment/config system.

**What's rewritten:** Encryption.php (gutted to ~30 lines), EncryptionContext.jsx (gains real crypto), each API endpoint (simplified — remove encrypt/decrypt calls), new crypto.js module.

## 3. Key Hierarchy & Crypto Primitives

### Algorithms (unchanged from server-side design)

| Algorithm | Purpose | Web Crypto API |
|-----------|---------|---------------|
| AES-256-GCM | All data encryption | `crypto.subtle.encrypt` |
| PBKDF2-SHA256 | Vault key -> wrapping key derivation | `crypto.subtle.deriveKey` |
| RSA-OAEP 2048 | Sharing between users | `crypto.subtle.generateKey` |

### Key Hierarchy

```
Vault Key (user memorizes, never leaves browser)
    |
    +-- PBKDF2 + salt --> Wrapping Key
    |                       |
    |                       +-- wraps DEK (stored on server as opaque blob)
    |
    DEK (Data Encryption Key, 256-bit, generated in browser)
    |
    +-- Encrypts all vault entries
    +-- Encrypts RSA private key
    +-- Encrypts recovery key

Recovery Key (parallel path)
    |
    +-- PBKDF2 + recovery_salt --> Recovery Wrapping Key
                                     |
                                     +-- wraps same DEK (stored as encrypted_dek_recovery)
```

### What changed from server-side

- DEK generated via `crypto.getRandomValues()` in browser
- DEK wrapped/unwrapped in browser — server never sees DEK or vault key
- No more "data session token" — DEK lives as non-extractable CryptoKey in JS memory
- No more `DATA_SESSION_SECRET` env variable
- Server stores same columns (encrypted_dek, vault_key_salt, etc.) as opaque blobs

## 4. Client Crypto Module (`src/client/lib/crypto.js`)

### Atomic Functions

```
Key Management:
  generateDek()                              -> CryptoKey (non-extractable)
  deriveWrappingKey(passphrase, salt, iter)   -> CryptoKey
  wrapDek(dek, wrappingKey)                  -> base64 blob
  unwrapDek(blob, wrappingKey)               -> CryptoKey or null

Data Encryption:
  encrypt(plaintext, dek)                    -> base64 blob (IV + tag + ciphertext)
  decrypt(blob, dek)                         -> plaintext or null
  encryptEntry(jsonObject, dek)              -> base64 blob
  decryptEntry(blob, dek)                    -> parsed JSON object

RSA / Sharing:
  generateKeyPair()                          -> { publicKey, privateKey }
  exportPublicKey(publicKey)                 -> PEM string
  importPublicKey(pem)                       -> CryptoKey
  encryptPrivateKey(privateKey, dek)         -> blob
  decryptPrivateKey(blob, dek)              -> CryptoKey
  hybridEncrypt(plaintext, recipientPubKey)  -> blob
  hybridDecrypt(blob, privateKey)            -> plaintext

Recovery:
  generateRecoveryKey()                      -> hex string (32 chars)
```

### Workflow Functions (compose atomics + API calls)

```
setupVault(vaultKey)                         -> { recoveryKey }
unlockVault(vaultKey)                        -> { success }
lockVault()                                  -> void
changeVaultKey(currentVaultKey, newVaultKey)  -> { success }
recoverWithRecoveryKey(recoveryKey, newVKey)  -> { success, newRecoveryKey }
viewRecoveryKey()                            -> recoveryKey string
```

### State

```
isUnlocked()  -> boolean
lock()        -> sets DEK to null
setDek(dek)   -> called after successful unlock
```

### DEK Security

- DEK is a `CryptoKey` object with `extractable: false`
- Even XSS cannot call `crypto.subtle.exportKey()` on it
- Can only be used for encrypt/decrypt, never read
- Cleared on lock, tab close, auto-lock timeout

## 5. Configuration Changes

### Server configs removed
- `DATA_SESSION_SECRET` — no server-side session tokens
- `DATA_SESSION_EXPIRY_*` — auto-lock moves to client
- `PBKDF2_ITERATIONS` — server doesn't do key derivation
- `ENCRYPTION_MODE` — always client-side
- `VAULT_KEY_MIN_LENGTH`, `VAULT_KEY_MODE` — client-side enforcement only

### Server configs kept
- `JWT_SECRET`, `JWT_EXPIRY` — auth still server-side
- `BCRYPT_COST` — login password hashing still server-side
- `LOCKOUT_TIER*` — for login lockout (not vault key lockout)
- `AUDIT_HMAC_SECRET` (new) — for hashing IPs in audit log
- All SMTP, APP_ENV, DB configs — unchanged

### Client-side config (constants in crypto.js)
```
PBKDF2_ITERATIONS = 100000
```

### User preferences (KV store, per-user)
```
vault_key_type:    'numeric' | 'alphanumeric' | 'passphrase' (default: alphanumeric)
auto_lock_mode:    'session' | 'timed' | 'manual' (default: timed)
auto_lock_timeout: seconds (default: 3600)
audit_ip_mode:     'hashed' | 'none' (default: hashed)
```

## 6. Vault Key Policy

- **No rigid enforcement** — smart defaults + visual strength meter
- **User chooses key type** — numeric (min 6), alphanumeric (min 8), passphrase (min 16)
- Key type stored server-side as UI hint (`vault_key_type` preference) — affects mobile `inputmode`
- **No server-side vault key lockout** — server never sees vault key. PBKDF2 100K iterations is the protection.
- Strength meter adapts per mode (6-digit numeric = "acceptable", not "weak")

## 7. Database Schema

### Table Overview (11 tables)

| Table | Purpose | Encrypted? |
|-------|---------|-----------|
| `users` | Identity/auth | No |
| `user_vault_keys` | Crypto material | Opaque blobs |
| `user_preferences` | KV store (flexible settings) | No |
| `entry_templates` | Global + custom field definitions | No (not sensitive) |
| `vault_entries` | User data | AES-GCM blobs |
| `shared_items` | Cross-user sharing | RSA hybrid blobs |
| `portfolio_snapshots` | Point-in-time records | AES-GCM blobs |
| `audit_log` | Security action metadata | HMAC'd IPs only |
| `currencies` | Currency definitions + rates | No (reference data) |
| `countries` | Country definitions | No (reference data) |
| `currency_rate_history` | Historical exchange rates | No (reference data) |

### users

```sql
CREATE TABLE users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(50) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            ENUM('user','admin') DEFAULT 'user',
    is_active       TINYINT(1) DEFAULT 1,
    email_verified  TINYINT(1) DEFAULT 0,
    email_verify_token      VARCHAR(255),
    password_reset_token    VARCHAR(255),
    password_reset_expires  DATETIME,
    must_reset_password TINYINT(1) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

- `must_reset_password` — admin-set flag, forces password change before any other action
- Removed vs current: `failed_vault_attempts`, `vault_locked_until`, `encryption_mode`, `vault_key_hash`, all vault key material (moved to user_vault_keys).

### user_vault_keys (1:1 with users)

```sql
CREATE TABLE user_vault_keys (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                 INT UNSIGNED NOT NULL UNIQUE,
    vault_key_salt          VARCHAR(255),
    encrypted_dek           TEXT,
    recovery_key_salt       VARCHAR(255),
    encrypted_dek_recovery  TEXT,
    recovery_key_encrypted  TEXT,
    public_key              TEXT,
    encrypted_private_key   TEXT,
    must_reset_vault_key    TINYINT(1) DEFAULT 0,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### user_preferences (KV store)

```sql
CREATE TABLE user_preferences (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,
    setting_key     VARCHAR(100) NOT NULL,
    setting_value   TEXT NOT NULL,
    UNIQUE INDEX (user_id, setting_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Defaults managed client-side in `src/client/lib/defaults.js`. No schema changes needed to add new preferences.

### entry_templates

```sql
CREATE TABLE entry_templates (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    template_key            VARCHAR(100) NOT NULL,
    owner_id                INT UNSIGNED NULL,
    name                    VARCHAR(255) NOT NULL,
    icon                    VARCHAR(50) NULL,
    country_code            VARCHAR(10) NULL,
    subtype                 VARCHAR(100) NULL,
    schema_version          INT NOT NULL DEFAULT 1,
    fields                  JSON NOT NULL,
    is_active               TINYINT(1) DEFAULT 1,
    promotion_requested     TINYINT(1) DEFAULT 0,
    promotion_requested_at  TIMESTAMP NULL,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX (template_key, owner_id, country_code, subtype),
    INDEX (owner_id),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- `owner_id = NULL` -> global template. `owner_id = N` -> user's custom template.
- `country_code` + `subtype` -> template variants (US brokerage, IN PPF, etc.)
- `fields` JSON: `[{ "key": "title", "label": "Title", "type": "text", "required": true }, ...]`
- `promotion_requested` -> simple flag for user to request admin promotes to global
- Replaces `entityFieldConfigs.js` (deleted) and `account_types` table (merged in)
- Valid entry types: `['password', 'account', 'asset', 'license', 'insurance', 'custom']`
- Template resolution: most specific match wins (country+subtype > country > subtype > generic)

### vault_entries (replaces 5 entity tables)

```sql
CREATE TABLE vault_entries (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,
    entry_type      VARCHAR(50) NOT NULL,
    template_id     INT UNSIGNED NULL,
    schema_version  INT NOT NULL DEFAULT 1,
    encrypted_data  TEXT NOT NULL,
    deleted_at      TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (user_id, entry_type, deleted_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES entry_templates(id)
);
```

- Replaces: `password_vault`, `accounts`, `assets`, `licenses`, `insurance_policies`
- One encrypted blob per entry. Client owns all field structure.
- Soft delete with 1-day recovery (`deleted_at` not null = soft deleted)
- `entry_type` validated server-side against allowed list
- `template_id` NO CASCADE on delete -> entries survive, UI falls back to JSON
- Orphaned entries (missing template) -> client shows JSON, prompts relink via API

### shared_items

```sql
CREATE TABLE shared_items (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sender_id               INT UNSIGNED NOT NULL,
    recipient_identifier    VARCHAR(255) NOT NULL,
    recipient_id            INT UNSIGNED NULL,
    source_entry_id         INT UNSIGNED NOT NULL,
    entry_type              VARCHAR(50) NOT NULL,
    template_id             INT UNSIGNED NULL,
    encrypted_data          TEXT NOT NULL,
    is_ghost                TINYINT(1) DEFAULT 0,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (sender_id, source_entry_id),
    INDEX (recipient_id),
    INDEX (recipient_identifier),
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (source_entry_id) REFERENCES vault_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES entry_templates(id)
);
```

**Three share states:**

| recipient_id | is_ghost | State |
|-------------|----------|-------|
| User ID | 0 | Active share |
| Ghost user ID | 1 | Pending (recipient never existed) |
| NULL | 0 | Orphaned (recipient deleted account) |

**Cascade behavior:**
- `sender_id ON DELETE CASCADE` -> sender deletes account, all shares gone
- `source_entry_id ON DELETE CASCADE` -> sender deletes entry, shares auto-revoked (UI warns first)
- `recipient_id ON DELETE SET NULL` -> recipient deletes account, share becomes orphaned

**Sharing model:**
- Shared items are read-only views, never copied to recipient's vault
- Sender retains full control: revoke, update (on-edit re-share)
- Sharing works by username OR email (blind share, no user existence leak)
- Ghost shares: server generates RSA key pair, discards private key. Data is unrecoverable.
- No deferred access for future signups
- On-edit re-share: sender edits entry -> client re-encrypts for all recipients -> batch update
- Custom template sharing: server JOINs template metadata inline in shared item response

### portfolio_snapshots

```sql
CREATE TABLE portfolio_snapshots (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,
    snapshot_date   DATE NOT NULL,
    snapshot_time   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    encrypted_data  TEXT NOT NULL,
    INDEX (user_id, snapshot_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- Multiple snapshots per day allowed (no UNIQUE on date)
- Manual only — user clicks "Save Snapshot", no auto-snapshotting
- Default portfolio view: always compute live from decrypted entries
- No retention limit (~365KB/year, negligible)

### audit_log

```sql
CREATE TABLE audit_log (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NULL,
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(100) NULL,
    resource_id     INT UNSIGNED NULL,
    ip_hash         VARCHAR(64) NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id),
    INDEX (action),
    INDEX (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

- **Security-only logging:** login, failed login, password change, vault unlock, vault key change, recovery key used, share created/revoked, account deleted, WebAuthn registration, IP preference change
- **Never logs:** entry CRUD, snapshots, preference changes, template operations
- IP hashed with HMAC-SHA256 + `AUDIT_HMAC_SECRET` (env variable)
- User can opt out of IP hashing (set `audit_ip_mode = 'none'` in preferences)
- `ON DELETE SET NULL` -> user deletes account, logs become anonymous
- Disclosed at registration: mandatory acknowledgment, optional opt-out

### Reference Data Tables (unchanged from current)

```sql
-- currencies, countries, currency_rate_history
-- Kept as-is. Server fetches exchange rates from external API, caches them.
-- Client reads rates for conversion math (all computation client-side).
```

## 8. Storage Adapter Pattern

### Interface

```php
interface StorageAdapter {
    // Vault entries
    function getEntries(int $userId, ?string $entryType = null): array;
    function getEntry(int $userId, int $entryId): ?array;
    function createEntry(int $userId, string $entryType, string $encryptedData, ...): int;
    function updateEntry(int $userId, int $entryId, string $encryptedData): bool;
    function deleteEntry(int $userId, int $entryId): bool;

    // User vault keys
    function getVaultKeys(int $userId): ?array;
    function setVaultKeys(int $userId, array $keyData): bool;

    // Preferences (KV)
    function getPreferences(int $userId): array;
    function setPreference(int $userId, string $key, string $value): bool;

    // Sharing
    function getSharedByMe(int $userId): array;
    function getSharedWithMe(int $userId): array;
    function createShare(array $shareData): int;
    function updateShare(int $shareId, string $encryptedData): bool;
    function deleteShare(int $senderId, int $shareId): bool;

    // Snapshots
    function getSnapshots(int $userId, ?string $fromDate, ?string $toDate): array;
    function createSnapshot(int $userId, string $date, string $encryptedData): int;

    // Audit
    function logAction(int $userId, string $action, ?string $resourceType, ?int $resourceId, ?string $ipHash): void;
    function getAuditLog(int $userId, ?string $fromDate, ?string $toDate): array;

    // Templates
    function getTemplates(int $userId): array;
    function createTemplate(int $userId, array $templateData): int;
    function updateTemplate(int $userId, int $templateId, array $data): bool;
}
```

### Implementations

- **MariaDbAdapter** — production (HelioHost). Build now.
- **InMemoryAdapter** — testing. Build now.
- **Future:** SqliteAdapter, JsonFileAdapter, PostgresAdapter

### Configuration

```php
// config/config.php
define('STORAGE_ADAPTER', env('STORAGE_ADAPTER', 'mariadb'));

// src/core/Storage.php
class Storage {
    public static function adapter(): StorageAdapter {
        return match(STORAGE_ADAPTER) {
            'mariadb'  => new MariaDbAdapter(),
            'memory'   => new InMemoryAdapter(),
            default    => throw new Exception('Unknown storage adapter'),
        };
    }
}
```

## 9. API Layer

### Universal Pattern

```
BEFORE: Request -> JWT auth -> Extract DEK -> Decrypt/Encrypt fields -> DB -> Response
AFTER:  Request -> JWT auth -> DB -> Response
```

### API Response Format

Every entry response contains only `template` and `data`, no unnecessary IDs:

```json
{
    "id": 42,
    "template": { "name": "Passwords", "icon": "key", "fields": [...] },
    "data": "base64-encrypted-blob...",
    "created_at": "...",
    "updated_at": "..."
}
```

### Sharing API (separate endpoints)

```
GET  /api/sharing.php?action=recipient-key&identifier=bob@gmail.com
  -> Always returns a public key (real user or ghost). Never 404.

POST /api/sharing.php?action=share
  -> { source_entry_id, recipients: [{ identifier, encrypted_data }] }

POST /api/sharing.php?action=update
  -> { source_entry_id, recipients: [{ user_id, encrypted_data }] }

POST /api/sharing.php?action=revoke
  -> { source_entry_id, user_ids: [...] }

GET  /api/sharing.php?action=shared-by-me
  -> [{ id, recipient_identifier, is_ghost, template, created_at }]
  -> No encrypted data (sender has the original). Username only, no email.

GET  /api/sharing.php?action=shared-with-me
  -> [{ id, sender (username only), template, data, created_at }]
```

### Template API

```
GET  /api/templates.php
  -> All global templates + user's custom templates

POST /api/templates.php?action=create
  -> { template_key, name, icon, fields, country_code?, subtype? }

PUT  /api/templates.php?action=update&id=X
  -> { name?, icon?, fields?, is_active? }

POST /api/templates.php?action=relink
  -> { old_template_id, new_template_id } (metadata-only update on vault_entries)

POST /api/templates.php?action=request-promotion&id=X
  -> Sets promotion_requested flag
```

### No emails in API responses

Username only for sender/recipient display. `recipient_identifier` returned only in shared-by-me (sender's own input). Prevents email leakage via API interception.

## 10. Client Entry Store (IndexedDB)

### Interface (swappable backing store)

```js
interface EntryStore {
    getAll(): Entry[]
    getByType(entryType: string): Entry[]
    getById(id: number): Entry | null
    put(entry: Entry): void
    delete(id: number): void
    clear(): void
}
```

### Implementation Strategy

- **Build with IndexedDB from day one** (PWA-ready)
- Online: fetch from server -> update IndexedDB -> render
- Offline: read from IndexedDB -> render -> show "offline, data may be stale" banner
- Shared items: always fetch from server when online (live references)
- Snapshots: cache once fetched (immutable)
- Clear IndexedDB on vault lock / tab close

## 11. PWA (from day one)

### Components

- **Vite PWA plugin** (`vite-plugin-pwa`) — auto-generates service worker
- **Web App Manifest** — app name, icons, theme, installable
- **IndexedDB** — entry store (see above)
- **No offline sync** — mutations require network. Queue for later.

### Cache Strategy

- Static assets (JS, CSS, HTML): service worker cache, offline-first
- Vault entries: IndexedDB, fetch-first when online
- Shared items: always fetch from server when online
- Templates: fetch once on login, cache in IndexedDB
- Exchange rates: fetch when online, serve stale when offline

## 12. Admin Features

### Force Reset Flags

- `users.must_reset_password` — admin sets this, client forces password change before any other action
- `user_vault_keys.must_reset_vault_key` — admin sets this, client forces vault key change on next unlock (client-side: enter current key, set new key, DEK re-wrapped)
- Admin sets these from the Admin page per-user

### Global Page Notices

Admin can set banners visible to all users on specific pages (or globally). Stored as a single JSON file on the server:

**`config/notices.json`:**
```json
{
  "global": { "message": "Maintenance tonight at 2am", "severity": "info" },
  "vault": { "message": "Export feature is experimental", "severity": "warning" },
  "export": null,
  "sharing": null
}
```

- No database — single JSON file, admin edits directly or via admin page
- `null` = no notice for that page
- Client fetches once on login: `GET /api/admin.php?action=page-notices` → server reads file, returns JSON
- Client caches in memory until next login/refresh
- Severity levels: `info`, `warning`, `critical`
- File lives in `config/` alongside `.env` (gitignored or committed, admin's choice)

## 13. UX/UI

### Page Structure

```
Public: HomePage, LoginPage, RegisterPage, ForgotPasswordPage, VerifyEmailPage, FeaturesPage
Auth:   DashboardPage, VaultPage, PortfolioPage, SharingPage, ExportPage,
        SecurityPage (NEW), ProfilePage, TemplatesPage (NEW), AdminPage, HelpPage
```

### Key UX Decisions

- **5 entity pages -> 1 VaultPage** with type filter tabs
- **ProfilePage slimmed** — account/identity only
- **SecurityPage (new)** — vault key, recovery, auto-lock, audit log, IP preference, WebAuthn, danger zone
- **TemplatesPage (new)** — browse global, manage custom, request promotion
- **Dashboard: zero decryption** — counts from DB queries, last login/unlock times from audit_log
- **VaultPage: fetch all entries once**, decrypt, cache in IndexedDB, filter/search/sort client-side
- **Shared items in vault list** — marked with different icon, read-only, shows origin
- **Portfolio: always compute live**, manual snapshot button, history from snapshots
- **Export: 100% client-side** — no server involvement, file never touches server
- **Bulk add/edit supported** — client encrypts each entry, batch API call
- **Soft delete with 1-day recovery** — "Recently Deleted" section in VaultPage
- **Delete warning for shared entries** — "This is shared with N people, will revoke access"

### Registration Flow — IP Disclosure

Mandatory step at registration:

```
Security & Privacy

To protect your account, we log security-related actions
(logins, vault access, key changes, sharing) with a hashed
fingerprint of your IP address. This helps detect unauthorized
access. We never log your day-to-day data activity.

We cannot see your actual IP — only a one-way hash for
pattern matching.

[x] I understand (required)
[ ] Disable IP logging (changeable later in Settings)
```

## 14. Recovery Flows

### Recovery Key

- Generated client-side during vault setup
- Shown once to user, downloadable
- Encrypted with DEK and stored on server (`recovery_key_encrypted`)
- Viewable again when vault is unlocked (decrypt with DEK)
- Recovery flow: enter recovery key -> PBKDF2 -> unwrap DEK -> set new vault key -> re-wrap DEK -> new recovery key

### Forgot Login Password

- Unchanged from current design. Independent of vault encryption.
- Server resets login password via email. Vault stays locked until vault key entered.

### Lost Vault Key + Lost Recovery Key

- Data is permanently unrecoverable. By design. Same as 1Password, Bitwarden.
- UX: prominent recovery key save/print during setup.

## 15. Decision Log

1. Clean break — client-side encryption only, no hybrid
2. Same repo — surgery on existing code
3. Web Crypto API — zero extra dependencies, reusable JS module
4. Server = dumb blob store — authenticate + store + return
5. All computation client-side — portfolio, export, everything
6. Single vault_entries table — replaces 5 entity tables
7. portfolio_snapshots separate — different access pattern, multiple per day
8. shared_items separate — different ownership, RSA-encrypted, read-only views
9. Shared items never copied to vault — sender controls, revocable, auto-sync on edit
10. Vault key policy — smart defaults + strength meter, user chooses type
11. Drop server-side vault key lockout — PBKDF2 is the protection
12. Recovery key — client-side, viewable when unlocked
13. Ghost shares — write-only dead drop, private key discarded, no deferred access
14. Sharing by username OR email — blind share, no user existence leak
15. Profile page redesign — security/vault settings get own page
16. Templates in DB, not code — entry_templates table, plaintext
17. Custom entries use entry_type='custom' — differentiated by template_id
18. No CASCADE on template deletion — entries survive, JSON fallback
19. Orphan handling — JSON fallback, relink API
20. Soft delete 1-day recovery on vault_entries
21. Security-only audit logging — HMAC'd IPs, opt-out, disclosed at registration
22. Storage adapter pattern — interface + MariaDB + InMemory
23. user_preferences as KV store — no schema evolution
24. Users table split — users + user_vault_keys + user_preferences
25. API responses: template + data only, no unnecessary IDs
26. No emails in API responses — username only
27. DEK as non-extractable CryptoKey in browser memory
28. Template promotion — simple flag on entry_templates
29. Templates support country/subtype variations
30. Reference data (currencies, countries, rates) carried forward
31. Exchange rate fetching stays server-side
32. account_types merged into templates as subtypes
33. PWA from day one — service worker, manifest, IndexedDB
34. No offline sync — mutations require network
35. Shared items always fetched live when online
36. IndexedDB entry store with swappable interface
37. Dashboard: zero decryption, counts from DB, audit timestamps
38. Portfolio: always compute live, manual snapshots only
39. Force reset flags — `must_reset_password` on users, `must_reset_vault_key` on user_vault_keys, admin-set
40. Global page notices — single `config/notices.json` file, fetched once on login, no database
41. Admin page manages: user activation, force resets, page notices, template promotion requests
