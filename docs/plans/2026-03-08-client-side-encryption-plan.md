# Client-Side Encryption Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use 10x-engineer:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Citadel from server-side encryption to client-side zero-knowledge encryption with PWA support.

**Architecture:** Client-side AES-256-GCM encryption via Web Crypto API. Server becomes a dumb blob store (auth + CRUD + audit). All crypto in `src/client/lib/crypto.js`. IndexedDB for client caching. PWA from day one.

**Tech Stack:** Web Crypto API (browser-native), React 19, Vite 7 (with vite-plugin-pwa), PHP 8 (simplified), MariaDB, IndexedDB

**Design Document:** `docs/plans/2026-03-08-client-side-encryption-design.md` — READ THIS FIRST for full context on every decision.

---

## CRITICAL: Core Functionality Safety Rule

**Any agent working on core functionality (encryption, auth, vault key management, recovery, sharing, DEK handling) MUST:**

1. **Think before implementing.** Before writing code for any crypto or auth flow, reason through the full data flow end-to-end. Trace what happens to keys, blobs, and tokens at every step.
2. **Challenge the design.** If something in this plan doesn't make sense — a key derivation step seems wrong, a flow has a gap, an edge case is unhandled — **STOP and check back with the user** before proceeding. Do NOT silently implement something that feels off.
3. **Verify invariants.** After implementing any core function, verify these invariants hold:
   - The server NEVER sees plaintext data, vault keys, or DEKs
   - The DEK is NEVER extractable from the CryptoKey object
   - Recovery key path can always unwrap the same DEK as the vault key path
   - Ghost shares are truly unrecoverable (private key discarded)
   - Shared items are encrypted with the recipient's public key, not the sender's
4. **Test the unhappy path.** For every core function, think about: wrong vault key, expired session, missing blobs, corrupt data, offline state. Ensure graceful failures, not silent data loss.
5. **No shortcuts on crypto.** Never implement a "temporary" or "simplified" version of encryption. Either do it correctly or flag it as blocked.

This rule applies to Tasks: 3 (crypto module), 6 (vault keys API), 9 (sharing API), 14 (EncryptionContext), 15 (EncryptionKeyModal), and any task touching `crypto.js` or `EncryptionContext.jsx`.

---

## Task Dependencies

Tasks in the same parallel group can be worked on concurrently.
Tasks with dependencies must wait for their prerequisites.

| Task | Parallel Group | Depends On | Files Touched |
|------|---------------|------------|---------------|
| 1: Database schema | A | — | `database/01-schema.sql`, `database/02-seed.sql` |
| 2: Storage adapter interface + MariaDB | A | — | `src/core/StorageAdapter.php`, `src/core/MariaDbAdapter.php`, `src/core/InMemoryAdapter.php`, `src/core/Storage.php` |
| 3: Client crypto module | A | — | `src/client/lib/crypto.js` |
| 4: Client entry store (IndexedDB) | A | — | `src/client/lib/entryStore.js` |
| 5: Client defaults + preference helpers | A | — | `src/client/lib/defaults.js` |
| 6: Server API — vault keys endpoint | B | Tasks 1, 2 | `src/api/encryption.php` |
| 7: Server API — vault entries endpoint | B | Tasks 1, 2 | `src/api/vault.php` |
| 8: Server API — templates endpoint | B | Tasks 1, 2 | `src/api/templates.php` |
| 9: Server API — sharing endpoint | B | Tasks 1, 2 | `src/api/sharing.php` |
| 10: Server API — snapshots endpoint | B | Tasks 1, 2 | `src/api/snapshots.php` |
| 11: Server API — audit + dashboard stats | B | Tasks 1, 2 | `src/api/audit.php`, `src/api/dashboard.php` |
| 12: Server API — preferences endpoint | B | Tasks 1, 2 | `src/api/preferences.php` |
| 13: Server config + Encryption.php cleanup | B | Task 2 | `config/config.php`, `src/core/Encryption.php` |
| 14: EncryptionContext rewrite | C | Tasks 3, 4, 6 | `src/client/contexts/EncryptionContext.jsx` |
| 15: EncryptionKeyModal rewrite | C | Task 14 | `src/client/components/EncryptionKeyModal.jsx` |
| 16: API client (axios) update | C | Task 14 | `src/client/api/client.js` |
| 17: VaultPage (unified) | D | Tasks 14, 7, 8, 4 | `src/client/pages/VaultPage.jsx`, delete old entity pages |
| 18: DashboardPage | D | Tasks 11, 14 | `src/client/pages/DashboardPage.jsx` |
| 19: SharingPage | D | Tasks 9, 14, 3 | `src/client/pages/SharingPage.jsx` |
| 20: PortfolioPage | D | Tasks 10, 14, 4 | `src/client/pages/PortfolioPage.jsx` |
| 21: ExportPage (client-side only) | D | Tasks 14, 4 | `src/client/pages/ExportPage.jsx` |
| 22: SecurityPage (new) | D | Tasks 6, 11, 12, 14 | `src/client/pages/SecurityPage.jsx` |
| 23: ProfilePage (slimmed) | D | Task 14 | `src/client/pages/ProfilePage.jsx` |
| 24: TemplatesPage (new) | D | Tasks 8, 14 | `src/client/pages/TemplatesPage.jsx` |
| 25: Registration flow update | D | Tasks 12, 14 | `src/client/pages/RegisterPage.jsx` |
| 26: PWA setup | E | Task 17 | `vite.config.js`, `manifest.json`, `package.json` |
| 27: Router + nav + cleanup | E | Tasks 17-25 | `src/client/App.jsx`, `src/client/components/Layout.jsx` |
| 28: Delete old files | F | Task 27 | Multiple old files |
| 29: Build + deploy verification | F | Task 28 | `dist/`, `.htaccess` |

**Parallel execution:** Group A (4 tasks) runs first in parallel. Group B (8 tasks) runs after A. Group C after relevant B tasks. Group D after C. Group E after D. Group F final.

---

### Task 1: Database Schema
**Parallel group:** A

**Files:**
- Rewrite: `database/01-schema.sql`
- Rewrite: `database/02-seed.sql`

**Step 1: Write the new schema**

Replace the entire `database/01-schema.sql` with the 11-table schema defined in the design document (Section 7). Tables: `users`, `user_vault_keys`, `user_preferences`, `entry_templates`, `vault_entries`, `shared_items`, `portfolio_snapshots`, `audit_log`, `currencies`, `countries`, `currency_rate_history`.

Key points:
- `users` table: no vault key material, no lockout columns, no encryption_mode. Add `must_reset_password` flag.
- `user_vault_keys`: add `must_reset_vault_key` flag
- `vault_entries`: single `encrypted_data` TEXT column, `deleted_at` for soft delete
- `shared_items`: three-state sharing (active, ghost, orphaned)
- `audit_log`: `ip_hash` VARCHAR(64) instead of `ip_address`
- `user_preferences`: KV store pattern (setting_key + setting_value)
- `entry_templates`: includes `country_code`, `subtype`, `promotion_requested` columns
- Keep reference data tables (`currencies`, `countries`, `currency_rate_history`) from current schema

**Step 2: Write seed data**

Update `database/02-seed.sql`:
- Seed global templates for each entry type (password, account, asset, license, insurance)
- Include country/subtype variants for accounts (savings, checking, brokerage, 401k, etc.)
- Include subtype variants for assets (real_estate, vehicle, stock, bond, crypto)
- Include subtype variants for insurance (life, auto, health, home)
- Seed currencies and countries (carry forward from current seed)
- Seed admin user (no vault key material — they set up vault on first login)

**Step 3: Test locally**

```bash
mysql -u citadel_db_admin -p citadel_vault_db < database/01-schema.sql
mysql -u citadel_db_admin -p citadel_vault_db < database/02-seed.sql
```

Expected: no errors, all tables created, seed data inserted.

**Step 4: Commit**

```bash
git commit -m "Rewrite database schema for client-side encryption"
```

---

### Task 2: Storage Adapter Interface + MariaDB + InMemory
**Parallel group:** A

**Files:**
- Create: `src/core/StorageAdapter.php`
- Create: `src/core/MariaDbAdapter.php`
- Create: `src/core/InMemoryAdapter.php`
- Create: `src/core/Storage.php`

**Step 1: Write the StorageAdapter interface**

Create `src/core/StorageAdapter.php` with the interface defined in design document Section 8. ~15 methods covering: vault entries, vault keys, preferences, sharing, snapshots, audit, templates.

**Step 2: Implement MariaDbAdapter**

Create `src/core/MariaDbAdapter.php` implementing `StorageAdapter`. Each method maps to SQL queries against the new schema. Use PDO prepared statements. Include:
- `getEntries()` — `SELECT ... FROM vault_entries WHERE user_id = ? AND deleted_at IS NULL`
- `createEntry()` — `INSERT INTO vault_entries` with server-side `entry_type` validation
- `deleteEntry()` — set `deleted_at = NOW()` (soft delete)
- `getSharedWithMe()` — JOIN with entry_templates for inline template data
- `logAction()` — respects user's `audit_ip_mode` preference
- Soft-delete cleanup: delete rows where `deleted_at < NOW() - INTERVAL 1 DAY`

**Step 3: Implement InMemoryAdapter**

Create `src/core/InMemoryAdapter.php` implementing `StorageAdapter` using PHP arrays. For testing without database. Simple array storage with ID auto-increment.

**Step 4: Create Storage factory**

Create `src/core/Storage.php` with static `adapter()` method. Reads `STORAGE_ADAPTER` from config, returns the matching adapter instance. Default: `mariadb`.

**Step 5: Test with simple PHP script**

```bash
php -r "require 'config/config.php'; require 'src/core/Storage.php'; var_dump(Storage::adapter());"
```

Expected: MariaDbAdapter instance.

**Step 6: Commit**

```bash
git commit -m "Add storage adapter pattern with MariaDB and InMemory implementations"
```

---

### Task 3: Client Crypto Module
**Parallel group:** A

**Files:**
- Create: `src/client/lib/crypto.js`

**Step 1: Implement atomic crypto functions**

Create `src/client/lib/crypto.js` with all functions from design document Section 4:
- Key Management: `generateDek()`, `deriveWrappingKey()`, `wrapDek()`, `unwrapDek()`
- Data Encryption: `encrypt()`, `decrypt()`, `encryptEntry()`, `decryptEntry()`
- RSA/Sharing: `generateKeyPair()`, `exportPublicKey()`, `importPublicKey()`, `encryptPrivateKey()`, `decryptPrivateKey()`, `hybridEncrypt()`, `hybridDecrypt()`
- Recovery: `generateRecoveryKey()`
- State: `isUnlocked()`, `lock()`, `setDek()`

Key implementation details:
- DEK as non-extractable CryptoKey: `extractable: false` in `importKey`/`unwrapKey`
- AES-GCM with 12-byte IV: `crypto.getRandomValues(new Uint8Array(12))`
- Output format: `base64(IV + ciphertext)` (Web Crypto appends auth tag to ciphertext)
- PBKDF2: 100000 iterations, SHA-256, 256-bit output
- RSA-OAEP: 2048 bits, SHA-256

**Step 2: Implement workflow functions**

In the same file, implement:
- `setupVault(vaultKey)` — generate DEK, wrap with vault key, generate recovery key, generate RSA pair, return everything for server storage
- `unlockVault(vaultKeyBlobs, vaultKey)` — derive wrapping key, unwrap DEK, set state
- `lockVault()` — clear DEK
- `changeVaultKey(oldBlobs, currentVaultKey, newVaultKey)` — unwrap with old, re-wrap with new
- `recoverWithRecoveryKey(recoveryBlobs, recoveryKey, newVaultKey)` — unwrap with recovery, set new vault key + new recovery key
- `viewRecoveryKey(recoveryKeyEncryptedBlob)` — decrypt with DEK

Note: workflow functions take server blobs as parameters. They do NOT make API calls. The calling code (EncryptionContext) handles API calls.

**Step 3: Test in browser console**

Open dev tools, import the module, test:
```js
const dek = await generateDek();
const blob = await encryptEntry({ title: "test", password: "secret" }, dek);
const result = await decryptEntry(blob, dek);
console.assert(result.title === "test");
console.assert(result.password === "secret");
```

**Step 4: Commit**

```bash
git commit -m "Add client-side crypto module with Web Crypto API"
```

---

### Task 4: Client Entry Store (IndexedDB)
**Parallel group:** A

**Files:**
- Create: `src/client/lib/entryStore.js`

**Step 1: Implement EntryStore with IndexedDB**

Create `src/client/lib/entryStore.js`:
- Uses IndexedDB database `citadel_vault`
- Object stores: `entries`, `shared_items`, `templates`, `snapshots`
- Interface: `getAll()`, `getByType(type)`, `getById(id)`, `put(entry)`, `putAll(entries)`, `delete(id)`, `clear()`
- `clear()` wipes all stores — called on vault lock and tab close
- All operations async (IndexedDB is async by nature)
- Indexes on `entry_type` for efficient filtering

**Step 2: Add beforeunload cleanup**

```js
window.addEventListener('beforeunload', () => entryStore.clear());
```

**Step 3: Test in browser console**

```js
await entryStore.put({ id: 1, entry_type: 'password', data: { title: 'Gmail' } });
const results = await entryStore.getByType('password');
console.assert(results.length === 1);
await entryStore.clear();
```

**Step 4: Commit**

```bash
git commit -m "Add IndexedDB entry store for client-side caching"
```

---

### Task 5: Client Defaults + Preference Helpers
**Parallel group:** A

**Files:**
- Create: `src/client/lib/defaults.js`

**Step 1: Implement preference defaults and helpers**

Create `src/client/lib/defaults.js`:

```js
export const PREFERENCE_DEFAULTS = {
    vault_key_type: 'alphanumeric',
    auto_lock_mode: 'timed',
    auto_lock_timeout: '3600',
    audit_ip_mode: 'hashed',
};

export const VAULT_KEY_MINIMUMS = {
    numeric: 6,
    alphanumeric: 8,
    passphrase: 16,
};

export const VALID_ENTRY_TYPES = [
    'password', 'account', 'asset', 'license', 'insurance', 'custom'
];

export function getUserPreference(prefs, key) {
    return prefs[key] ?? PREFERENCE_DEFAULTS[key];
}

export function getVaultKeyMinLength(keyType) {
    return VAULT_KEY_MINIMUMS[keyType] || 8;
}
```

**Step 2: Commit**

```bash
git commit -m "Add client-side preference defaults and helpers"
```

---

### Task 6: Server API — Vault Keys Endpoint
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Rewrite: `src/api/encryption.php`

**Step 1: Rewrite encryption.php as blob pass-through**

The endpoint now only stores and retrieves opaque blobs. Actions:

- `GET ?action=key-material` — returns `{ vault_key_salt, encrypted_dek }` (for unlock)
- `GET ?action=recovery-material` — returns `{ recovery_key_salt, encrypted_dek_recovery }` (for recovery)
- `GET ?action=recovery-key-encrypted` — returns `{ recovery_key_encrypted }` (for viewing recovery key)
- `POST ?action=setup` — stores all vault key material (salt, encrypted_dek, recovery blobs, RSA keys). Called once after registration.
- `POST ?action=update-vault-key` — swaps vault_key_salt + encrypted_dek
- `POST ?action=update-recovery` — swaps recovery blobs
- `POST ?action=update-all` — swaps all vault key material (used after recovery)

All endpoints require JWT auth. No crypto operations. Just read/write to `user_vault_keys` via `Storage::adapter()`.

Log security actions: `vault_setup`, `vault_key_changed`, `recovery_key_used`.

**Step 2: Test with curl**

```bash
curl -X POST http://localhost:8081/src/api/encryption.php?action=setup \
  -H "Authorization: Bearer $JWT" \
  -d '{"vault_key_salt":"abc","encrypted_dek":"def",...}'
```

Expected: 200 OK.

**Step 3: Commit**

```bash
git commit -m "Rewrite encryption API as blob pass-through for client-side encryption"
```

---

### Task 7: Server API — Vault Entries Endpoint
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Rewrite: `src/api/vault.php`

**Step 1: Rewrite vault.php as unified CRUD**

Replaces all entity-specific endpoints (accounts.php, assets.php, licenses.php, insurance.php).

- `GET` — list entries. Optional `?type=password` filter. Returns `[{ id, template: {...}, data, created_at, updated_at }]`. Server JOINs entry_templates for inline template data.
- `GET ?id=X` — single entry with template.
- `POST` — create. Accepts `{ entry_type, template_id, encrypted_data }`. Validates entry_type against allowed list.
- `PUT ?id=X` — update. Accepts `{ encrypted_data }`. Checks ownership.
- `DELETE ?id=X` — soft delete (set deleted_at). Warns if shared (returns share count).
- `POST ?action=restore&id=X` — restore soft-deleted entry.
- `POST ?action=bulk-create` — batch insert. Accepts `{ entries: [{entry_type, template_id, encrypted_data}] }`.
- `POST ?action=bulk-update` — batch update. Accepts `{ entries: [{id, encrypted_data}] }`.
- `GET ?action=counts` — returns `{ password: 24, account: 5, ... }` for dashboard. No blobs.
- `GET ?action=deleted` — list soft-deleted entries (for Recently Deleted UI).

Cleanup: on every list request, delete rows where `deleted_at < NOW() - INTERVAL 1 DAY`.

**Step 2: Test CRUD with curl**

```bash
curl -X POST http://localhost:8081/src/api/vault.php \
  -H "Authorization: Bearer $JWT" \
  -d '{"entry_type":"password","template_id":1,"encrypted_data":"base64blob..."}'
```

**Step 3: Commit**

```bash
git commit -m "Rewrite vault API as unified blob CRUD with soft delete"
```

---

### Task 8: Server API — Templates Endpoint
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Create: `src/api/templates.php`

**Step 1: Implement templates API**

- `GET` — all templates visible to user (`owner_id IS NULL OR owner_id = ?`). Includes country/subtype.
- `POST ?action=create` — create custom template. Sets `owner_id` to current user.
- `PUT ?action=update&id=X` — update own template. Ownership check.
- `POST ?action=relink` — `{ old_template_id, new_template_id }` — UPDATE vault_entries SET template_id.
- `POST ?action=request-promotion&id=X` — set `promotion_requested = 1`.
- `POST ?action=approve-promotion&id=X` — admin only. Create global copy, reset flag.

Ownership enforcement: every query includes `(owner_id IS NULL OR owner_id = ?)`. Never return another user's custom template directly (except inline via sharing endpoint).

**Step 2: Test**

```bash
curl http://localhost:8081/src/api/templates.php -H "Authorization: Bearer $JWT"
```

Expected: JSON array of global + user's custom templates.

**Step 3: Commit**

```bash
git commit -m "Add templates API with global/custom/country/subtype support"
```

---

### Task 9: Server API — Sharing Endpoint
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Rewrite: `src/api/sharing.php`

**Step 1: Rewrite sharing.php**

Actions:
- `GET ?action=recipient-key&identifier=X` — Always returns a public key. If user exists, their real key. If not, generate ghost RSA pair (discard private key), create ghost user row, return public key. Never 404.
- `POST ?action=share` — `{ source_entry_id, recipients: [{ identifier, encrypted_data }] }`. Batch share. For each recipient: resolve user or ghost, store shared_item.
- `POST ?action=update` — `{ source_entry_id, recipients: [{ user_id, encrypted_data }] }`. Batch re-encrypt (on-edit re-share).
- `POST ?action=revoke` — `{ source_entry_id, user_ids?: [] }`. Delete shared_items. If no user_ids, revoke all.
- `GET ?action=shared-by-me` — sender's outbox. Returns `[{ id, recipient_identifier, is_ghost, template, created_at }]`. Username only, no email.
- `GET ?action=shared-with-me` — recipient's inbox. Returns `[{ id, sender (username), template, data, created_at }]`. JOINs templates inline.
- `GET ?action=share-count&entry_id=X` — returns count of active shares for an entry (used by delete warning).

Log security actions: `share_created`, `share_revoked`.

**Step 2: Test ghost share flow**

```bash
# Share with non-existent user
curl 'http://localhost:8081/src/api/sharing.php?action=recipient-key&identifier=nobody@test.com' \
  -H "Authorization: Bearer $JWT"
```

Expected: 200 with a public key (ghost).

**Step 3: Commit**

```bash
git commit -m "Rewrite sharing API with blind share, ghost users, batch operations"
```

---

### Task 10: Server API — Snapshots Endpoint
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Create: `src/api/snapshots.php`

**Step 1: Implement snapshots API**

- `GET ?from=YYYY-MM-DD&to=YYYY-MM-DD` — returns `[{ snapshot_date, data }]`. No IDs.
- `POST` — `{ snapshot_date, encrypted_data }`. Insert new snapshot.

Simple CRUD, ownership enforced via JWT user_id.

**Step 2: Commit**

```bash
git commit -m "Add portfolio snapshots API"
```

---

### Task 11: Server API — Audit + Dashboard + Admin
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Create: `src/api/audit.php`
- Create: `src/api/dashboard.php`
- Modify: `src/api/admin.php`

**Step 1: Implement audit.php**

- `GET` — returns user's security log. Optional date range filter. Returns `[{ action, created_at }]`. No IPs returned to client (they're hashed, useless to display).

**Step 2: Implement dashboard.php**

- `GET ?action=stats` — returns `{ entry_counts: { password: N, ... }, shared_with_me_count: N, last_login: timestamp, last_vault_unlock: timestamp }`. All from simple COUNT queries + audit_log MAX(created_at). Zero blob data.
- `GET ?action=page-notices` — reads `config/notices.json`, returns it as JSON. Available to all authenticated users.

**Step 3: Update admin.php**

Add admin-only actions:
- `POST ?action=force-password-reset&user_id=X` — sets `must_reset_password = 1` on users table
- `POST ?action=force-vault-key-reset&user_id=X` — sets `must_reset_vault_key = 1` on user_vault_keys table
- `POST ?action=set-page-notice` — `{ page: "vault", message: "...", severity: "warning" }` → updates `config/notices.json`
- `POST ?action=remove-page-notice` — `{ page: "vault" }` → sets that page to `null` in `config/notices.json`
- `GET ?action=page-notices` (admin) — returns current notices.json for management UI

**Step 4: Commit**

```bash
git commit -m "Add audit log, dashboard stats, and admin APIs with force reset and page notices"
```

---

### Task 12: Server API — Preferences Endpoint
**Parallel group:** B (depends on Tasks 1, 2)

**Files:**
- Create: `src/api/preferences.php`

**Step 1: Implement preferences.php**

- `GET` — returns all KV pairs as JSON object `{ vault_key_type: "alphanumeric", ... }`
- `PUT` — accepts `{ key: value, key: value }`. Upserts each pair.

Log security action when `audit_ip_mode` changes.

**Step 2: Commit**

```bash
git commit -m "Add user preferences KV store API"
```

---

### Task 13: Server Config + Encryption.php Cleanup
**Parallel group:** B (depends on Task 2)

**Files:**
- Modify: `config/config.php`
- Rewrite: `src/core/Encryption.php`
- Modify: `config/.env.example`

**Step 1: Update config.php**

- Remove: `DATA_SESSION_SECRET`, `PBKDF2_ITERATIONS`, `ENCRYPTION_MODE`, `VAULT_KEY_*` constants
- Add: `AUDIT_HMAC_SECRET` (required in production), `STORAGE_ADAPTER` (default: mariadb)
- Keep: all JWT, BCRYPT, SMTP, DB, APP_ENV configs
- Update production safety check to require `AUDIT_HMAC_SECRET`

**Step 2: Gut Encryption.php**

Remove: `encrypt()`, `decrypt()`, `deriveKey()`, `wrapDek()`, `unwrapDek()`, `generateDek()`, `createDataSessionToken()`, `extractDek()`, `requireDek()`, `setDataTokenCookie()`, all PBKDF2 and RSA methods.

Keep or add: `hashIp($ip)` — HMAC-SHA256 with AUDIT_HMAC_SECRET. That's it. ~30 lines.

**Step 3: Update .env.example**

Remove old encryption vars, add `AUDIT_HMAC_SECRET`, `STORAGE_ADAPTER`.

**Step 4: Commit**

```bash
git commit -m "Simplify server config, gut Encryption.php, add AUDIT_HMAC_SECRET"
```

---

### Task 14: EncryptionContext Rewrite
**Parallel group:** C (depends on Tasks 3, 4, 6)

**Files:**
- Rewrite: `src/client/contexts/EncryptionContext.jsx`

**Step 1: Rewrite EncryptionContext**

The context now wraps the real crypto module and entry store. Provides:

```jsx
EncryptionProvider exposes:
  isUnlocked          // boolean
  isLoading           // boolean (during unlock/setup)
  unlock(vaultKey)    // fetch blobs from server, derive key, unwrap DEK, load entries
  lock()              // clear DEK, clear IndexedDB, clear state
  setup(vaultKey)     // first-time vault setup, returns recovery key
  changeVaultKey(current, new)
  recoverWithRecoveryKey(recoveryKey, newVaultKey)
  viewRecoveryKey()
  encrypt(data)       // convenience: encryptEntry with current DEK
  decrypt(blob)       // convenience: decryptEntry with current DEK
  autoLockTimer       // configurable countdown, calls lock()
  preferences         // user preferences from KV store
```

Unlock flow:
1. Fetch vault key material from `/api/encryption.php?action=key-material` (includes `must_reset_vault_key` flag)
2. Call `crypto.unlockVault(blobs, vaultKey)` — returns success/failure
3. If `must_reset_vault_key = true` — force vault key change modal before proceeding
4. If success: fetch all vault entries from `/api/vault.php`
5. Decrypt all entries, store in IndexedDB via entryStore
6. Fetch templates from `/api/templates.php`, cache in IndexedDB
7. Fetch preferences from `/api/preferences.php`
8. Fetch page notices from `/api/dashboard.php?action=page-notices`
9. Set `isUnlocked = true`

Auth flow (in AuthContext, before vault unlock):
1. On login response, check `must_reset_password` flag
2. If true — redirect to forced password change before any other action

Lock flow:
1. Call `crypto.lockVault()` — clears DEK
2. Call `entryStore.clear()` — wipes IndexedDB
3. Set `isUnlocked = false`

Auto-lock: timer based on `auto_lock_timeout` preference. Resets on user activity.

**Step 2: Remove old data session token logic**

Delete all references to `X-Data-Token` header, `pv_data_token` cookie, session token storage.

**Step 3: Test unlock/lock cycle manually**

Start dev server, register user, set up vault, verify unlock/lock works in browser.

**Step 4: Commit**

```bash
git commit -m "Rewrite EncryptionContext for client-side encryption"
```

---

### Task 15: EncryptionKeyModal Rewrite
**Parallel group:** C (depends on Task 14)

**Files:**
- Rewrite: `src/client/components/EncryptionKeyModal.jsx`

**Step 1: Rewrite the modal**

Three modes: setup, unlock, recovery.

Setup mode:
- Key type selector (numeric/alphanumeric/passphrase)
- Vault key input with `inputmode` based on key type
- Strength meter (adapts per key type)
- Confirm vault key
- On submit: call `EncryptionContext.setup(vaultKey)`
- Show recovery key with copy/download buttons
- "I've saved my recovery key" acknowledgment

Unlock mode:
- Vault key input with correct `inputmode`
- On submit: call `EncryptionContext.unlock(vaultKey)`
- On failure: "Wrong vault key" message
- "Forgot vault key? Use recovery key" link -> switches to recovery mode

Recovery mode:
- Recovery key input
- New vault key input + confirm
- On submit: call `EncryptionContext.recoverWithRecoveryKey(recoveryKey, newVaultKey)`
- Show new recovery key

**Step 2: Commit**

```bash
git commit -m "Rewrite EncryptionKeyModal with key type selector and recovery flow"
```

---

### Task 16: API Client (Axios) Update
**Parallel group:** C (depends on Task 14)

**Files:**
- Modify: `src/client/api/client.js`

**Step 1: Remove data session token logic**

Remove the `X-Data-Token` header interceptor. The client no longer sends any encryption-related headers. Only JWT `Authorization` header remains.

**Step 2: Add offline detection**

```js
client.interceptors.request.use((config) => {
    if (!navigator.onLine && config.method !== 'get') {
        return Promise.reject(new Error('You are offline. Changes require an internet connection.'));
    }
    return config;
});
```

**Step 3: Commit**

```bash
git commit -m "Remove data session token from API client, add offline detection"
```

---

### Task 17: VaultPage (Unified)
**Parallel group:** D (depends on Tasks 14, 7, 8, 4)

**Files:**
- Rewrite: `src/client/pages/VaultPage.jsx`
- Delete: `src/client/pages/AccountsPage.jsx`
- Delete: `src/client/pages/AssetsPage.jsx`
- Delete: `src/client/pages/LicensesPage.jsx`
- Delete: `src/client/pages/InsurancePage.jsx`
- Rewrite: `src/client/components/VaultEntryDetailModal.jsx`
- Update: `src/client/hooks/useVaultData.js`
- Delete: `src/client/lib/entityFieldConfigs.js` (replaced by templates from DB)

**Step 1: Rewrite VaultPage**

Unified page with type filter tabs: All, Passwords, Accounts, Assets, Licenses, Insurance, Custom.

- Reads from IndexedDB entry store (already populated on unlock)
- Type tabs filter client-side
- Search: full-text across all decrypted fields, client-side
- Sort: by title (from decrypted data), date (from metadata)
- Shared items appear inline with different icon
- "+ New Entry" -> template picker -> form -> encrypt -> POST
- Edit -> decrypt -> form -> re-encrypt -> PUT (+ re-share if shared)
- Delete -> soft delete warning (if shared, show count) -> DELETE
- "Recently Deleted" section at bottom
- Bulk add/edit support via modals

**Step 2: Rewrite VaultEntryDetailModal**

Renders based on template fields (from `entry.template.fields`). No hardcoded field configs.

**Step 3: Rewrite useVaultData hook**

Now reads from IndexedDB entry store. Returns `{ entries, loading, refetch }`. Filtering, sorting, searching all client-side.

**Step 4: Commit**

```bash
git commit -m "Rewrite VaultPage as unified entry list with template-driven rendering"
```

---

### Task 18: DashboardPage
**Parallel group:** D (depends on Tasks 11, 14)

**Files:**
- Rewrite: `src/client/pages/DashboardPage.jsx`

**Step 1: Rewrite DashboardPage**

Zero decryption. Fetches from `/api/dashboard.php?action=stats`:
- Entry counts by type
- Shared-with-me count
- Last login time, last vault unlock time

Shows vault unlock prompt if locked. No asset totals, no expiry alerts, no blob data.

**Step 2: Commit**

```bash
git commit -m "Rewrite DashboardPage with zero-decryption stats"
```

---

### Task 19: SharingPage
**Parallel group:** D (depends on Tasks 9, 14, 3)

**Files:**
- Rewrite: `src/client/pages/SharingPage.jsx`

**Step 1: Rewrite SharingPage**

Two tabs: "Shared With Me" and "Shared By Me".

Shared With Me:
- Fetch from `/api/sharing.php?action=shared-with-me` (always live, not cached)
- Decrypt each with RSA private key (decrypt private key with DEK first)
- Render with inline template
- Read-only views, no edit
- Show sender username, shared date

Shared By Me:
- Fetch from `/api/sharing.php?action=shared-by-me`
- No decryption needed (sender has original)
- Show recipient identifier, status (active/pending/orphaned)
- Actions: Revoke, Re-share

New Share flow:
- Pick entry from vault -> enter recipient email/username -> encrypt with fetched public key -> POST

**Step 2: Commit**

```bash
git commit -m "Rewrite SharingPage with client-side RSA decryption"
```

---

### Task 20: PortfolioPage
**Parallel group:** D (depends on Tasks 10, 14, 4)

**Files:**
- Rewrite: `src/client/pages/PortfolioPage.jsx`
- Delete: `src/core/Portfolio.php`
- Delete: `src/api/portfolio.php`

**Step 1: Rewrite PortfolioPage**

Live View (default):
- Read assets/accounts from IndexedDB entry store
- Fetch shared items live from server
- Decrypt all, compute totals client-side
- Fetch exchange rates from `/api/reference.php?type=currencies`
- Convert to user's base currency
- Render charts (recharts)
- Shared assets marked with origin indicator
- "Save Snapshot" button -> encrypt summary -> POST to snapshots API

History tab:
- Fetch snapshots from `/api/snapshots.php?from=...&to=...`
- Decrypt each, render line chart over time

**Step 2: Commit**

```bash
git commit -m "Rewrite PortfolioPage with client-side computation"
```

---

### Task 21: ExportPage (Client-Side Only)
**Parallel group:** D (depends on Tasks 14, 4)

**Files:**
- Rewrite: `src/client/pages/ExportPage.jsx`
- Delete: `src/api/export.php`

**Step 1: Rewrite ExportPage**

100% client-side. No server involvement.
- Select entry types to export (checkboxes)
- Select format (CSV, XLSX, JSON)
- Read from IndexedDB -> decrypt -> generate file -> browser download
- Warning: "Exported file contains unencrypted data"
- Uses existing `xlsx` dependency

**Step 2: Commit**

```bash
git commit -m "Rewrite ExportPage as fully client-side export"
```

---

### Task 22: SecurityPage (New)
**Parallel group:** D (depends on Tasks 6, 11, 12, 14)

**Files:**
- Create: `src/client/pages/SecurityPage.jsx`

**Step 1: Implement SecurityPage**

Sections:
- Vault Key: key type dropdown, strength meter, [Change Vault Key] button, auto-lock mode + timeout
- Recovery Key: [View Recovery Key] (vault must be unlocked), [Download as file], status
- Privacy: IP logging toggle (hashed/none), disclosure text
- Security Log: recent events from audit API, [View full log]
- WebAuthn: registered devices, [Add new device]
- Danger Zone: [Delete all vault data], [Delete account]

All settings read/write via `/api/preferences.php`.

**Step 2: Commit**

```bash
git commit -m "Add SecurityPage with vault key, recovery, privacy, audit log"
```

---

### Task 23: ProfilePage (Slimmed)
**Parallel group:** D (depends on Task 14)

**Files:**
- Rewrite: `src/client/pages/ProfilePage.jsx`

**Step 1: Slim down ProfilePage**

Remove all vault/encryption settings (moved to SecurityPage). Keep only:
- Account info: username (read-only), email (changeable), member since
- Password: [Change login password]
- Future placeholder for theme/display preferences

**Step 2: Commit**

```bash
git commit -m "Slim ProfilePage to account info only"
```

---

### Task 24: TemplatesPage (New)
**Parallel group:** D (depends on Tasks 8, 14)

**Files:**
- Create: `src/client/pages/TemplatesPage.jsx`

**Step 1: Implement TemplatesPage**

Three sections:
- Browse Global Templates: read-only view, grouped by entry type, then country/subtype
- My Templates: CRUD for custom templates, field editor (add/remove/reorder fields, set types and required flags)
- Request Promotion: button on each custom template

Field editor UI: drag-to-reorder fields, each field has: key, label, type dropdown (text, url, secret, textarea, number, date), required toggle.

**Step 2: Commit**

```bash
git commit -m "Add TemplatesPage with global browse, custom CRUD, field editor"
```

---

### Task 25: Registration Flow Update
**Parallel group:** D (depends on Tasks 12, 14)

**Files:**
- Modify: `src/client/pages/RegisterPage.jsx`

**Step 1: Add IP disclosure step**

After email/password registration, before account creation completes, show the IP disclosure:

```
Security & Privacy

To protect your account, we log security-related actions
(logins, vault access, key changes, sharing) with a hashed
fingerprint of your IP address. This helps detect unauthorized
access. We never log your day-to-day data activity.

[x] I understand (required)
[ ] Disable IP logging

[Create Account]
```

On submit: create account, then set `audit_ip_mode` preference.

**Step 2: Commit**

```bash
git commit -m "Add IP disclosure to registration flow"
```

---

### Task 26: PWA Setup
**Parallel group:** E (depends on Task 17)

**Files:**
- Modify: `vite.config.js`
- Create: `manifest.json` (or inline in vite config)
- Modify: `package.json`

**Step 1: Install vite-plugin-pwa**

```bash
npm install vite-plugin-pwa -D
```

**Step 2: Configure PWA in vite.config.js**

```js
import { VitePWA } from 'vite-plugin-pwa';

plugins: [
    react(),
    VitePWA({
        registerType: 'autoUpdate',
        manifest: {
            name: 'Citadel Vault',
            short_name: 'Citadel',
            theme_color: '#1a1a2e',
            background_color: '#1a1a2e',
            display: 'standalone',
            icons: [/* app icons */]
        },
        workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg}']
        }
    })
]
```

**Step 3: Add app icons**

Create PWA icons in `static/` (192x192 and 512x512 minimum).

**Step 4: Test PWA**

```bash
npm run build
npm run preview
```

Open in Chrome, check Application tab -> Service Workers, Manifest. Verify "Install" prompt appears.

**Step 5: Commit**

```bash
git commit -m "Add PWA support with service worker and manifest"
```

---

### Task 27: Router + Nav + Cleanup
**Parallel group:** E (depends on Tasks 17-25)

**Files:**
- Modify: `src/client/App.jsx`
- Modify: `src/client/components/Layout.jsx`

**Step 1: Update routes in App.jsx**

- Remove routes for AccountsPage, AssetsPage, LicensesPage, InsurancePage
- Add routes for SecurityPage, TemplatesPage
- Update VaultPage route

**Step 2: Update navigation in Layout.jsx**

Update sidebar/nav to reflect new page structure:
- Dashboard, Vault, Portfolio, Sharing, Export, Templates, Security, Profile, Admin

**Step 3: Add offline banner**

```jsx
const [isOnline, setIsOnline] = useState(navigator.onLine);
// Show "You are offline" banner when !isOnline
```

**Step 4: Commit**

```bash
git commit -m "Update router and navigation for new page structure"
```

---

### Task 28: Delete Old Files
**Parallel group:** F (depends on Task 27)

**Files to delete:**
- `src/client/pages/AccountsPage.jsx`
- `src/client/pages/AssetsPage.jsx`
- `src/client/pages/LicensesPage.jsx`
- `src/client/pages/InsurancePage.jsx`
- `src/client/lib/entityFieldConfigs.js`
- `src/client/components/AccountDetailModal.jsx`
- `src/client/components/AssetDetailModal.jsx`
- `src/client/components/LicenseDetailModal.jsx`
- `src/client/components/InsuranceDetailModal.jsx`
- `src/api/accounts.php`
- `src/api/assets.php`
- `src/api/licenses.php`
- `src/api/insurance.php`
- `src/api/export.php`
- `src/api/portfolio.php`
- `src/api/bulk.php`
- `src/core/Portfolio.php`

Verify nothing references these files (grep for imports/requires).

**Step 1: Delete files and verify build**

```bash
npm run build
```

Expected: builds successfully with no missing import errors.

**Step 2: Commit**

```bash
git commit -m "Delete old entity-specific pages, APIs, and server-side crypto code"
```

---

### Task 29: Build + Deploy Verification
**Parallel group:** F (depends on Task 28)

**Files:**
- `dist/` (build output)
- `.htaccess` (verify rules still work)

**Step 1: Full build**

```bash
npm run build
```

**Step 2: Test locally**

```bash
php -S localhost:8081 router.php
npm run dev
```

Test all flows:
- Register -> IP disclosure -> create account
- Setup vault -> choose key type -> save recovery key
- Unlock vault -> view entries
- Create/edit/delete entries across all types
- Share an entry (real user and ghost)
- View shared items
- Portfolio live view + save snapshot
- Export to CSV/XLSX
- Change vault key
- Recovery flow
- Security page settings
- Templates page
- Lock vault -> re-unlock
- Close tab -> reopen -> must re-enter vault key

**Step 3: Verify .htaccess**

Ensure production Apache rules still route correctly:
- `/assets/*` -> `dist/assets/*`
- All other routes -> `index.php` -> `dist/index.html`
- API routes -> `src/api/*.php`

**Step 4: Commit**

```bash
git commit -m "Build and verify client-side encryption deployment"
```

---

## Verification Checklist

Before declaring done:

- [ ] Zero-knowledge: server never sees plaintext data, vault key, or DEK
- [ ] Vault setup: generates DEK, wraps with vault key, creates recovery key, RSA pair
- [ ] Vault unlock: fetches blobs, derives key client-side, decrypts DEK
- [ ] Vault lock: DEK cleared, IndexedDB wiped
- [ ] Auto-lock: timer fires, vault locks
- [ ] Change vault key: re-wraps DEK, server stores new blob
- [ ] Recovery: recovery key unwraps DEK, sets new vault key
- [ ] View recovery key: decrypts recovery_key_encrypted with DEK
- [ ] CRUD entries: client encrypts/decrypts, server stores blobs
- [ ] Soft delete: 1-day recovery, cleanup
- [ ] Sharing: blind share, ghost users, on-edit re-share, revoke
- [ ] Portfolio: client-side computation, manual snapshots
- [ ] Export: 100% client-side, no server involvement
- [ ] Templates: global, custom, country/subtype, orphan handling
- [ ] Audit log: security-only, HMAC'd IPs, opt-out
- [ ] PWA: installable, offline viewing, service worker
- [ ] No emails in API responses
- [ ] No unnecessary IDs in API responses
- [ ] Registration IP disclosure
- [ ] `npm run build` succeeds
- [ ] All pages render correctly
