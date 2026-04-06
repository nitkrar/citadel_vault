# Citadel Vault — Backlog

---

## Security — Medium Priority

Full audit report: `docs/SECURITY_AUDIT_2026-03-27.md`. All critical (C1-C7) and high (H1-H19) items resolved.

- No AAD in AES-GCM — ciphertext swappable between entries (`crypto.js`)
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
- `validateEntryShape` only warns in production, doesn't throw
- Ghost user RSA key generation race condition
- Recovery key input always unmasked (`type="text"`)
- Multiple empty catch blocks swallow errors in EncryptionContext

## Test Gaps

- **RegisterPage** — form handling, error display, password clearing
- **Forgot-password** happy path end-to-end (client-side crypto + API round-trip)
- **Email verification** flow (property existence checked; full happy path not tested)
- **Test review P3** — cosmetic: naming, selectors, locale assertions
- **Edge cases remaining**: soft-delete purge timing, changeVaultKey empty, workerDispatcher.terminate, modal scroll lock

## Sharing — Needs Fix

- **Continuous share: re-encrypt must update entire share group, not just edited entry**
  When a user shares an account + linked assets as a continuous share (all in one `share_group_id`), then later edits one entry and clicks "Update recipients", only that single entry's share record gets re-encrypted. The other entries in the same group keep stale encrypted blobs. Recipient sees mix of old and new data.
  - **Root cause**: `VaultPage.handleReEncrypt` (line ~664) only targets `sharesByEntry[editEntry.id]` — it doesn't know about `share_group_id` or sibling entries in the same group.
  - **Fix approach**: When re-encrypting, look up the `share_group_id` for the edited entry's share. Find all other shares in the same group. Re-encrypt each one using its current `decryptedCache[source_entry_id]` data. This way editing any entry in a group triggers a full group re-encrypt.
  - **Files**: `src/client/pages/VaultPage.jsx` (handleReEncrypt), `src/client/hooks/useShareData.js` (sharesByEntry needs group awareness)
  - **Edge case**: If a linked asset was deleted since the share was created, skip it (don't fail the whole re-encrypt).
  - **Verified**: DB update works fine for individual entries — the `action=update` API correctly finds and updates the share via `getShareByKey(sender, entry, recipient)`. The issue is purely that sibling entries aren't included.

## Feature Requests

- **#5b Asset type updatable** — Template type is currently immutable after creation (by design). Consider controlled type migration with field mapping.
- **#9 PDF export field selector modal** — Add modal before export to include/exclude specific field categories.
- **#10 CSV export as single ZIP** — Add "Download All CSVs as ZIP" button on import/export page.
- **#11 JSON import with versioned format** — Support importing same JSON format we export, with schema versioning.

## Mobile App / PWA

### Completed (Phase 0)
- **Service worker fixes** — `navigator.storage.persist()`, SW update on visibility change, enhanced OfflineBanner with data age, Workbox config cleanup.
- **Mobile layout shell** — Bottom tab bar, native header, More sheet, layout toggle (auto/mobile/classic). Files: `useLayoutMode.js`, `Layout.jsx`, `styles.css`.
- **VaultPage mobile** — Compact tabs row (Accounts/Assets + More dropdown), overflow menu for actions, currency picker via header icon.
- **PortfolioPage mobile** — Compact tabs row with overflow menu (Refresh All + Snapshot), currency picker via header icon, PerformanceTab toolbar compacted (Breakdown + Val/% visible, filters/YoY/tooltip/rate settings in overflow).
- **SharingPage mobile** — Compact tabs row (With Me / By Me), Share Entry in header icon, tables scroll horizontally.
- **Header polish** — Left-aligned title, back button on all pages for consistent layout.
- **DashboardPage / sub-pages reviewed** — Auto-fill grids and `.table-wrapper` scroll handle mobile adequately; no changes needed.

### Remaining (Phase 0)
- **Live with PWA 2-4 weeks** — Decision gate: does improved PWA satisfy mobile needs? If not → Capacitor.

### Deferred
- **Web Push notifications** — Low value for single-user app. Skip unless needed for Capacitor gate.
- **Capacitor native app** — Pending Phase 0 validation. Design: `docs/plans/2026-04-04-capacitor-mobile-app-design.md`.

## Active

- **Playwright E2E** — Blocked by macOS 15 MDM. Works in CI. Test files ready.

## To Think About

- **Import redesign** — Match new export structure, 3rd-party CSV imports (1Password, Bitwarden, LastPass).
- **Component-level rendering tests** — VaultPage, PortfolioPage, SharingPage have no component render tests.
- **GitHub Actions CI** — Automated test runs on push/PR.
- **Lazy vault loading** — Fetch metadata first, decrypt on demand.
- **Rollout/experimentation** — Percentage rollout + A/B test variants in settings framework.
- **Multi-recipient sharing** — Share one entry with multiple recipients in one flow.
- **Proxy account owner** — 3-way handshake for delegated vault access.
- **Share batch ID** — Group entries shared together. Needs DB column + API + UI.
- **Mixed-type sharing** — Allow selecting entries across multiple types in one share flow.

## Deferred

- **Offline write queue** — Queue failed writes when offline, auto-sync when back online.
- **Delta sync** — Fetch only changed entries via `GET /vault.php?since=<timestamp>`.
