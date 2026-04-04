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

## Feature Requests

- **#5b Asset type updatable** — Template type is currently immutable after creation (by design). Consider controlled type migration with field mapping.
- **#7 Portfolio expandable stock holdings** — Stock/equity section should have expandable rows showing aggregated ticker/position data.
- **#9 PDF export field selector modal** — Add modal before export to include/exclude specific field categories.
- **#10 CSV export as single ZIP** — Add "Download All CSVs as ZIP" button on import/export page.
- **#11 JSON import with versioned format** — Support importing same JSON format we export, with schema versioning.
- **#13 Snapshot account grouping** — Save `linked_account_id` per entry + account names in snapshot meta. Collapsible account view in snapshot detail.

## Mobile App / PWA

- **Web Push notifications** — PHP push subscription endpoint + Web Push API in service worker.
- **Native-feeling mobile UI** — Bottom tab bar, mobile headers, safe area insets. Design brief: `docs/plans/2026-04-04-manus-mobile-ui-brief.md`.
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
