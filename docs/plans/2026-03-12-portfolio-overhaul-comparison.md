# Portfolio Overhaul — Feature Comparison & Success Criteria

**Date:** 2026-03-12
**Purpose:** Reference document for implementing the portfolio overhaul. Every item in "MISSING" must be restored. Every item in "NEW — KEEP" must not regress.

---

## Strategy

Port the old portfolio UI from `v1.1-server-side-encryption` tag, replacing server-side aggregation (`Portfolio.php`) with a client-side aggregation module. Layer new features (from brainstorming) on top.

**Reference tag:** `v1.1-server-side-encryption` (commit `bd8df2a`)

---

## Feature Comparison: Old (v1.1) vs Current (main)

### Portfolio Page — MISSING (must restore)

| # | Feature | Old Implementation | Notes for Port |
|---|---------|-------------------|----------------|
| 1 | Currency conversion | Server-side `base_amount = amount * exchange_rate_to_base`, client display currency dropdown with triangulation `1 / exchange_rate_to_base` | Move to client-side aggregation module |
| 2 | 7 tabs | Overview, By Country, By Account, By Asset Type, All Assets, By Currency, History | Restore all tabs |
| 3 | Pie charts (by country, by type) | Recharts `PieChart`, `Pie`, `Cell`, `ResponsiveContainer` | Reuse old chart code |
| 4 | Bar chart (assets vs net by country) | Recharts `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid` | Reuse |
| 5 | Line chart (net worth over time) | Recharts `LineChart`, `Line` on snapshots | Reuse |
| 6 | Custom dark tooltip | Styled tooltip component inline | Reuse |
| 7 | 4 summary cards | Total Assets, Liquid Assets, Liabilities, Net Worth (color-coded) | Restore (currently only 3 flat cards) |
| 8 | Sortable tables on all tabs | `useSort` + `SortableTh` on every table | Hooks exist in codebase, just wire up |
| 9 | Expandable country cards | Click card header → expand sub-table of assets in that country | Reuse pattern |
| 10 | Expandable account cards | Same pattern, grouped by linked account | Reuse pattern |
| 11 | Bulk select from portfolio | `useSelection` hook, checkbox column, bulk toolbar | Hook exists, wire to portfolio |
| 12 | Bulk edit from portfolio | `BulkEditModal` with spreadsheet-like editor | Component exists |
| 13 | Bulk delete from portfolio | Confirm dialog → `POST /bulk.php?action=delete` | Need client-side equivalent |
| 14 | Asset detail modal (click row) | `AssetDetailModal` — full read-only detail view | Component exists, wire to portfolio rows |
| 15 | Display currency selector | `<select>` dropdown in page header, converts all amounts | Reuse, add user preference (D12) |
| 16 | Rates last updated badge | Badge in page subtitle showing `rates_last_updated` | Reuse |
| 17 | `is_liquid` per asset | Boolean flag, separate "Liquid Assets" total + column | Evolving to tags system (see new features) |
| 18 | `is_liability` per asset | Boolean flag, `netWorth = assets - liabilities` | Moving to template-level `is_liability` flag |
| 19 | Snapshot save (server-side) | `POST /portfolio.php?action=snapshot` with `ON DUPLICATE KEY UPDATE` | Replace with client-side encrypt + split snapshot model |
| 20 | Snapshot detail view | `GET /portfolio.php?action=snapshot&date=X` with encrypted `details_json` | Adapt for split model |
| 21 | Hide amounts in charts | Y-axis shows `***`, tooltip values show `******` | Reuse via `useHideAmounts` |
| 22 | CHART_COLORS palette | 8-color array for pie/bar charts | Reuse constant |
| 23 | By Currency tab | Client-side grouping by `currency_code`, sum `base_amount` | Reuse, adapt for new data shape |
| 24 | Error/retry state | AlertTriangle + message + Retry button | Reuse pattern |
| 25 | Vault locked state | Lock icon + unlock/setup button | Already exists in current |

### Portfolio Page — EXISTS (working in current)

| Feature | Notes |
|---------|-------|
| Live portfolio view (basic) | Works but broken (no currency conversion) — will be replaced |
| Snapshot save (client-side) | Works but flat blob — will be replaced with split model |
| History tab (basic) | Works but limited — will be enhanced |
| Hide amounts toggle | Working via `useHideAmounts` context |

### NEW Features — KEEP (must not regress during port)

| # | Feature | Location | Description |
|---|---------|----------|-------------|
| 1 | Client-side encryption | `lib/crypto.js`, `EncryptionContext` | All vault data encrypted/decrypted in browser. **Non-negotiable.** |
| 2 | Vault key unlock modes | `SecurityPage`, `EncryptionContext` | Timed/session/manual + persist_in_tab |
| 3 | SearchableSelect | `components/SearchableSelect.jsx` | Type-ahead dropdowns, used throughout |
| 4 | Asset-account linking | VaultPage, templates | `linked_account_id`, view linked assets, post-save prompts |
| 5 | Cross-device sync | `SyncContext`, `SyncToast`, `sync.php` | Polling + toast + auto-pull reference data |
| 6 | Reference data caching | `useReferenceData` hook | Module-level cache + invalidation |
| 7 | Dark mode | Layout sidebar toggle | localStorage persisted |
| 8 | Keyboard shortcuts | `useKeyboardShortcuts`, `ShortcutOverlay` | Ctrl+L/U/K//, configurable |
| 9 | WebAuthn/passkey login | `WebAuthnLogin`, `LoginPage` | Registration + authentication |
| 10 | Form draft persistence | `useDraft` hook | Auto-save to localStorage |
| 11 | Cash equivalent template | Database seed | New asset subtype |
| 12 | Entry type changeable in edit | VaultPage edit modal | Can change template on existing entry |
| 13 | Soft delete + recovery | VaultPage | 24h recovery window |
| 14 | Import from Google Sheets | `ImportModal` | Direct URL import |
| 15 | PWA / service worker | Vite PWA plugin | Installable app |
| 16 | Page notices | `PageNotice` component | Server-driven per-route banners |
| 17 | Force vault key/password reset | AdminPage | Admin can force with custom message |
| 18 | `admin_action_message` | `user_vault_keys` table | Custom admin message on forced reset |

### NEW Features — TO BUILD (from brainstorming session)

| # | Feature | Decision | Details |
|---|---------|----------|---------|
| 1 | `portfolio_role` on template fields | Decided | Fields declare `"value"`, `"quantity"`, or `"price"` — data-driven value extraction |
| 2 | `is_liability` flag on templates | Decided | Template-level boolean. `finalValue = is_liability ? -Math.abs(rawValue) : rawValue`. Users can also enter negative values. |
| 3 | Tags system | Discussed | Replace `is_liquid`/`is_liability` booleans with array of tags: `[liability, liquid, long-term]`. Predefined + custom. |
| 4 | Split snapshot model | Decided | `portfolio_snapshots` header + `portfolio_snapshot_entries` per-entry rows. Full metadata per entry. |
| 5 | `MEDIUMTEXT` for encrypted columns | Decided | Upgrade from `TEXT` (64KB) to `MEDIUMTEXT` (16MB) on vault_entries and snapshot tables |
| 6 | `base_currency` in rate history | Decided | Add column to `currency_rate_history`, written at scrape time |
| 7 | `base_currency` exposed to client | Decided | Read from latest rate history row, included in currencies response |
| 8 | Display currency user preference | Decided (D12) | Saved preference + portfolio dropdown. Triangulation: `amount * rate_to_gbp / display_rate_to_gbp` |
| 9 | `subtype` in template API response | Decided (D8) | Add to `buildTemplateObject()` in MariaDbAdapter |
| 10 | Crypto template: `price_per_unit` | Decided (D6) | New field, value = `quantity × price_per_unit` |
| 11 | Exchange rate date on portfolio page | Decided | Show when rates were last updated |
| 12 | `price_per_unit` for crypto | Decided (D6) | Like stocks: `quantity × price_per_unit` |

---

## Architecture: Old vs New

| Layer | Old (v1.1) | New (port) |
|-------|-----------|------------|
| Data model | Relational `assets` table with FKs to `asset_types`, `currencies`, `countries`, `accounts` | Template-based `vault_entries` with encrypted JSON blobs |
| Value fields | Single `amount` column per asset (server decrypted) | Template-driven via `portfolio_role` markers on fields |
| Aggregation | Server-side PHP (`Portfolio.php::aggregatePortfolio()`) | New client-side JS module (`portfolioAggregator.js` or similar) |
| Currency conversion | Server computes `base_amount`, client displays | Client computes everything from decrypted entries + currencies list |
| Grouping | Server groups by country/type/account via SQL JOINs | Client groups from decrypted entry metadata (template subtype, currency, country field) |
| Snapshots | Server aggregates + stores (partially encrypted) | Client encrypts per-entry snapshot rows |
| Charts | Recharts (already a dependency) | Same — reuse old chart code |
| UI | 763-line PortfolioPage.jsx | Port old UI, swap data source |

---

## Implementation Approach (High Level)

1. **Client-side aggregation module** — replaces `Portfolio.php`. Takes decrypted entries + currencies → outputs same shape as old API response (summary, by_country, by_type, by_account, assets list)
2. **Port old PortfolioPage UI** — copy from `v1.1-server-side-encryption` tag, replace `api.get('/portfolio.php')` with client-side aggregation call
3. **Backend prep** — add `subtype` + `is_liability` to template response, `base_currency` to rate history, `MEDIUMTEXT` migration, `portfolio_role` in template field definitions
4. **Split snapshot model** — new tables + API, client-side encrypt per-entry
5. **New features layer** — tags system, display currency preference, `price_per_unit` for crypto

---

## Old Code Reference Files (from tag `v1.1-server-side-encryption`)

| File | Lines | Purpose |
|------|-------|---------|
| `src/client/pages/PortfolioPage.jsx` | 763 | Full portfolio UI with 7 tabs, charts, tables |
| `src/api/portfolio.php` | 203 | Portfolio REST API (aggregation, snapshots, rates) |
| `src/core/Portfolio.php` | 186 | Server-side aggregation logic |
| `src/client/components/AssetDetailModal.jsx` | ~100 | Asset detail view modal |
| `src/client/components/BulkEditModal.jsx` | ~200 | Spreadsheet-like bulk editor |

**To view:** `git show v1.1-server-side-encryption:<path>`

---

## Success Criteria

### Must Pass (feature parity)
- [ ] All 7 tabs render with correct data
- [ ] Currency conversion works (display currency dropdown, triangulation math)
- [ ] Pie/Bar/Line charts render correctly
- [ ] Sortable tables on all tabs
- [ ] Expandable country and account cards
- [ ] Asset detail modal on row click
- [ ] Bulk select/edit/delete from All Assets tab
- [ ] Snapshot save and history view
- [ ] Rates last updated shown on page
- [ ] Hide amounts works in all charts, tables, tooltips

### Must Pass (new features preserved)
- [ ] Client-side encryption still works (no server-side decryption)
- [ ] Vault unlock modes (timed/session/manual) unaffected
- [ ] Cross-device sync still works
- [ ] Dark mode renders correctly on portfolio page
- [ ] SearchableSelect components still work
- [ ] Asset-account linking still works
- [ ] WebAuthn login unaffected

### Must Pass (new enhancements)
- [ ] `portfolio_role` on template fields drives value extraction
- [ ] `is_liability` flag on templates negates values
- [ ] Display currency user preference persisted and applied
- [ ] `subtype` available in template response for grouping
- [ ] Split snapshot model stores per-entry data
- [ ] `base_currency` recorded in rate history at scrape time
