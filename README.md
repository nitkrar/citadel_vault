# Citadel Vault

A secure, self-hosted personal vault for managing your finances, passwords, licenses, insurance, and more — all encrypted with keys only you control.

**Open source** — [github.com/nitkrar/citadel_vault](https://github.com/nitkrar/citadel_vault)

---

## Why Citadel?

Your sensitive data deserves better than a spreadsheet or a cloud service you can't audit. Citadel encrypts everything with AES-256-GCM using a key derived from your personal vault key. Not even the server administrator can read your data. The entire codebase is open source for you to verify.

---

## Features

### Financial Accounts
- Track bank accounts, savings, credit cards, investments, fixed deposits, wallets, and loans
- 143 countries with country-specific banking fields (Sort Code for UK, IFSC for India, Routing Number for US, and more)
- Custom field templates — save and reuse field structures across account types
- Browse and apply templates from your personal or shared template library

### Assets & Net Worth
- Track cash, stocks, mutual funds, bonds, property, gold, cryptocurrency, loans, and liabilities
- 140+ currencies with daily exchange rate updates
- Automatic portfolio aggregation — view total assets, liquid assets, liabilities, and net worth
- Breakdowns by country, account, asset type, and currency
- Historical portfolio snapshots with chart visualizations

### Password Vault
- Store website credentials with AES-256-GCM encryption
- Organized by category with favourites
- Searchable and sortable

### License Manager
- Track software license keys, expiry dates, seat counts, and vendor details
- Categories for organization
- Expiry alerts

### Insurance Policies
- Track life, health, auto, property, and other insurance policies
- Premium amounts, coverage, cash value, payment frequency
- Start and maturity date tracking

### Secure Sharing
- Share accounts, assets, licenses, insurance, or portfolio snapshots with other users
- Data is encrypted with the recipient's public key using RSA hybrid encryption — only they can decrypt it
- Snapshot, auto-sync, and approval-based sharing modes
- Optional expiry dates on shares

---

## Security

### Zero-Knowledge Encryption
All sensitive data is encrypted at the field level before being stored in the database. The encryption key (DEK) is derived from your vault key, which the server never sees or stores. Even with full database access, your data cannot be read without your vault key.

### What's Encrypted vs Unencrypted

| Encrypted (AES-256-GCM) | Unencrypted (operational) |
|---|---|
| Account names, numbers, balances | Username, email |
| Asset amounts, details | Password hash (bcrypt, not reversible) |
| Passwords, license keys | Account type, currency, country references |
| Insurance details, policy numbers | Timestamps |
| All custom fields and notes | |

### Security Features
- Field-level AES-256-GCM encryption with per-user keys
- Vault key never stored on the server — only you can decrypt your data
- Recovery key as an independent backup for vault access
- Progressive account lockout and rate limiting (configurable by admin)
- Email notifications on security events
- Password reuse prevention
- Passkey authentication (FIDO2/WebAuthn)
- All security thresholds and policies are configurable via environment variables

### Vault Key

Your vault key protects all your data and is required each session. The vault key policy is configurable by the server administrator. Your vault key is never stored on the server. If you lose both your vault key and recovery key, your data is permanently inaccessible — by design.

---

## Additional Features

- **Multi-currency support** — 140+ currencies with automatic exchange rate updates. GBP, INR, and USD pinned to the top of all selectors.
- **Invite system** — any user can invite others via email-locked invite links (7-day expiry, single-use)
- **Passkey authentication** — sign in with fingerprint, face, or device PIN alongside traditional passwords
- **Dark mode** — automatic theme based on system preference
- **Data export** — export accounts, assets, licenses, and vault entries to CSV/Excel
- **Sortable tables** — click any column header to sort across all pages
- **Collapsible sections** — Profile page sections collapse for a cleaner view

---

## Open Source

Every line of code is available for audit at [github.com/nitkrar/citadel_vault](https://github.com/nitkrar/citadel_vault). Free for personal and noncommercial use.

For setup instructions, see [INSTALL.md](INSTALL.md).
For developer documentation, visit the [Developer Guide](/dev-guide) on the website.

---

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) — free for personal, educational, and noncommercial use. See [LICENSE](LICENSE) for details.
