# Changelog

All notable changes to Citadel Vault are documented here.

---

## [1.0.0] — 2026-03-08

### Core
- AES-256-GCM field-level encryption with per-user DEK and PBKDF2 key derivation (100K iterations)
- Recovery key system — backup access to vault, viewable/regenerable from Profile, auto-rotated on use
- Configurable vault key policy (minimum length + mode: numeric/alphanumeric/any) via environment variables
- JWT authentication with configurable expiry
- WebAuthn/FIDO2 passkey support (fingerprint, face, device PIN)

### Account Security
- Progressive account lockout — 3/6/9 failed attempts with escalating cooldowns and email notifications
- Progressive vault lockout — same tiers for vault key attempts
- Password reuse prevention with configurable history depth
- Forced password change on admin-created accounts
- IP included transiently in lockout emails but never stored in database

### Data Management
- Financial accounts with 7 system types and custom types
- 12 asset types (cash, equity, mutual funds, bonds, property, gold, crypto, loans, debt, and more)
- Password vault with categories and favourites
- License manager with expiry tracking
- Insurance policies with premium and coverage tracking
- Account detail templates — personal and global, with browse/reuse/delete
- 140 currencies with daily exchange rate updates (GBP/INR/USD pinned to top)
- 143 countries with country-specific banking field templates
- Portfolio tracking with snapshots, breakdowns by country/type/currency/account
- Secure sharing via RSA-2048 hybrid encryption with snapshot/auto/approval modes
- CSV/Excel data export

### User Management
- Invite-based registration — email-locked invite links with 7-day expiry
- Self-registration with optional email verification (configurable)
- Admin user management with search and filtering
- Welcome emails for admin-created accounts
- Invite request form on registration page (sends email to admin via SMTP)

### Email
- SMTP email service (no Composer dependencies, compatible with major SMTP providers)
- Email templates: welcome, invite, verification, lockout notification, invite request

### Frontend
- Public landing page, help/FAQ, developer guide, features page
- FAQ organized into collapsible sections (Encryption, Account Security, Features, General)
- Features page renders README.md and CHANGELOG.md from server (live updates without rebuild)
- Sortable tables across all pages (click column headers)
- Collapsible Profile page sections
- Forgot password flow via recovery key
- Dark mode support

### Infrastructure
- 19-table MariaDB schema with consolidated setup scripts (01-schema, 02-seed, 03-testdata)
- Environment-driven configuration (vault key policy, registration, SMTP, lockout thresholds)
- Audit logging for recovery key operations and lockout events
- APP_URL decoupled from WEBAUTHN_ORIGIN for domain flexibility
