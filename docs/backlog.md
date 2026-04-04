# Citadel Vault — Backlog

---

## Security Audit (2026-03-27)

Full report: `docs/SECURITY_AUDIT_2026-03-27.md`. 16 agents audited every security-critical file.

### Critical — Fix Next Session
- ~~**C1 Forgot-password broken**~~ FIXED — Redesigned as client-side crypto flow
- ~~**C2 Email verification broken**~~ FIXED — Variable typo + column name mismatches + added expiry column
- ~~**C4 WebAuthn bypasses lockout**~~ FIXED — Added `locked_until` check in `webauthn.php` auth-verify before JWT issuance.
- ~~**C5 Portfolio sharing broken**~~ FIXED — `source_entry_id` nullable for portfolio shares. Upsert dedup, revoke, and audit all handle NULL correctly.
- ~~**C6 Invitations $storage undefined**~~ FIXED — Changed to `Storage::adapter()->getSystemSetting(...)`
- ~~**C7 CORS credentials unconditional**~~ FIXED — Moved `Allow-Credentials: true` inside origin validation block

### High — Fix Next Session
- ~~**H2 Auto-lock defeated by refresh**~~ FIXED — Auto-lock now delegates to `lock()` which calls `vaultSession.lock()`
- ~~**H3 User-switch DEK leak**~~ FIXED — User-switch calls `vaultSession.destroy()` (clears DEK, session, worker, IndexedDB)
- ~~**H4 Worker retains DEK after lock**~~ FIXED — Added `clearKey` message handler to `computeWorker.js`, sent by `workerDispatcher.setKey(null)`
- ~~**H5 WebAuthn no rate limiting**~~ FIXED — `auth-options` and `auth-verify` use shared `login` rate limit bucket via `Auth::enforceIpRateLimit()`. Failed auth-verify records attempt.
- ~~**H7 No rate limit on encryption endpoints**~~ WON'T FIX — All endpoints require JWT. Attacker only needs one EDEK fetch for offline brute-force; rate limiting adds no security. Real fix is H8 (PBKDF2 iterations).
- ~~**H8 PBKDF2 100K iterations**~~ FIXED — Bumped to 600K. Silent migration: on unlock, if kdf_iterations preference < 600K, re-wraps DEK and updates preference. No DB migration needed.
- ~~**H9 Missing HSTS**~~ FIXED — Already in `.htaccess` line 50: `Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"`. Added during H10 security headers work.
- ~~**H10 Security headers not in Response.php**~~ FIXED — Added X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cache-Control: no-store to `setCors()`. HSTS/CSP stay in .htaccess only (dev compat / HTML-specific).
- ~~**H11 src/core/ not blocked in .htaccess**~~ FIXED — Already in `.htaccess` line 18: `RewriteRule ^src/core/ - [F,L]`. Returns 403 on direct access.
- ~~**H14 No rate limit on password change**~~ FIXED — `password_change` rate limit bucket via `enforceIpRateLimit`, records on wrong-password failure.
- ~~**H15 Admin self-demotion**~~ FIXED — Already guarded in `users.php` line 173: `if ($id === $userId && $body['role'] !== 'admin')` returns 400.
- ~~**H16 Misleading crypto.js comment**~~ FIXED — Changed "non-extractable" to "extractable" in line 9 docstring. DEK must be extractable for AES-KW wrapping on key change/recovery.
- ~~**H18 setup-rsa overwrites RSA keys**~~ FIXED — Rejects with 400 if `public_key` already exists.
- ~~**H19 Recovery key clipboard not cleared**~~ FIXED — Already implemented in `RecoveryKeyCopyBlock.jsx`: 30-second auto-clear with user warning banner.
- ~~**H1 No JWT reissue after normal password change**~~ FIXED — Reissue JWT + set cookie after successful password change, matching force-change-password flow.

### Medium — Plan Fix
- No AAD in AES-GCM — ciphertext swappable between entries (`crypto.js`)
- ~~No blob size/format validation on encryption/vault/sharing POST endpoints~~ FIXED — vault.php validates encrypted_data is string, bulk-create capped at 500 entries, FK violation returns 400
- No audit logging: admin actions (`users.php`), vault CRUD (`vault.php`), password changes (`auth.php`), WebAuthn ops, recovery key update, setup-rsa
- Registration rate limit recorded before validation — enables rate-limit DoS on emails
- Login timing oracle — user existence detectable via response time
- Password complexity only 8-char minimum, no strength enforcement server-side
- `admin_action_message` silently dropped by VAULT_KEY_COLUMNS whitelist (`MariaDbAdapter.php:18-22`)
- WebAuthn `userVerification` = `preferred` not `required`; UV flag never checked
- Settings PUT doesn't validate values against `options` constraint — admin can set arbitrary values
- Expired shares visible in `shared-by-me`, never purged
- `source_type` on shares not validated against allowlist
- `updateShare()` has no `sender_id` in SQL (defense-in-depth gap)
- ~~No `Cache-Control: no-store` on API responses~~ FIXED — Added in Response.php setCors()
- IndexedDB not user-scoped (shared across users on same origin)
- `validateEntryShape` only warns in production, doesn't throw
- Ghost user RSA key generation race condition
- Recovery key input always unmasked (`type="text"`)
- Multiple empty catch blocks swallow errors in EncryptionContext

### Test Gaps — Zero Coverage
- ~~**EncryptionContext**~~ DONE — 20 tests in `EncryptionContext.test.jsx` (lock/unlock, session restore, auto-lock, user-switch, encrypt/decrypt guards, vault prompt state)
- **RegisterPage** — form handling, error display, password clearing (LoginPage covered: 24 tests)
- **Forgot-password** happy path end-to-end (client-side crypto + API round-trip; API endpoint tested in auth.test.js)
- **Email verification** flow (property existence checked; full happy path not tested)
- ~~**SecurityPage**~~ DONE — 19 tests in `SecurityPage.test.jsx`
- ~~**LoginPage**~~ DONE — 24 tests in `LoginPage.test.jsx`
- ~~**Portfolio sharing** (`source_entry_id: 0`)~~ DONE — 6 tests in `sharing.test.js`
- ~~**WebAuthn** crypto verification (CBOR, signatures, challenge expiry/replay)~~ DONE — 26 tests in `webauthn.test.js`
- ~~**Lockout tier escalation** (tier 2, tier 3)~~ DONE — 10 tests in `lockout-tiers.test.js`
- ~~**JWT expiry/tampering**~~ DONE — 19 tests in `jwt-security.test.js`

## High Priority (prior)
- **Address test review findings** — Full findings in `docs/plans/2026-03-17-test-review-findings.md`. Key items:
  - **P1 Code bugs**: ALL FIXED
  - **P1 Test gaps**: ALL DONE
  - **P2 Missing test files**: ALL DONE — 10 files, 209 tests.
  - **P2 Edge cases**: DONE — 56 new edge case tests across 6 files.
  - **P2 Design**: ALL DONE — template_id immutability server-side, vault counts optimized
  - **C. Test quality fixes**: P1 + P2 ALL DONE. P3 remains (cosmetic: naming, selectors, locale assertions).
  - **D. Edge case tests**: Backend 8/10, Frontend 4/8 done. Remaining: soft-delete purge timing, changeVaultKey empty, workerDispatcher.terminate, modal scroll lock.

## Critical Bugs (reported 2026-03-29)

- ~~**#17 Recovery key flow broken for vault key change**~~ FIXED — Was caused by the same iteration-mismatch bug class as #20. Fixed when `getKdfIterations(preferences)` was centralized and all crypto functions received explicit iterations. Verified working on local and prod.
- ~~**#18 No regenerate button/flow for recovery key**~~ FIXED — Added `regenerateRecoveryKey()` in crypto.js (wraps DEK with fresh recovery key while vault is unlocked), context method in EncryptionContext, and "Regenerate" button on Security page with confirmation warning. Uses existing `update-recovery` API endpoint. 7 new tests added (588 total).
- ~~**#19 Recovery flow ignores vault key type setting**~~ FIXED — Recovery modal now uses `activeKeyType` (derived from saved preference), shows key type selector, saves chosen type to preferences after recovery. Input type, placeholder, and validation all respect the selected key type.
- ~~**#20 Change vault key fails with correct key**~~ FIXED — `changeVaultKey()` didn't pass user's `kdf_iterations` preference, defaulting to 600K. If DEK was wrapped at a different count (e.g. 200K), unwrap failed even with the correct key.
- ~~**#22 Default PBKDF2 iterations should be 100K not 600K**~~ FIXED — `PBKDF2_ITERATIONS` was 600K, causing `setupVault()` to wrap DEK at 600K while `defaults.js` and preferences default to 100K. New users would be locked out on first unlock. Changed default to 100K, renamed `PBKDF2_ITERATIONS_LEGACY` → `PBKDF2_ITERATIONS_RECOMMENDED` (600K). Users opt-in via Security settings slider + nudge banner.
- ~~**#21 Add strict test coverage for all vault key / KDF flows**~~ DONE — 31 adversarial unit tests + 10 KDF integration chains + 13 API integration tests + 31 component interaction tests. 677 total tests. Detailed test plan below (all items implemented).

#### #21 Detailed Test Plan

**File: `tests/unit/crypto.test.js`** — crypto function-level tests

_getKdfIterations (new helper)_
- Returns 100K when preferences is `null`/`undefined`
- Returns 100K when `kdf_iterations` key is missing
- Returns 100K when `kdf_iterations` is empty string
- Returns 100K when `kdf_iterations` is `'0'` or negative
- Returns 100K when `kdf_iterations` is non-numeric string (`'abc'`)
- Returns parsed value for valid string (`'200000'` → 200000)
- Returns parsed value for valid number (600000 → 600000)

_setupVault — iteration correctness_
- Vault created at default (100K) can be unlocked at 100K
- Vault created at default CANNOT be unlocked at 600K (adversarial: proves default matters)
- Vault created at default CANNOT be unlocked at 200K

_changeVaultKey — iteration preservation_
- Setup at 200K, change key with `oldIterations=200K` → new key unlocks at 200K ✅
- Setup at 200K, change key WITHOUT passing iterations (default 100K) → unwrap FAILS with "Current vault key is incorrect" (regression test for bug #20)
- Setup at 200K, change key with correct iterations → verify new DEK wrapped at SAME iteration count (not default)
- After key change, old key no longer works at any iteration count
- Wrong current key with correct iterations → throws "Current vault key is incorrect"

_changeKdfIterations (reWrapDekIterations) — validation_
- Re-wrap from 100K to 200K → unlock at 200K works, unlock at 100K fails
- Re-wrap from 200K to 600K → unlock at 600K works, unlock at 200K fails
- Wrong vault key → reWrapDekIterations wraps DEK with wrong key → unwrap with correct key fails (proves why validation was needed — bug #18 regression)
- Re-wrap preserves DEK — data encrypted before re-wrap still decrypts after

_recoverWithRecoveryKey — iteration handling_
- Setup at 100K → recover → new vault key works at specified iterations
- Setup at 100K, change KDF to 200K → recover with recovery key (still at 100K) → works
- Recovery with wrong recovery key → throws "Recovery key is incorrect"
- Recovery with correct key but wrong recoveryIterations → throws (adversarial: proves iteration param matters)
- After recovery, old vault key no longer works
- After recovery, old recovery key no longer works (rotated)
- Recovery with `newIterations=300K` → new vault unlocks at 300K, not default

_verifyRecoveryKeyAndRotate_
- Correct recovery key → returns rotated blobs
- Wrong recovery key → throws
- Correct key with wrong iterations → throws
- Rotated recovery key differs from original
- Old recovery key cannot unwrap new encrypted_dek_recovery

_validateVaultKey (new helper)_
- Returns null for valid alphanumeric key (8+ chars)
- Returns null for valid numeric key (6+ chars)
- Returns null for valid passphrase (16+ chars)
- Returns error for too-short alphanumeric key (7 chars)
- Returns error for too-short numeric key (5 chars)
- Returns error for empty string
- Returns error for null/undefined
- Falls back to alphanumeric (8) when keyType is unknown

**File: `tests/unit/kdfIntegration.test.js`** (NEW) — cross-flow integration tests

_Full lifecycle with non-default iterations_
- Setup at 100K → change KDF to 300K → change vault key → unlock with new key at 300K
- Setup at 100K → change KDF to 600K → recover with recovery key → verify new vault works
- Setup → change KDF → change key → change KDF again → unlock (chain of operations)

_Adversarial: iteration mismatch scenarios_
- DEK wrapped at 200K, preference says 600K → unlock fails (simulates bug class)
- DEK wrapped at 600K, preference says 100K → unlock fails
- DEK wrapped at 100K, preference says 100K → unlock succeeds (control)

_Adversarial: wrong key scenarios_
- Correct key + wrong iterations → fails (not "wrong key" — iteration mismatch)
- Wrong key + correct iterations → fails (genuine wrong key)
- Wrong key + wrong iterations → fails
- Correct key + correct iterations → succeeds (control)

_Recovery after KDF changes_
- Setup at 100K → change to 500K → recovery key still works (recovery key independent of vault KDF)
- Setup at 100K → change to 500K → change vault key → recovery key still works

## Bugs (reported 2026-03-25)

### High
- ~~**#3 Logout doesn't clear vault session**~~ FIXED — AuthContext.logout() now clears DEK, sessionStorage, IndexedDB, workers. 9 tests added.

### Medium
- ~~**#2 PDF export misses newly added data**~~ NOT A BUG — PDF export reads from VaultDataContext (live data), not stale cache. Data is current.
- ~~**#5 Cash/loan amount missing in PDF**~~ FIXED — Replaced `primaryValue()` with `extractValue()` from portfolioAggregator (uses `portfolio_role` markers, supports qty*price).
- ~~**#6 Recovery key unreadable in dark mode (mobile)**~~ FIXED — Replaced ~20 hardcoded hex colors in EncryptionKeyModal.jsx and RecoveryKeyCopyBlock.jsx with `var(--color-*)` CSS custom properties.
- ~~**#8 PDF export amount display unreliable**~~ FIXED — Same fix as #5. Single authoritative `extractValue()` path for all template types.

### Low / UX
- ~~**#1 Vault Details column should sort on asset type**~~ FIXED — Details column now sortable by template type name (alphabetical).
- ~~**#4 Inline editing for accounts and assets**~~ FIXED — Inline title editing (click to edit) for all entry types. Inline amount editing for direct-value templates (cash, real estate, bond, etc.) — skips qty×price types (stock/crypto) and account sums. Also fixed eye/edit buttons on linked assets in account view modal (stacked views with back navigation).
- **#5b Asset type should be updatable** — Template type is currently immutable after creation (by design for data integrity). Consider allowing controlled type migration with field mapping.
- ~~**#6b Snapshot button on portfolio page broken**~~ FIXED — Passed `snapshotPrompt`, `setSnapshotPrompt`, `doSaveSnapshot`, `snapshotSaving` props from PortfolioPage to HistoryTab.

## Feature Requests (reported 2026-03-29)
- **#13 Snapshot account grouping** — Save `linked_account_id` per entry + account names in snapshot meta. Show collapsible account view in snapshot detail modal (assets grouped under their parent account, unlinked assets in separate section). Only applies to new snapshots — old ones keep flat type view.
- **#14 Chart color palette — awaiting Manus design** — Current Wong/IBM colorblind-safe palette is functional but looks harsh in light mode (orange/vermillion/yellow clash). Prompt sent to Manus for a palette that's colorblind-safe AND aesthetically pleasing in both light/dark modes. Once received, swap into `TYPE_COLORS`, `CHART_COLORS`, `EXTRA_COLORS`, plus net worth line and positive/negative bar colors in `PortfolioPage.jsx`.
- **#15 Extract shared aggregation logic** — `recalculateSnapshot` and `aggregatePortfolio` in `portfolioAggregator.js` have duplicated type-grouping/zero-skip logic. Extract common internal function.
- **#16 Chart.js v2 enhancements** — `chartjs-plugin-zoom` (drag-to-zoom, pinch on mobile), cross-chart hover sync, comparison mode (overlay two date ranges), currency breakdown chart, server-side snapshot pagination for 100+ snapshots, extract HistoryTab to separate file.

## Bugs (reported 2026-03-30)
- ~~**#29 Prod: exchanges endpoint 500 — collation mismatch**~~ FIXED — `exchanges` table was `utf8mb4_general_ci`, `countries` was `utf8mb4_unicode_ci`. JOIN failed with "Illegal mix of collations". Fixed with `ALTER TABLE exchanges CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`. Local schema was already correct.
- ~~**#30 Prod: sw.js and version.json returning 403**~~ FIXED — `.htaccess` extension block rule (`*.json → 403`) was re-evaluating rewritten URLs. Changed `[L]` to `[END]` flag on PWA file rewrites. Added missing `sw.js` rewrite rule.
- ~~**#23 Performance tab: account breakdown shows "Unknown Account"**~~ FIXED — Backfill now checks for `undefined` OR `name === 'Unknown Account'`, resolves account name from `decryptedCache[acctId]?.title` instead of `portfolio.accounts`, re-encrypts and persists via new `PUT /snapshots.php` endpoint. One-time migration.
- ~~**#24 Performance tab: currency breakdown shows code only**~~ FIXED — `allGroupKeys` resolves currency labels via `symbolMap` at display time (e.g. "£ GBP").
- ~~**#25 Performance tab: country breakdown shows code not name**~~ FIXED — `allGroupKeys` resolves country codes via `countryMap` at display time. Countries loaded via `useCountries` hook.

## Mobile App / PWA (2026-04-04)
- **Web Push notifications** — Build PHP push subscription endpoint (subscribe/unsubscribe/send) + Web Push API integration in service worker. Works on both Android Chrome and iOS Safari (16.4+, home screen PWA only). Design doc: `docs/plans/2026-04-04-capacitor-mobile-app-design.md` Phase 0.2.
- **Native-feeling mobile UI** — Bottom tab bar, mobile page headers, "More" bottom sheet, safe area insets. Pure CSS + React, no new dependencies. Manus brief: `docs/plans/2026-04-04-manus-mobile-ui-brief.md`. Validation gate for Capacitor decision.
- **Capacitor native app** — Pending Phase 0 validation. Full design: `docs/plans/2026-04-04-capacitor-mobile-app-design.md`. Reviews: `2026-04-04-capacitor-review-security.md`, `2026-04-04-capacitor-review-architecture.md`, `2026-04-04-capacitor-review-dx.md`, `2026-04-04-capacitor-review-verification.md`.

## Feature Requests (reported 2026-03-30)
- **#26 Performance tab: filter within type** — When breakdown=type and a specific type is selected in the Filter dropdown, show a secondary filter to pick individual assets within that type (e.g. filter to "Stock" then pick specific tickers). Also consider showing type+subtype hierarchy (e.g. "Asset > Stock", "Account > Bank") as separate chart groups.
- **#28 Refresh All should show success/failure toast** — Currently "Refresh All" on Portfolio page shows a small inline text result that disappears after 5s. Should use the `SaveToast` component (top-right floating banner) to show success (teal, "Updated 5 prices") or failure (rose, "Refresh failed") consistently on both VaultPage and PortfolioPage.
- **#27 Refresh All via worker with rate thresholds** — `refreshAndApplyPrices` in `useRefreshPrices.js` currently runs on the main thread. Should delegate to the web worker (`workerDispatcher`) and respect existing rate limit thresholds (e.g. don't re-fetch if prices were fetched < N minutes ago, respect per-ticker cooldowns). Check if similar thresholds exist for Plaid balance refresh and align behavior.

## Feature Requests (reported 2026-03-25)
- **#7 Portfolio asset type breakdown — expandable stock holdings** — Stock/equity section in portfolio breakdown should have expandable rows showing aggregated ticker/position data (grouped by ticker, not individual entries).
- **#9 PDF export field selector modal** — Overview mode shouldn't show amounts unless explicitly selected. Add a modal before export to include/exclude specific field categories (amounts, passwords, notes, etc.).
- **#10 CSV export as single ZIP** — Import/export page currently offers individual CSV downloads per type. Add a "Download All CSVs as ZIP" button.
- **#11 JSON import support with versioned format** — Support importing the same JSON format we export. Version the JSON schema (e.g., `"version": 1`) so future format changes can be handled with migration logic. Add a JSON import template/parser.
- **#12 Recovery key dark mode styling (mobile)** — Same root cause as #6. Full dark mode pass needed for `EncryptionKeyModal.jsx`.

## Active
- **Playwright E2E environment fix** — Chromium headless crashes on macOS 15+ (Darwin 25.x) due to MDM/security restrictions. Options: CI-only E2E (GitHub Actions on Linux), or wait for Playwright fix for macOS 15. Test files are written and ready.

## Bug Fixes (2026-03-29 session)
- Chart.js migration — replaced Recharts with Chart.js + react-chartjs-2 across all charts (HistoryTab + OverviewTab)
- History tab overhaul — hero line chart with legend toggle, percentage stacked area, delta bar chart, date range presets (All/3M/6M/1Y/YTD), Values/% Allocation toggle, collapsible snapshot table
- Fixed snapshot API not returning `id` field — caused `snapshotSummaryMap` to overwrite all entries on same `undefined` key (only 1 snapshot visible)
- Fixed OverviewTab "By Asset Type" doughnut using index-based colors instead of `getTypeColor()` — now consistent with HistoryTab
- Colorblind-safe palette — replaced Tailwind colors with Wong/IBM-derived palette (awaiting Manus design polish)
- Const-before-init crash in EncryptionContext — moved `lock` above `startAutoLock`
- 401 errors on unauthenticated pages — `pv_has_session` localStorage flag, sequential auth check
- SecurityPage crash — missing `Clock` import
- Chart tooltip showing only one series — iterate all payload entries
- Portfolio tab persistence via sessionStorage
- Auto-load snapshots on mount (removed "Load Snapshots" button)
- Dropped legacy v1/v2 snapshot support
- Aligned `recalculateSnapshot` type grouping with `aggregatePortfolio`
- 577 total tests passing

## Done
- ~~**Chart.js migration + History tab overhaul**~~ DONE — Replaced Recharts with Chart.js (bundle 185KB vs ~300KB). History tab redesigned: hero line chart with interactive legend, % allocation stacked area, period change delta bar, date range presets, type filter, rate mode toggle, collapsible snapshot table. Design: `docs/plans/2026-03-29-history-tab-overhaul-final.md`.
- ~~**Sharing full restore**~~ DONE — Rich share modal with source type selector (Account/Asset/License/Insurance/Portfolio), multi-select item picker, connected assets toggle, portfolio sharing (4 modes: Summary/Full/Saved Snapshot/Selective), sync modes (Snapshot/Continuous), labels, expiry dates, sortable tables, re-encrypt prompt for continuous shares. Plans: `docs/plans/2026-03-23-sharing-ux-enhancement.md`, `docs/plans/2026-03-23-sharing-full-restore.md`.
- ~~**VaultDataContext**~~ DONE — Centralized reactive data layer for vault entries. All pages (Vault, Portfolio, Sharing, ImportExport) consume shared entries + decryptedCache from context. Cross-tab (BroadcastChannel), cross-device (SyncContext), and tab-focus sync in one place.
- ~~**Vault table enhancements**~~ DONE — Sortable columns (Title, Amount, Currency, Updated), currency display selector, Amount column with base currency conversion, tab reorder (Account first), template type badges in detail column, visibility toggle for amounts.
- ~~**Sharing API redesign**~~ DONE — Signed HMAC tokens, ghost user model, upsert dedup, is_ghost removed (status derived from recipient_id), identifier stored for ghost shares.
- ~~**PDF export**~~ DONE — Styled HTML + browser print. Net worth tiles with grid layout, FX rate conversion fixed (was inverted), tree connectors, field grid cards, two modes (overview/full).
- ~~**Integrations refactor**~~ DONE — Provider-agnostic layer, Plaid isolated in `providers/plaid/`. Lazy migration `_plaid` → `integrations.plaid`.
- ~~**Import/export redesign**~~ DONE — Type-separated exports (JSON nested, CSV zip, XLSX multi-sheet, PDF). Row IDs per-type, account-asset linkage remapped.
- ~~**SMTP setup for prod**~~ DONE — Brevo (300/day free), credentials in `.env`, `SMTP_ENABLED=true`.
- ~~**Stock/crypto price fetch**~~ DONE — Yahoo Finance proxy, server-side cache, ticker verify, portfolio price refresh.
- ~~**Gain/loss display**~~ DONE — `extractGainLoss` in portfolioAggregator, per-row + total on portfolio page.
- ~~**Full test coverage**~~ DONE — 550+ unit/component tests, API tests, pre-push hook via husky.
- ~~**iOS PWA resilience**~~ DONE — 15s API timeout, ErrorBoundary, NetworkFirst SW.
- ~~**Invite request spam protection**~~ DONE — `invite_requests_enabled` system setting, IP hash tracking.
- ~~**Admin settings framework**~~ DONE
- ~~**Web Worker scaffolding**~~ DONE
- ~~**Offline/PWA improvements**~~ DONE
- ~~**Live bank data integration (Plaid)**~~ DONE
- ~~**Client-side storage & caching strategy**~~ DONE

## Bug Fixes (2026-03-23 session)
- Fixed template change dropping linked_account_id, country, currency
- Fixed sidebar logo invisible in light mode (color matched background)
- Fixed snapshot save failing (null DEK in encryptBatch main thread path)
- Fixed vault setup blocked after forced password change (JWT not reissued)
- Fixed UpdateToast reload not firing when SW unregistration throws
- Fixed PDF export FX rates inverted (total/rate → total*rate)
- Fixed const-before-initialization crash (getTemplateFields used before defined)

## Bug Fixes (2026-04-04 session)
- `window.location.href` replaced with React Router navigation in 3 locations (client.js 401 handler, RegisterPage, ForgotPasswordPage). Uses `citadel:auth-expired` custom event pattern. No more full page reloads on session expiry.
- ProtectedRoute now redirects unauthenticated users to `/login` instead of `/home`

## Bug Fixes (2026-04-03 session)
- Vault session lost on refresh despite persist_in_tab (unmount cleanup clearing sessionStorage DEK)
- Performance tab: duplicate "Asset" chart lines (case-sensitive type key: "Asset" vs "asset")
- Performance tab: "Unknown Account" in account breakdown (snapshot backfill using portfolio.accounts instead of decryptedCache)
- Performance tab: currency breakdown showing code only (resolved via symbolMap at display time)
- Performance tab: country breakdown showing code not name (resolved via countryMap at display time)
- Missing audit log on recovery key regeneration (update-recovery endpoint)
- H16: misleading crypto.js comment (DEK described as non-extractable, is extractable)

## To Think About
- **Import redesign** — Match new export structure, 3rd-party CSV imports (1Password, Bitwarden, LastPass).
- **Component-level rendering tests** — VaultPage, PortfolioPage, SharingPage have no component render tests. Catch runtime crashes invisible to unit tests.
- **GitHub Actions CI** — Automated test runs on push/PR. Unit tests are quick wins. API tests need MySQL + PHP.
- **Lazy vault loading** — Fetch metadata first, decrypt on demand. Reduces unlock time for large vaults.
- **Rollout/experimentation** — Percentage rollout + A/B test variants in settings framework.
- **Multi-recipient sharing** — Share one entry with multiple recipients in one flow (UI only — API already supports batch).
- **Proxy account owner** — 3-way handshake for delegated access: sender sends request → recipient accepts → sender confirms. Enables accountants/advisors to view vault entries on behalf of owner.
- **Share batch ID** — Each share action gets a unique `batch_id` (UUID). Groups entries shared together. Enables collapsible rows in Shared With Me / Shared By Me tables. Needs DB column + API + UI grouping.
- **Mixed-type sharing** — Allow selecting entries across multiple types (e.g., accounts + assets) in one share flow. Currently switching source type clears the selection. Need per-type selection state or a unified multi-type picker.

## Deferred
- **Offline write queue** — Queue failed writes when offline, auto-sync when back online.
- **Delta sync** — Fetch only changed entries via `GET /vault.php?since=<timestamp>`. Pairs well with VaultDataContext.

## Bug Fixes (2026-03-27 session)
- Fixed logout not clearing vault session (DEK, sessionStorage, IndexedDB, workers)
- Fixed forgot-password endpoint (was calling non-existent Encryption methods, querying wrong table)
- Fixed email verification (variable typo, column name mismatches, added expiry column)
- Added `verifyRecoveryKeyAndRotate()` to crypto.js for client-side forgot-password flow
- Added 9 logout cleanup regression tests (`tests/unit/authLogout.test.js`)
- C6: invitations $storage undefined — fixed to `Storage::adapter()`
- C7: CORS credentials unconditional — moved inside origin validation
- H2: auto-lock defeated — auto-lock now delegates to centralized `lock()`
- H3: user-switch DEK leak — user-switch now calls `vaultSession.destroy()`
- H4: worker retains DEK after lock — added `clearKey` worker message
- Centralized vault cleanup into `vaultSession.js` (lock/destroy) — eliminates scattered cleanup paths
- 13 new `vaultSession.test.js` tests, `authLogout.test.js` simplified to test delegation
- 567 total tests passing

## Bug Fixes (2026-03-28 session)
- C4: WebAuthn bypasses lockout — added `locked_until` check before JWT issuance
- C5: Portfolio sharing broken — `source_entry_id` nullable, upsert dedup, NULL-safe revoke
- H1: JWT reissue after normal password change — centralized via `Auth::issueAuthToken()`
- H5: WebAuthn rate limiting — shared `login` rate limit bucket
- H7: Won't fix — rate limiting authenticated endpoints adds no security value
- H8: PBKDF2 100K→600K — configurable slider on Security page, nudge banner for legacy users
- H10: Security headers in Response.php — X-Content-Type-Options, X-Frame-Options, etc.
- H14: Rate limit on password change — `password_change` bucket
- H18: setup-rsa idempotency guard — rejects if RSA keys already exist
- Centralized Auth helpers: rate limiting, lockout, password validation, userId, IP extraction, JWT issuance
- Extracted `Auth::recordFailedLogin()` — tier-based lockout with audit logging via adapter
- All audit logging now goes through `Storage::adapter()->logAction()` (no more raw INSERTs)
- Token returned in response body for all 6 auth endpoints (future native app support)
- Cache-Control: no-store on all API responses
- 8 new API tests (portfolio sharing + WebAuthn rate limiting)
- 10 new unit tests (KDF iterations, defaults)
- #5/#8: PDF amounts — replaced `primaryValue()` with `extractValue()` (portfolio_role markers)
- #6: Dark mode — replaced ~20 hardcoded hex colors with CSS custom properties
- #6b: Snapshot button — passed missing props from PortfolioPage to HistoryTab
- #2: Not a bug — PDF export already reads from VaultDataContext live data
- 577 total tests passing
- 10 new unit tests (KDF iterations, defaults)
- 577 total tests passing

## Bug Fixes (2026-03-28 session, cont.)
- #1: Details column sortable by template type name
- #4: Inline title editing (all types) + inline amount editing (direct-value templates)
- Fixed eye button on linked assets replacing account view (no back navigation) — stacked with `parentViewEntry`
- Fixed edit button on linked assets opening behind view modal — closes view, restores on return
- Added `InlineTextField` component (mirrors `InlineNumberField` for text fields)
- `InlineNumberField` now has `stopPropagation` for use in table rows
- 577 total tests passing

## Bug Fixes (2026-04-04 session, cont.)
- **API test seed audit — 37 failures → 0 (530/530 passing)**
  - Centralized all test data in `_seed_test_data.php`: admin user, regular user, account_types (11 rows), system_settings overrides
  - Fixed `.env.test` lockout thresholds: relaxed 1000/2000/3000 → strict 3/6/9 (safe: only 2 wrong-login attempts hit admin across all tests)
  - Fixed stale passwords in `auth.test.js` (`Initial#12$` → `TestAdmin123`) from 2026-04-04 password simplification
  - Isolated password-change + deactivated-user integration tests to dedicated throwaway users (no more shared admin/regular mutation)
  - Fixed invitation tests: wrong admin email `admin@citadel.local` → `admin@test.local`
  - Fixed lockout tests: MySQL CLI targeting dev DB `citadel_vault_db` → test DB `citadel_vault_test_db`
  - Fixed sharing test: ISO datetime → MySQL-compatible format for `expires_at`
  - Simplified `ensureRegularUser()` in apiClient.js (no-op — user is pre-seeded)
  - vault.php: `encrypted_data` validated as string (was accepting arrays → 500), FK violation on `template_id` returns 400 (was 500), bulk-create capped at 500 entries (was crashing PHP server)

## Pending Prod Migrations
- All migrations run on prod as of 2026-04-04. None pending.

## Security Audit Status
- Full audit report: `docs/SECURITY_AUDIT_2026-03-27.md`
- ~~JWT in localStorage~~ DONE (httpOnly cookie)
- ~~No JWT revocation~~ DONE (checked_at cache)
- ~~RSA-2048 → 4096~~ WON'T DO
- ~~console.error in production~~ DONE
- **All criticals (C1–C7) resolved**
- **All highs (H1–H19) resolved** (H7 won't fix, H9/H11/H15/H19 were already fixed but unmarked — verified 2026-04-03)
