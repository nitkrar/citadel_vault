# Cross-Device Sync — Design Document

**Date:** 2026-03-11
**Status:** Approved via brainstorming session

---

## Problem

User edits an entry on mobile PWA, desktop tab still shows stale data. No mechanism exists to detect or notify about changes made on another device.

## Solution

Lightweight in-app polling with a check endpoint. No WebSockets, no service worker polling, no new schema.

---

## Backend: `GET /sync.php?since=<ISO8601>`

### Auth
Requires JWT (`Auth::requireAuth()`).

### Query
Single `UNION ALL` query against existing `updated_at` columns:

```sql
SELECT 'vault_entries' AS category, MAX(updated_at) AS last_change
  FROM vault_entries WHERE user_id = ?
UNION ALL
SELECT 'currencies', MAX(last_updated) FROM currencies
UNION ALL
SELECT 'countries', MAX(updated_at) FROM countries
UNION ALL
SELECT 'templates', MAX(updated_at)
  FROM entry_templates WHERE owner_id IS NULL OR owner_id = ?
```

Server compares each category's `last_change` against the `since` parameter.

### Response (no changes)
```json
{
  "changes": false,
  "server_time": "2026-03-11T10:06:00Z",
  "poll_interval": 300
}
```

### Response (changes detected)
```json
{
  "changes": true,
  "categories": ["vault_entries", "currencies"],
  "server_time": "2026-03-11T10:06:00Z",
  "poll_interval": 300
}
```

- `server_time` — client uses this as `since` on the next poll (avoids clock drift)
- `poll_interval` — seconds, from `.env` (`SYNC_POLL_INTERVAL=900`), admin-configurable
- Categories array is extensible — adding a new category is one entry in a PHP config array

### .env
```
SYNC_POLL_INTERVAL=900    # seconds, default 5 minutes
```

### No schema changes
All tables already have `updated_at` / `last_updated` with `ON UPDATE CURRENT_TIMESTAMP`. No new tables, columns, or migrations.

---

## Frontend: SyncProvider Context

### Location
New context: `src/client/contexts/SyncContext.jsx`
Wraps app inside `AuthProvider` + `EncryptionProvider` (needs `isUnlocked`).

### Polling rules

| Condition | Behavior |
|-----------|----------|
| Logged in + vault unlocked + online | Poll every `poll_interval` seconds |
| Reference data changed | Auto-pull silently (re-fetch currencies/countries/templates) |
| Vault entries changed | Show toast with 10s auto-dismiss |
| Network failure | Skip silently, retry next interval |
| Vault locked | Don't poll |
| Auth expired (401) | Stop polling |
| Auth restored + vault unlocked | Polling resumes (useEffect re-fires on `isUnlocked`) |

### Data flow

1. `useEffect` depends on `[isUnlocked]`
2. If `!isUnlocked`, return (cleanup clears interval)
3. First call: `GET /sync.php?since=<now>` — establishes baseline `server_time`
4. `setInterval` at `poll_interval * 1000` ms
5. Each tick: `GET /sync.php?since=<last_server_time>`
6. If `changes: true`:
   - Reference categories (`currencies`, `countries`, `templates`): auto-fetch via `invalidateReferenceCache()` + re-fetch
   - `vault_entries`: set `hasVaultUpdates = true` → show toast
7. Update `last_server_time` from response

### Toast behavior
- Message: "Vault data updated on another device. **Refresh**"
- Auto-dismiss after 5 seconds
- Re-appears on next poll if still stale (changes still detected)
- "Refresh" click triggers full reload of vault entries from `/vault.php`
- After refresh, resets `hasVaultUpdates` and updates `since` timestamp

### Refresh action (v1 — full reload)
- Re-fetches all entries from `/vault.php`
- Clears and repopulates IndexedDB via `entryStore.putAll()`
- Pages re-render from fresh data
- Future: delta sync (fetch only changed entries) — tracked in backlog

---

## What this does NOT include

- **Service worker polling** — unnecessary for single-tab assumption
- **Multi-tab coordination** — out of scope, one active tab expected
- **Delta sync** — v1 does full reload; delta tracked as future backlog item
- **User-configurable interval** — backlogged; server default only for v1
- **Changelog table** — not needed; `MAX(updated_at)` is efficient enough for the data volumes

---

## Files to create/modify

| File | Change |
|------|--------|
| `src/api/sync.php` | **New** — check endpoint |
| `config/config.php` | Add `SYNC_POLL_INTERVAL` constant |
| `src/client/contexts/SyncContext.jsx` | **New** — polling logic + state |
| `src/client/components/SyncToast.jsx` | **New** — auto-dismiss toast |
| `src/client/components/Layout.jsx` | Wrap with `SyncProvider`, render `SyncToast` |
| `src/client/hooks/useReferenceData.js` | Use `invalidateReferenceCache()` on sync (already exists, currently dead code) |

---

## Decisions made

| # | Decision | Choice |
|---|----------|--------|
| 1 | Polling location | In-app `setInterval` (not service worker) |
| 2 | Polling interval | 15 min default, server-controlled via `.env` |
| 3 | Change detection | `UNION ALL MAX(updated_at)` on existing columns, no new schema |
| 4 | Reference data changes | Auto-pull silently |
| 5 | Vault entry changes | Toast notification, user decides to refresh |
| 6 | Toast behavior | Auto-dismiss 10s, re-appears if still stale |
| 7 | Refresh mechanism | Full reload (v1), delta sync deferred |
| 8 | Vault locked | Don't poll at all |
| 9 | Network failure | Fail silently, retry next interval |
| 10 | Auth expired | Stop polling, resumes when vault re-unlocked |
| 11 | Clock sync | Use `server_time` from response, never client clock |
