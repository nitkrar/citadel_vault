# Live Bank Account Data — Feasibility Research

**Date:** 2026-03-14
**Status:** Research complete, decision deferred
**Goal:** Understand what's required to pull live bank balance/transaction data into Citadel

---

## Summary

Pulling live bank data is feasible through third-party aggregator APIs. Direct Open Banking registration is cost-prohibitive for a personal project (£10K+ first year). Aggregators like Plaid and GoCardless handle regulatory compliance and bank integrations for a fraction of the cost — or free for personal use.

Stock broker coverage varies significantly by country: US has good coverage (Plaid), UK and India have minimal broker API access.

---

## Regulatory Landscape

### UK — Open Banking (PSD2)
- **Mandate:** CMA required the 9 largest UK banks to expose APIs (2018). Now 100+ institutions
- **Access requires:** AISP registration with FCA, or use a registered aggregator
- **Re-consent:** Every 90 days (PSD2 Strong Customer Authentication)
- **Broker coverage:** None — Open Banking only covers regulated banks/building societies

### US — No mandate (yet)
- **CFPB Section 1033:** Rule issued late 2024, phased implementation 2026-2030
- **In practice:** Plaid dominates via API + screen-scraping hybrid
- **Re-consent:** Indefinite — connections stay active until user/bank revokes
- **Broker coverage:** Good — Plaid connects to Fidelity, Schwab, Vanguard, Robinhood, etc.

### India — Account Aggregator (AA)
- **Mandate:** RBI Account Aggregator framework (2021)
- **Providers:** Finvu, OneMoney, Saafe (licensed AAs)
- **Coverage:** Major banks (SBI, HDFC, ICICI, Axis, Kotak). Growing
- **Broker coverage:** Early stage (Zerodha, Groww starting to integrate)
- **Cost:** ~₹5-15 per data pull. No generous free tiers
- **Consent:** Per-request consent artefact. More privacy-focused

---

## Provider Comparison

| Provider | Free Tier | Pricing Model | UK Banks | US Banks | US Brokers | India |
|----------|-----------|---------------|----------|----------|------------|-------|
| **Plaid** | 100 connections | Per connection/month (~$0.30-$1.50) | Yes (PSD2 re-auth) | Yes (persistent) | Yes | No |
| **GoCardless** (ex-Nordigen) | 1,000 API calls/month | Per call after free tier | Yes | Limited | No | No |
| **TrueLayer** | No free tier | Per connection/month (~£0.50-£1.00) | Yes (UK-first) | No | No | No |
| **Yapily** | No free tier | Custom (~£0.20-£0.50/connection) | Yes | Limited | No | No |
| **Finvu/OneMoney** | Minimal | Per consent (~₹5-15) | No | No | No | Yes |

### Recommendation: Plaid

**Plaid is the strongest single-provider choice** for Citadel because:
- Covers both US and UK banks in one integration
- US broker connections (Schwab, Fidelity, Vanguard, etc.) — unique advantage
- 100 free connections is more than enough for personal use
- "Connection" = one linked account, persists indefinitely in US (90 days in UK)
- API calls within a connection are unlimited — no per-call charges
- Well-documented API, React SDK for consent flow

---

## Key Terms

- **Connection:** A linked bank/broker account. Connect once, stays active. Plaid charges per active connection per month. Free tier = 100 connections
- **AISP:** Account Information Service Provider — the regulated role for read-only bank access
- **PSD2:** EU Payment Services Directive — requires 90-day re-authentication for bank connections in UK/EU
- **CMA9:** The 9 largest UK banks required to support Open Banking APIs
- **AA:** India's Account Aggregator framework — RBI-regulated intermediaries for financial data sharing

---

## Integration Architecture (if built)

### User Flow (manual pull model)
1. User clicks "Connect Bank" on an account entry in Citadel
2. Redirect to Plaid Link (OAuth consent screen) → user logs into their bank
3. Plaid returns an `access_token` → encrypted and stored in the vault entry blob
4. User clicks "Refresh Balance" → Citadel backend calls Plaid `/accounts/balance/get` → updates encrypted entry
5. Token expires (UK: 90 days) → next refresh prompts re-auth via Plaid Link

### Technical Requirements
- **Plaid API keys:** Server-side only (secret key must not reach client)
- **Backend endpoint:** `POST /plaid.php?action=exchange-token` and `GET /plaid.php?action=balance`
- **Token storage:** Plaid `access_token` stored encrypted inside the vault entry JSON blob (same client-side encryption as all other fields)
- **No Node.js needed:** Plaid has a REST API — PHP `file_get_contents` or cURL works fine
- **Client integration:** Plaid Link is a JS SDK loaded via `<script>` tag — handles bank auth UI

### What Citadel Already Has
- Encrypted vault entries with template-based fields ✓
- Bank account templates (UK, US, India variants) ✓
- Currency conversion infrastructure ✓
- Portfolio aggregation reading from decrypted entry data ✓

### What Would Need to Be Built
- Plaid API integration (PHP backend)
- "Connect Bank" button on account entries
- "Refresh Balance" action
- Plaid Link SDK integration in frontend
- Token expiry tracking + re-auth prompt
- New template field type for "connected account" status indicator

---

## Cost Analysis (Personal Use)

| Scenario | Connections | Monthly Cost |
|----------|-------------|-------------|
| 3 UK bank accounts | 3 | Free (within 100) |
| 3 UK + 2 US banks + 1 Schwab broker | 6 | Free (within 100) |
| All above + spouse's accounts | ~12 | Free (within 100) |
| Scaling beyond personal (multi-user) | 100+ | ~$0.30-$1.50 per connection/month |

---

## Decision: Deferred

**Reason:** Good to understand the landscape. The bank-only scope (no UK brokers) limits the value proposition. Stock price APIs (for auto-updating holdings values) may deliver more portfolio accuracy impact with less complexity. Revisit when:
- Portfolio page is fully tested with manual data
- There's a clear pain point from stale balance data
- Or when considering auto-fetching stock/crypto prices alongside bank data

---

## Related Ideas (not explored yet)

- **Auto-fetch stock prices:** Free APIs (Yahoo Finance, Alpha Vantage) could auto-update `price_per_share` on stock entries. Lower complexity, higher daily impact
- **Auto-fetch crypto prices:** CoinGecko free API for crypto price updates
- **Hybrid approach:** Manual bank balances + auto stock/crypto prices = best ROI on dev effort
