# Reference Data Caching & Portfolio Overhaul — Decision Log

**Date:** 2026-03-10
**Status:** Draft — awaiting review before implementation

---

## Feature 1: Reference Data Caching

### Current State

Three different fetching patterns exist with no shared caching:

| Consumer | Pattern | Caches? |
|----------|---------|---------|
| VaultPage | `useEffect` + `api.get` (countries, currencies) | No |
| AdminPage | `useCallback` + `api.get` (countries, currencies with `&all=1`) | No |
| BulkWizard | `useReferenceData` hook | In-memory only (module-scoped `const cache = {}`) |

The `useReferenceData` hook already exists at `src/client/hooks/useReferenceData.js` with module-level caching — but only BulkWizard uses it. Its `invalidateReferenceCache()` export is never called anywhere.

Templates have a better pattern: fetched at vault unlock, stored in IndexedDB, read by consumers.

### Approaches

#### Option A: Expand `useReferenceData` hook (Recommended)

Migrate VaultPage and AdminPage to use the existing `useReferenceData` hook. Add optional TTL to the module-level cache. No IndexedDB — reference data is small (~5KB) and doesn't warrant persistence.

- **Pros:** Minimal new code; hook already works and is tested by BulkWizard; module-level cache survives SPA navigation naturally
- **Cons:** Cache lost on page refresh (but these are tiny fetches, ~50ms); no cross-tab sharing
- **Effort:** Small — swap fetch calls in 2 files, add TTL check (~10 lines)

#### Option B: IndexedDB persistence (like templates)

Add `reference_data` store to `entryStore.js`, populate at vault unlock alongside templates, add TTL-based expiry.

- **Pros:** Survives page refresh; consistent with template pattern
- **Cons:** More code; IndexedDB is cleared on vault lock anyway (`entryStore.clear()`), so TTL benefit is limited; reference data doesn't require vault unlock (it's not encrypted)
- **Effort:** Medium — new IndexedDB store, populate logic, TTL check

#### Option C: React Context provider

Create a `ReferenceDataContext` that fetches on app mount (after auth), provides data to all children.

- **Pros:** Clean React pattern; single source of truth; components don't need to manage fetch calls
- **Cons:** More boilerplate (context + provider + hook); need to handle AdminPage's `&all=1` variant separately; context re-renders all consumers when data updates
- **Effort:** Medium

### Decision Points

> **D1: Which caching approach?**
> Recommendation: **Option A** — simplest, solves the problem (eliminate redundant fetches), and we already have the hook.

> **D2: AdminPage uses `&all=1` for currencies (includes inactive). Same cache key or separate?**
> Recommendation: Separate cache key (`currencies-admin` vs `currencies`). Admin needs inactive currencies for management; regular users shouldn't see them.

> **D3: Should we add TTL, or is the existing "once per SPA session" sufficient?**
> Reference data changes rarely (admin adds a country, refreshes exchange rates). The module cache already clears on page refresh. A TTL of 5-10 minutes adds marginal value but also marginal complexity.
> Recommendation: **No TTL for v1.** Just use the existing module cache. If the admin changes data, they can refresh the page. Revisit if users report stale data.

> **D4: Should we wire up `invalidateReferenceCache()` (currently dead code)?**
> It could be called after admin CRUD operations (add country, update currency). This would make AdminPage changes visible without a page refresh.
> Recommendation: **Yes, wire it up** in AdminPage after successful create/update/delete. Low effort, good UX.

---

## Feature 2: Portfolio Overhaul

### Current State

`PortfolioPage.jsx` (189 lines) has these problems:

1. **No currency conversion** — sums raw numbers: 1000 INR + 1000 GBP = 2000
2. **Incomplete value extraction** — uses `value || current_value || 0` for assets and `balance || 0` for accounts. Misses `shares * price_per_share` for stocks, `face_value` for bonds, and crypto has no price field at all
3. **No grouping** — flat list, no breakdown by type/category/currency
4. **No `subtype` in API response** — `buildTemplateObject()` in MariaDbAdapter returns `name, icon, key, fields` but not `subtype`. Can't group by asset type without it
5. **Snapshot data is flat** — stores `{ assets: number, accounts: number, total: number }` with no per-currency or per-category detail

### What's Available

- **Exchange rates:** `GET /reference.php?resource=currencies` returns `exchange_rate_to_base` per currency. Base = GBP (configurable via `BASE_CURRENCY` env var). Already returned in `refresh-rates` response but not exposed as standalone config.
- **Template subtypes:** Stored in `entry_templates.subtype` but not returned by vault API
- **Decrypted entry fields:** Each entry's `currency` field contains a currency code (e.g., "USD", "GBP")
- **Template key:** `entry.template.key` = "account" or "asset" (available now)

### Value Extraction Logic (Per Subtype)

| Subtype | Fields | Formula | Notes |
|---------|--------|---------|-------|
| Generic asset | `value` | Direct | — |
| real_estate | `current_value` | Direct | Also has `purchase_price` (for gain/loss later) |
| vehicle | `current_value` | Direct | — |
| stock | `shares`, `price_per_share` | `shares × price_per_share` | Most important fix |
| bond | `face_value` | Direct | Could add market_value later |
| crypto | `quantity` | **Cannot compute** | No price field in template |
| cash_equivalent | `value` | Direct | — |
| savings/checking/brokerage/401k/wallet | `balance` | Direct | — |
| credit_card | `balance` | Direct | **Should be negative** (liability) |

### Approaches

#### Approach A: Client-side aggregation with currency map (Recommended)

Fetch currencies alongside portfolio data. Build a `code → exchange_rate_to_base` map. Convert each entry's value to base currency before summing. Group by template key/subtype.

```
convertedValue = rawValue * rateMap[entry.currency]
```

- **Pros:** All data already available; no backend changes needed (except adding subtype to template response); computation is fast (~ms for hundreds of entries)
- **Cons:** Exchange rates may be stale if admin hasn't refreshed; no real-time crypto prices
- **Effort:** Medium — new aggregation logic, fetch currencies, update snapshot format

#### Approach B: Server-side aggregation endpoint

New `GET /portfolio.php?action=aggregate` that decrypts entries server-side and returns pre-computed breakdowns.

- **Pros:** Server can fetch live exchange rates; single API call
- **Cons:** **Breaks the security model** — the whole point of Citadel is that the server never sees decrypted data. DEK is client-side only. This approach is architecturally invalid.
- **Verdict:** ❌ Rejected — violates client-side encryption design.

### Breakdown Groupings

> **D5: What groupings should the portfolio show?**
>
> Options (can pick multiple):
> - **By entry type** — Assets vs Accounts (already exists, but add proper currency conversion)
> - **By subtype** — Stocks, Real Estate, Savings, Brokerage, etc. (needs `subtype` in API response)
> - **By currency** — Show totals per currency before and after conversion
> - **By country** — Group by the country field in decrypted data
>
> Recommendation: **Entry type + subtype + currency.** Country grouping adds complexity for marginal value — most users won't have entries across many countries. Can add later.

### Decision Points

> **D6: How to handle crypto (no price field)?**
>
> Options:
> - **(a)** Add `current_value` field to the Crypto template (user manually enters current portfolio value)
> - **(b)** Add `price_per_unit` field to Crypto template (like stocks: `quantity × price_per_unit`)
> - **(c)** Skip crypto in portfolio totals; show as "N/A" with quantity only
>
> Recommendation: **(a)** — simplest. User enters their crypto's current value. No API integration needed. Consistent with how real_estate/vehicle work. Can add live price APIs later.

> **D7: Should credit card balances be treated as liabilities (negative)?**
>
> Currently `balance` is stored as a positive number (e.g., "5000" means you owe $5000).
> Options:
> - **(a)** Treat credit_card subtype as negative: `netWorth = assets + accounts - creditCards`
> - **(b)** Let the user enter negative values manually
> - **(c)** Add a `liability` flag to account templates
>
> Recommendation: **(a)** — Use the subtype. If `template.subtype === 'credit_card'`, negate the balance. Simple, no schema change.

> **D8: Add `subtype` to the vault API template response?**
>
> `buildTemplateObject()` currently returns `{ name, icon, key, fields }`. Adding `subtype` requires:
> - MariaDbAdapter: add `subtype` to the JOIN SELECT and `buildTemplateObject()`
> - The JOIN query at line 38 already selects `et.template_key` — need to also select `et.subtype`
>
> Recommendation: **Yes, required.** Without it, client can't distinguish stock from real_estate from generic asset. Backward-compatible (new optional field).

> **D9: How should the base currency be exposed to the client?**
>
> Currently `BASE_CURRENCY` is server-side only (PHP `config.php`). The client needs it to label converted totals ("Net Worth in GBP").
>
> Options:
> - **(a)** Add a `GET /reference.php?resource=config` endpoint returning `{ base_currency: "GBP" }`
> - **(b)** Include `base_currency` in the currencies response
> - **(c)** Add it to the `/auth.php?action=me` response
>
> Recommendation: **(b)** — it's already returned in the `refresh-rates` response. Just add it to the regular `GET currencies` response too. One extra field, no new endpoint.

> **D10: Snapshot format — what should we store for history?**
>
> Current: `{ assets: number, accounts: number, total: number, date, asset_count, account_count }`
>
> Proposed:
> ```json
> {
>   "v": 2,
>   "base_currency": "GBP",
>   "total": 123456.78,
>   "assets": 80000,
>   "accounts": 43456.78,
>   "asset_count": 5,
>   "account_count": 3,
>   "by_subtype": {
>     "stock": 45000,
>     "real_estate": 30000,
>     "savings": 20000,
>     "brokerage": 18456.78,
>     "credit_card": -5000
>   },
>   "by_currency": {
>     "GBP": 100000,
>     "USD": { "original": 30000, "converted": 23456.78 }
>   },
>   "rates_used": { "USD": 0.79, "INR": 0.0094 },
>   "date": "2026-03-10T..."
> }
> ```
>
> Recommendation: **Yes, enrich snapshots.** The `v: 2` field lets us gracefully handle old snapshots (display with limited detail). Rates used at snapshot time are important for auditing.

> **D12: User-selectable display currency (base currency override)?**
>
> The server stores all exchange rates as `X → GBP` (the server's `BASE_CURRENCY`). But users may want to view their portfolio in USD, INR, EUR, etc.
>
> **Triangulation math:** To convert INR → USD when rates are stored relative to GBP:
> ```
> valueInGBP = amountINR * inr_rate_to_gbp
> valueInUSD = valueInGBP / usd_rate_to_gbp
> ```
> Or equivalently: `amountINR * (inr_rate_to_gbp / usd_rate_to_gbp)`
>
> Options:
> - **(a)** Per-user preference stored in `users` table (`display_currency` column), selectable in Profile. Portfolio always converts to this currency.
> - **(b)** Portfolio-page dropdown — ephemeral, no persistence. Quick toggle without a settings roundtrip.
> - **(c)** Both — preference sets the default, dropdown allows temporary override.
>
> Recommendation: **(c)** — default from user preference (falls back to server `BASE_CURRENCY` if not set), with a dropdown on the Portfolio page for quick switching. The dropdown is purely client-side (no API call to save). The preference is saved via the existing profile/preferences API.
>
> **Implementation notes:**
> - All aggregation logic works in the server's base currency (GBP) internally
> - Final display conversion: `valueInDisplayCurrency = valueInGBP / displayCurrency_rate_to_gbp`
> - Snapshot data always stores GBP values + `rates_used` — display currency conversion is applied at render time, so historical snapshots can be re-displayed in any currency

> **D11: Should we show a chart/sparkline for historical snapshots?**
>
> Current history tab is a plain table. A line chart would be more useful.
>
> Recommendation: **Defer.** Get the data model right first. We can add a chart library (lightweight, e.g., `recharts` or inline SVG sparkline) in a follow-up.

---

## Implementation Order (Suggested)

If both features are approved:

1. **Reference caching** (Feature 1) — do this first, since the Portfolio feature needs currencies
   - Migrate VaultPage + AdminPage to `useReferenceData`
   - Wire up `invalidateReferenceCache()` in AdminPage CRUD
   - Remove dead `useEffect` fetch code from VaultPage

2. **Backend prep** (for Portfolio)
   - Add `subtype` to `buildTemplateObject()` in MariaDbAdapter
   - Add `base_currency` to currencies GET response

3. **Portfolio aggregation** (Feature 2)
   - New value extraction logic per subtype
   - Currency conversion: all values → GBP (server base), then GBP → display currency via triangulation
   - User-selectable display currency (dropdown on Portfolio page + user preference)
   - Grouping by entry type + subtype + currency
   - Updated summary cards (net worth in display currency, per-category breakdown)
   - Credit card as liability

4. **Crypto template update**
   - Add `current_value` field to Crypto template
   - DB migration for existing entries (field is in the encrypted blob, so actually just update the template `fields` JSON)

5. **Snapshot v2**
   - Richer snapshot format with breakdowns
   - Backward-compatible display of v1 snapshots

6. **UI polish** (follow-up)
   - Per-currency breakdown section
   - Charts/sparklines for history
   - Gain/loss indicators (if purchase_price available)

---

## Open Questions for Discussion

1. **D1–D4:** Reference caching decisions (approach, TTL, admin cache separation)
2. **D5:** Which groupings to show in portfolio
3. **D6:** Crypto handling (add `current_value` field?)
4. **D7:** Credit cards as liabilities
5. **D8–D9:** Backend changes (subtype in API, base_currency exposure)
6. **D10:** Snapshot v2 format
7. **D11:** Charts — now or later?
8. **D12:** User-selectable display currency (preference + dropdown, triangulation via GBP)
9. **Any other breakdowns or calculations** you want to see?
