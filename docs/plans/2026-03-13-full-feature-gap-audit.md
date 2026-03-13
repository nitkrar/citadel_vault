# Citadel — Full Feature Gap Audit

**Date:** 2026-03-13
**Method:** Independent audits of `v1.1-server-side-encryption` tag and current `main`, then merged comparison.

---

## Summary

| Category | MISSING | DEGRADED | DEAD CODE | NET NEW (preserve) |
|----------|---------|----------|-----------|-------------------|
| Dashboard | 10 (D1-D10) | 1 | 0 | 0 |
| Portfolio | 21 (P1-P21) | 3 | 0 | 0 |
| Accounts | 6 (A1-A6) | 0 | 0 | 0 |
| Assets | 7 (AS1-AS7) | 0 | 0 | 0 |
| Insurance | 5 (I1-I5) | 0 | 0 | 0 |
| Licenses | 4 (L1-L4) | 0 | 0 | 0 |
| Passwords/Vault | 5 (V1-V5) | 0 | 0 | 0 |
| Sharing | 10 (S1-S10) | 1 | 0 | 0 |
| Export | 9 (E1-E9) | 1 | 0 | 0 |
| Profile | 7 (PR1-PR7) | 0 | 0 | 0 |
| Admin | 2 (AD1-AD2) | 0 | 0 | 0 |
| Security | 2 (SEC1-SEC2) | 0 | 0 | 0 |
| Bulk Operations | 5 (B1-B5) + API | 0 | 3 components | 0 |
| Detail Modals | 0 | 0 | 5 components | 0 |
| Layout | 1 (LY1) | 0 | 0 | 0 |
| Net New Features | — | — | — | 29 (N1-N29) |
| **TOTAL** | **~94** | **6** | **8 components** | **29** |

**Decisions needed: 7 (DC1-DC7)**

---

## Legend

- **MISSING** — Feature existed in old, does not exist in current. Must be restored.
- **DEGRADED** — Feature exists in current but with reduced functionality vs old. Must be upgraded.
- **DEAD CODE** — Component files exist in current but are not imported/used anywhere. Must be revived or removed.
- **PRESERVED** — Feature exists in both versions at parity. No action needed.
- **NET NEW** — Feature exists only in current. Must not regress during restoration work.

---

## 1. DASHBOARD PAGE

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| D1 | Net Worth stat card | Computed from portfolio aggregation (assets - liabilities), TrendingUp icon, primary color | Card shows correct net worth with currency formatting, respects hideAmounts |
| D2 | Liquid Assets stat card | Sum of assets where `is_liquid=true`, DollarSign icon, success color | Card shows liquid total, currency formatted |
| D3 | Assets count stat card | Count from assets table, Briefcase icon, info color | Card shows count of asset-type vault entries |
| D4 | Vault Entries count stat card | Count from vault/passwords, KeyRound icon, warning color | Card shows password entry count |
| D5 | Portfolio by Country pie chart | Recharts PieChart, donut style, 8-color palette, dark tooltip | Pie chart renders with correct country grouping, respects hideAmounts |
| D6 | Country Breakdown sortable table | Columns: Country (flag), Total, Liquid, Assets count. Uses SortableTh | Table renders, all columns sortable, values correct |
| D7 | Quick Access grid | 6 cards (Accounts, Assets, Insurance, Vault, Licenses, Portfolio) with icons, descriptions, hover effects, links | All 6 cards render and link to correct pages |
| D8 | Expiring Licenses alert | Warning card listing licenses expiring within 30 days (name + date) | Alert shows when licenses are expiring, hidden when none |
| D9 | Bulk Setup Wizard button | Opens BulkWizard modal for onboarding | Button visible, opens wizard |
| D10 | "Rates as of" badge | Shows `rates_last_updated` from portfolio data | Badge displays last rate update timestamp |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Time-based greeting | Working identically |
| Page notices | Working (global + dashboard route) |
| Vault locked state | Working |

### DEGRADED Features
| Feature | Old | Current | Gap |
|---------|-----|---------|-----|
| Entry count cards | 4 stat cards (Net Worth, Liquid, Assets count, Vault count) from portfolio aggregation | 6 type-count cards + stats row (total, shared, last login) | Current cards are just counts by type — no financial aggregation. Need to ADD the 4 financial summary cards. Current type-count cards are fine to keep. |

---

## 2. PORTFOLIO PAGE

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| P1 | Currency conversion | Server-side `base_amount`, client display currency dropdown with triangulation | Client-side triangulation: `amount * rate_to_base / display_rate_to_base`. All values convertible. |
| P2 | 7 tabs | Overview, By Country, By Account, By Asset Type, All Assets, By Currency, History | All 7 tabs render with correct data |
| P3 | Overview — 4 summary cards | Total Assets (blue), Liquid Assets (green), Liabilities (red), Net Worth (computed) | 4 cards with correct color coding and values |
| P4 | Overview — Pie charts | By Country + By Asset Type, side by side, Recharts PieChart donut | Both charts render with correct groupings |
| P5 | Overview — Bar chart | Assets vs Net by Country, Recharts BarChart dual bars | Chart renders, bars correct per country |
| P6 | By Country tab | Expandable country cards (flag + name + count + total), sub-table per country | Cards expand/collapse, sub-tables sortable, row click opens detail |
| P7 | By Account tab | Expandable account cards (name + count + total), sub-table per account | Cards expand/collapse, linked assets shown per account |
| P8 | By Asset Type tab | Single sortable table: Type, Category badge, Total, Liquid, Count | All columns sortable, values correct |
| P9 | All Assets tab | Full table with checkbox column, bulk toolbar, all fields | Selection, bulk edit/delete, sortable, row click opens detail |
| P10 | By Currency tab | Table: Currency, Symbol, Total in display currency, Count | Sortable, values converted to display currency |
| P11 | History — Line chart | Recharts LineChart of net worth over time from snapshots | Chart renders with 2+ snapshots |
| P12 | Display currency selector | Dropdown in page header, converts all displayed amounts | Dropdown works, all values update on change |
| P13 | Custom dark tooltip | Styled tooltip for all charts (#1e293b background) | Tooltips display correctly in light and dark mode |
| P14 | CHART_COLORS palette | 8-color array for consistent chart coloring | Colors match old palette |
| P15 | Bulk select from portfolio | useSelection hook, checkbox column on All Assets tab | Checkboxes work, bulk toolbar appears |
| P16 | Bulk edit from portfolio | BulkEditModal with spreadsheet editor | Modal opens, edits save correctly |
| P17 | Bulk delete from portfolio | Confirm dialog, batch delete | Deletion works with confirmation |
| P18 | Asset detail modal from row click | Click row → AssetDetailModal | Modal opens with correct decrypted data |
| P19 | Rates last updated badge | Badge in page subtitle | Shows timestamp from currency data |
| P20 | Hide amounts in charts | Y-axis shows `***`, tooltip values show `******` | Charts respect hideAmounts context |
| P21 | Error/retry state | AlertTriangle + message + Retry button | Error state renders with retry capability |

### DEGRADED Features
| Feature | Old | Current | Gap |
|---------|-----|---------|-----|
| Live tab | Full aggregation with currency conversion, 7 sub-views | 3 summary cards + 1 combined table, no currency conversion | Complete replacement needed |
| Snapshot save | Server-side with `ON DUPLICATE KEY UPDATE`, encrypted details | Client-side flat encrypted blob | Need split model (header + per-entry) |
| History tab | Line chart + detailed snapshot view | Simple table with date/totals | Add line chart, enhance detail view |

---

## 3. ACCOUNTS (Old: Standalone Page → Current: Vault Entry Type)

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| A1 | Country-grouped display | Accounts grouped by country, collapsible sections, flag emoji, count badge | Vault filters show accounts grouped by country when viewing account type |
| A2 | Dedicated filter: Country | Dropdown filter for countries | Country filter available when viewing accounts |
| A3 | Dedicated filter: Account Type | Dropdown filter for account types | Account type filter available |
| A4 | Currency-country mismatch warning | Alert when selected currency doesn't match country's default | Warning displays in add/edit form |
| A5 | Account detail template system | Auto-load templates (personal > global > fallback), browse templates, save as template, delete template, make global | Full template system for account detail fields |
| A6 | Cascade delete warning | Warning about linked assets when deleting account | Confirmation mentions linked assets |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Account CRUD | Works via VaultPage (template-based) |
| Country/currency selectors | SearchableSelect with flags/symbols |
| Asset-account linking | NET NEW feature, better than old |

### Notes
The old version had a 946-line dedicated AccountsPage with specialized UX. Current version handles accounts as one of 6 entry types in VaultPage. The template-based approach is architecturally correct but may need per-type UX enhancements to restore parity.

---

## 4. ASSETS (Old: Standalone Page → Current: Vault Entry Type)

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| AS1 | Asset Type grouped display | Assets grouped by `asset_type_category`, collapsible, total per group | Group display when viewing asset type in vault |
| AS2 | Liquid/Liability filter | Dropdown: Assets Only / Liabilities Only / Both | Filter available for asset entries |
| AS3 | Ticker symbol badge | Displayed next to asset name | Ticker shown when template has ticker field |
| AS4 | Base Amount column | Shows value converted to base currency | Column shows converted amount |
| AS5 | Liquid Yes/No badge | Green Yes / muted No in table | Badge displayed per entry |
| AS6 | Asset/Liability badge | Color-coded badge | Badge displayed per entry |
| AS7 | Dynamic asset_data fields from JSON schema | Asset type's `json_schema` generates additional form fields | Template fields serve this purpose — verify parity |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Asset CRUD | Works via VaultPage |
| Country/currency auto-fill | Working in current |

---

## 5. INSURANCE (Old: Standalone Page → Current: Vault Entry Type)

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| I1 | InsuranceCategoryBadge in table | Color-coded: Life (primary), Health (success), Vehicle (warning), Property (info), Other (muted) | Badge component exists but not used in VaultPage table |
| I2 | Premium/Coverage formatted display | Right-aligned, currency-formatted | Values formatted with currency symbol |
| I3 | Payment Frequency badge | Monthly/Quarterly/Annually badge | Badge in table row |
| I4 | Maturity Date display with ExpiryBadge | Color-coded expiry status | ExpiryBadge component exists but not used in VaultPage |
| I5 | Category filter | Dropdown: Life/Health/Vehicle/Property/Other | Filter when viewing insurance type |

---

## 6. LICENSES (Old: Standalone Page → Current: Vault Entry Type)

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| L1 | Expiring soon alert | Warning banner with count + names of licenses expiring within 30 days | Alert at top of license view |
| L2 | ExpiryBadge in table | Color-coded expiry status per row | Badge displayed per entry |
| L3 | Preset category dropdown | Software, SaaS, Cloud, Development, Security, Media, Productivity, OS, Design, Database, Hosting + dynamic | Category selector with presets |
| L4 | Seats display | Number column in table | Shown in table and detail view |

---

## 7. PASSWORD VAULT (Old: Standalone Page → Current: Vault Entry Type)

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| V1 | Favourites section | Separate "Favourites" table at top with starred entries | Favourites shown prominently |
| V2 | Favourite toggle in table | Star icon per row, click to toggle, yellow when active | Toggle works with optimistic update |
| V3 | Website link in table | Clickable link (strips protocol for display) | Link shown and clickable |
| V4 | Category filter | Dropdown from existing categories (dynamic) | Filter available |
| V5 | Password show/copy in detail | Show/hide + copy buttons for password field | Working in VaultPage detail view — VERIFY |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Password generation | 20-char generator exists in VaultPage |
| Secret field show/hide/copy | Working for secret-type template fields |

---

## 8. SHARING PAGE

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| S1 | Source type selector | Icon buttons for Account/Asset/License/Insurance/Portfolio | User can pick what to share by source type |
| S2 | Sync modes | Auto Sync, Approval Required, Snapshot (3 radio-style buttons with descriptions) | All 3 modes available |
| S3 | Portfolio sharing modes | Summary Only, Full Snapshot, Saved Snapshot, Auto Sync, Selective | 5 portfolio share modes available |
| S4 | Include connected assets checkbox | For account shares, includes linked assets | Checkbox available and functional |
| S5 | Multi-select item list | Checkboxes to select which items to share (toggle all/individual) | Selection works |
| S6 | Label field | Optional text label for shares | Label input in share form |
| S7 | Expiration date | Optional expiry for shares | Date picker in share form |
| S8 | Detailed sent shares table | Recipient, source type, item count, sync mode, label, status, date, actions (View/Delete) | Full table with all columns, sortable |
| S9 | View Share modal | Full detail view using entity-specific DetailContent components | Modal shows decrypted share contents |
| S10 | Portfolio share display | Summary cards + breakdowns by country/type + individual asset tables | Full portfolio share rendering |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Basic sharing (encrypt + send) | Hybrid RSA encryption works |
| Ghost share warning | Shows warning for non-existent recipients |
| Revoke shares | Working |

### DEGRADED Features
| Feature | Old | Current | Gap |
|---------|-----|---------|-----|
| Share creation | Rich multi-step with type/mode/items selection | Simple entry dropdown + recipient | Need to restore full sharing workflow |

---

## 9. EXPORT PAGE

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| E1 | Section picker | 7 toggleable sections: Portfolio Summary, Accounts, By Country, By Type, Licenses, Vault Titles, Exchange Rates | All sections available with checkboxes |
| E2 | Data source selector | Live Data or any saved snapshot (dropdown) | Dropdown with snapshot options |
| E3 | Print/PDF export | `window.print()` with print-optimized layout | Print button generates printable view |
| E4 | Save as Image | html2canvas screenshot of preview | Image export button generates PNG |
| E5 | Full preview | Rendered tables with all sections before export | Preview card shows all selected sections |
| E6 | Portfolio Summary in export | 4 stat cards + base currency card | Summary section in preview/export |
| E7 | By Country/By Type tables in export | Aggregated breakdown tables | Tables render in preview/export |
| E8 | Exchange Rates table in export | All currencies with code, symbol, rate to base | Table in preview/export |
| E9 | Server-side CSV with blob download | `GET /export.php?format=csv&sections=...` | CSV downloads correctly with all selected sections |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Import from CSV/XLSX/Google Sheets | Working via ImportModal |
| JSON/CSV/XLSX export | Working (client-side generation) |
| Per-type selection for export | Working |

### DEGRADED Features
| Feature | Old | Current | Gap |
|---------|-----|---------|-----|
| Export richness | 7 configurable sections, preview, 3 formats (CSV/Print/Image), snapshot-based | Type checkboxes + format selector (JSON/CSV/XLSX), no preview | Need section picker, preview, Print/PDF, Image export |

---

## 10. PROFILE PAGE

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| PR1 | Self-delete account | Password confirmation + DELETE /auth.php?action=self-delete, red button, warning text | Delete button works with confirmation |
| PR2 | Recovery key audit log | Expandable section listing all recovery key operations (password reset, vault key change, regen) with timestamps | Log table renders in profile or security page |
| PR3 | RSA key info display | Shows has_public_key, has_encrypted_private_key status | Status displayed |

### MISSING Features (continued)
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| PR4 | Passkey management | Full section: list passkeys (name, created, last used, transports), add passkey (with name prompt), rename passkey, delete passkey (with confirmation) | Users can list, add, rename, delete passkeys from Profile or Security page |
| PR5 | Invite history table | Table of all sent invites with email, status (pending/used/expired/revoked), created date, copy link button | History table renders with all invites |
| PR6 | Revoke invite | Revoke button per pending invite, `DELETE /invitations.php?action=revoke&id={id}` | Revoke works for pending invites |
| PR7 | Recovery key regeneration | "Regenerate Recovery Key" button with confirmation dialog, shows new key on success | Button works, new key displayed with copy/save |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Edit profile (display name, email) | Working |
| Change password | Working |
| Invite user + copy URL | Working (but missing history + revoke) |
| Keyboard shortcuts config | Working (current has toggle per shortcut) |

### Notes
Recovery key management and vault key change were on ProfilePage in old version. In current version, they're on SecurityPage — which is fine (better organization). RSA key info was a minor display. Self-delete is a real gap. **Passkey management is completely missing** — no page allows users to list/rename/delete passkeys. Only the enrollment banner (Layout) and login (LoginPage) reference WebAuthn. **Invite history/revoke is missing** — current ProfilePage only has send-invite, no list of past invites.

---

## 11. ADMIN PAGE

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| AD1 | Account Types tab | CRUD for account types (name, description, icon) | Admin can manage account types |
| AD2 | Asset Types tab | CRUD for asset types (name, category, JSON schema, icon) | Admin can manage asset types |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Users tab | Working (admin/regular sections, search, create/edit) |
| Password reset/force change | Working with admin messages |
| Force vault key change | Working |
| Countries tab | Working |
| Currencies tab | Working (search, toggle, refresh rates) |

### Notes
Old had 5 tabs (Users, Account Types, Asset Types, Countries, Currencies). Current has 3 tabs (Users, Countries, Currencies). Account Types and Asset Types management is missing. In the template-based architecture, these are partially replaced by the Templates page, but admin-level type management (the reference data categories) is still needed.

---

## 12. SECURITY PAGE (NET NEW — replaces parts of old Profile)

This page is **entirely new** in the current version. Old version had these features scattered across ProfilePage. Current consolidation is better UX.

### All NET NEW (preserve):
- Vault Key management (auto-lock mode, timeout, refresh persistence, key type, change key)
- Sharing Keys (RSA) setup
- Recovery key view/copy
- Privacy settings (IP logging mode)
- Security audit log

### MISSING (should be on this page or Profile)
| # | Feature | Old Location | Success Criteria |
|---|---------|-------------|------------------|
| SEC1 | Recovery key regeneration | Old ProfilePage | "Regenerate" button with confirmation, shows new key (same as PR7) |
| SEC2 | Passkey management | Old ProfilePage | List/add/rename/delete passkeys (same as PR4) |

---

## 13. TEMPLATES PAGE (NET NEW)

Entirely new in current version. Replaces old account-detail-templates with a more general system.

### All NET NEW (preserve):
- Global vs My Templates
- Create/edit templates with field editor
- 6 entry types supported
- Subtype, country code, icon
- Field types: text, secret, url, textarea, number, date, account_link
- Request promotion to global

---

## 14. BULK OPERATIONS

### DEAD CODE (files exist but unused)
| Component | File | Status |
|-----------|------|--------|
| BulkWizard | `src/client/components/BulkWizard.jsx` | Imports BulkAddModal, depends on missing `entityFieldConfigs` |
| BulkAddModal | `src/client/components/BulkAddModal.jsx` | Imports from missing `../lib/entityFieldConfigs` |
| BulkEditModal | `src/client/components/BulkEditModal.jsx` | Same missing dependency |

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| B1 | Bulk Add (spreadsheet-style) | Multi-row editor per entity type, 50 row max, paste from clipboard | Bulk add works for vault entries |
| B2 | Bulk Edit | Select items → edit specific fields across all | Bulk edit works on selected entries |
| B3 | Bulk Delete | Select items → confirm → batch delete | Bulk delete with confirmation |
| B4 | Bulk Setup Wizard | 4-step: Accounts → Assets → Licenses → Insurance | Wizard guides new users through data entry |
| B5 | entityFieldConfigs.js | Field definitions for 5 entity types with types, refs, aliases | Needed for bulk operations — must be rebuilt for template-based system |

### MISSING API
| API | Old | Current | Gap |
|-----|-----|---------|-----|
| `bulk.php` | Dedicated API: batch create/update/delete for any entity type | No `bulk.php` exists. `vault.php` has `bulk-create` action only. | No bulk edit or bulk delete API endpoint. |

### Notes
The old bulk system was built for relational entity types. The current template-based architecture needs a different approach — bulk operations on encrypted JSON blobs. The field configs need to come from templates, not a static config file.

---

## 15. DETAIL MODALS

### DEAD CODE (files exist but unused)
| Component | File | Status |
|-----------|------|--------|
| AccountDetailModal | `src/client/components/AccountDetailModal.jsx` | Not imported by any page |
| AssetDetailModal | `src/client/components/AssetDetailModal.jsx` | Not imported by any page |
| InsuranceDetailModal | `src/client/components/InsuranceDetailModal.jsx` | Not imported by any page |
| LicenseDetailModal | `src/client/components/LicenseDetailModal.jsx` | Not imported by any page |
| VaultEntryDetailModal | `src/client/components/VaultEntryDetailModal.jsx` | Not imported by any page |

### Notes
VaultPage has its own detail view modal (inline, template-driven). The old entity-specific detail modals are more specialized (with badges, formatted fields, etc.) but are designed for the old relational data model. The current VaultPage detail view is generic but handles all types.

**Decision needed:** Revive entity-specific detail modals adapted for template data? Or enhance VaultPage's generic detail view with type-specific rendering?

---

## 16. LAYOUT / NAVIGATION

### MISSING Features
| # | Feature | Old Implementation | Success Criteria |
|---|---------|-------------------|------------------|
| LY1 | Pending share count badge | Badge on Sharing nav link showing unread received shares | Badge shows count, updates on share receipt |

### PRESERVED Features
| Feature | Notes |
|---------|-------|
| Sidebar with sections | Working (slightly different grouping — both fine) |
| Dark mode toggle | Working |
| Hide amounts toggle | Working |
| Vault lock/unlock/setup in footer | Working |
| Sign out | Working |
| Version + build info | Working |
| Passkey enrollment banner | NET NEW, working |
| Page notices | Working |
| Keyboard shortcuts | Working |

### DEGRADED Features
| Feature | Old | Current | Gap |
|---------|-----|---------|-----|
| Nav sections | Overview, Finance, Secure Storage, Settings, Help | Overview, Tools, Account, Help | Different grouping — current is fine |
| Sidebar links | Dashboard, Portfolio, Export, Accounts, Assets, Insurance, Vault, Licenses, Sharing, Profile, Admin, Help | Dashboard, Vault, Portfolio, Sharing, Import/Export, Templates, Security, Profile, Admin, Help | Current reflects new architecture — fine |

---

## 17. OTHER MISSING FEATURES

| # | Feature | Old Location | Success Criteria |
|---|---------|-------------|------------------|
| O1 | Account detail templates API | `account-detail-templates.php` | Dynamic field suggestions per account type/country — may be subsumed by Templates |
| O2 | Server-side CSV export | `export.php` | Server generates CSV from aggregated data |
| O3 | importResolvers.js | `src/client/importResolvers.js` | Field resolution for imports (currency by code/name, booleans, etc.) |

### Notes
- O1: The old account-detail-templates system let users save/browse/share templates for account detail fields. The current Templates page is more general and handles this. **Likely no gap** — verify.
- O2: Server-side CSV relied on server-decrypted data. In client-encryption architecture, export must be client-side. **Current approach (client-side export) is correct.**
- O3: Import resolvers existed as a separate file. Current ImportModal has `importUtils.js` which covers this. **Likely no gap** — verify.

---

## 18. NET NEW FEATURES (Current Only — Must Preserve)

| # | Feature | Location | Description |
|---|---------|----------|-------------|
| N1 | Client-side encryption | `lib/crypto.js`, `EncryptionContext` | AES-256-GCM, PBKDF2, DEK wrapping. **Non-negotiable.** |
| N2 | Template-based entry system | VaultPage, TemplatesPage, `templates.php` | All vault data as encrypted JSON blobs with template-defined fields |
| N3 | 6 entry types in unified vault | VaultPage | password, account, asset, license, insurance, custom |
| N4 | IndexedDB client cache | `lib/entryStore.js` | 4 stores (entries, shared, templates, snapshots), auto-clear on tab close |
| N5 | SearchableSelect | `components/SearchableSelect.jsx` | Type-ahead dropdown with keyboard nav, disabled options with hints |
| N6 | Cross-device sync | `SyncContext`, `SyncToast`, `sync.php` | Polling + toast + auto-pull reference data |
| N7 | Asset-account linking | VaultPage templates | `linked_account_id` field, post-save linking prompt, linked assets display |
| N8 | Country→currency auto-fill | VaultPage forms | Country selection auto-sets default currency |
| N9 | Vault key types | SecurityPage, EncryptionKeyModal | PIN (6+), Password (8+), Passphrase (16+) with strength meter |
| N10 | Auto-lock modes | SecurityPage, EncryptionContext | Timed/Session/Manual with configurable timeout + activity reset |
| N11 | Session persistence | EncryptionContext | sessionStorage vault key caching (tab-scoped), persist-in-tab option |
| N12 | Recovery key download | EncryptionKeyModal | Download as .txt file |
| N13 | Import from Google Sheets | ImportModal | Direct URL import with sheet ID extraction |
| N14 | Import from XLSX (multi-sheet) | ImportModal | xlsx library, auto-type detection from sheet names |
| N15 | Fuzzy column mapping | `lib/importUtils.js` | 4-level matching: exact, alias, substring, partial |
| N16 | XLSX/JSON export | ImportExportPage | Client-side file generation |
| N17 | IP disclosure at registration | RegisterPage | Acknowledgment checkbox + opt-out |
| N18 | Offline banner | Layout | Detects navigator.onLine, blocks mutations |
| N19 | Form draft persistence | `useDraft` hook | Auto-save to localStorage, dirty-check prompts |
| N20 | Entry type changeable in edit | VaultPage | Can change template on existing entry |
| N21 | Soft delete + 24h recovery | VaultPage | Recently Deleted modal with restore |
| N22 | Cash equivalent template | Database seed | New asset subtype |
| N23 | Force vault key/password reset | AdminPage | Admin can force with custom message |
| N24 | `admin_action_message` | `user_vault_keys` table | Custom admin message displayed in force-change modals |
| N25 | SecurityPage (consolidated) | SecurityPage | All security settings in one page (was scattered in old Profile) |
| N26 | TemplatesPage | TemplatesPage | User-created + global templates with field editor |
| N27 | PWA / Service Worker | Vite PWA plugin | Installable app |
| N28 | Passkey enrollment banner | Layout | Auto-prompts users without passkeys |
| N29 | Invite request from registration | RegisterPage | Non-users can request invites (name + email) |

---

## 19. IMPLEMENTATION PRIORITY (Suggested)

### Phase 1: Portfolio Overhaul (Biggest gap, most user value)
- P1-P21: Full portfolio page with 7 tabs, charts, currency conversion
- Requires: client-side aggregation module, Recharts integration, template `portfolio_role` markers

### Phase 2: Dashboard Enrichment
- D1-D10: Financial summary cards, charts, quick access, expiring licenses alert
- Depends on: Phase 1 (portfolio aggregation module)

### Phase 3: Export Enhancement
- E1-E9: Section picker, preview, Print/PDF, Image export
- Depends on: Phase 1 (portfolio aggregation for summary data)

### Phase 4: Sharing Enhancement
- S1-S10: Full sharing workflow restoration
- Independent of Phase 1-3

### Phase 5: Per-Type UX Enhancements
- A1-A6, AS1-AS7, I1-I5, L1-L4, V1-V5: Type-specific badges, filters, grouped views
- Can be done incrementally within VaultPage

### Phase 6: Bulk Operations
- B1-B5: Rebuilt for template-based architecture
- Depends on: Phase 5 (need type-specific field awareness)

### Phase 7: Minor Gaps
- PR1: Self-delete account
- AD1-AD2: Account/Asset type admin tabs
- LY1: Pending share count badge
- D9: Bulk Setup Wizard

---

## 20. DECISIONS NEEDED BEFORE IMPLEMENTATION

| # | Decision | Options | Impact | Phase |
|---|----------|---------|--------|-------|
| DC1 | ~~Account balance vs Cash Equivalent double-counting~~ | **DECIDED: Option A** — Remove balance from account templates. Accounts are containers only; all monetary values live in linked assets. No special-case aggregation logic needed. | ~~Blocks portfolio aggregation logic~~ | Phase 1 |
| DC2 | ~~Entity-specific detail modals vs generic template view~~ | **DECIDED: Option A (fresh build)** — Delete the 5 dead modal files (built for old relational data). Build new type-specific detail components for template/encrypted data. Each type owns its layout (accounts show linked assets, assets show value calc, insurance shows expiry/premium, etc.). Share common utilities (field renderer, copy button) across them. | ~~Affects Phase 5 approach~~ | Phase 5 |
| DC3 | ~~Bulk operations architecture~~ | **DECIDED: Option C+** — Bulk delete (select entries, confirm, batch delete — no crypto needed) + Bulk add (spreadsheet-style entry, encrypt on save, uses same templates as single add). Bulk edit deferred. Delete the 3 dead component files (built for old relational model), rebuild fresh for template/encrypted architecture. | ~~Affects Phase 6 scope~~ | Phase 6 |
| DC4 | ~~`portfolio_role` + `is_liability` + tags system~~ | **DECIDED: Option B** — `portfolio_role` (value/quantity/price markers on template fields) + `is_liability` (boolean on templates) ship now. Tags system deferred to later phase. | ~~Affects Phase 1 DB migrations~~ | Phase 1 |
| DC5 | ~~Display currency user preference~~ | **DECIDED: Option C (modified)** — Server-side default on `users` table (`display_currency VARCHAR(3)`, NULL = base currency), set via Profile page. Portfolio page has a client-side dropdown (React state) that defaults to the user's preference but can be temporarily switched for viewing. No localStorage cache needed. | ~~Affects Phase 1 UI~~ | Phase 1 |
| DC6 | ~~Where to put passkey management + recovery regen~~ | **DECIDED: Option C** — Passkey management (list/add/rename/delete) + recovery key regeneration go on SecurityPage. Invite history + revoke go on ProfilePage (next to existing invite form). Security stuff on Security, social stuff on Profile. | ~~Affects Phase 7~~ | Phase 7 |
| DC7 | ~~Sharing page scope for restoration~~ | **DECIDED: Option A (modified)** — Full restore of all source types, multi-select, labels, expiration, sent table, view modal. Individual entry sharing gets all 3 sync modes (snapshot, auto-sync, approval required) — auto-sync re-encrypts shared copy on source entry save via existing `source_entry_id` FK. Portfolio sharing is snapshot-only (point-in-time encrypted summary). Add `sync_mode` column to `shared_items`. | ~~Affects Phase 4 scope~~ | Phase 4 |
