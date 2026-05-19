# Citadel — Test Suite

Citadel is JavaScript-first. The primary test runner is **vitest** (unit + component + API + integration) plus **Playwright** (E2E). A small Python venv lives in `tests/.venv/` as a scratchpad for ad-hoc HTTP probing — no Python tests are checked in.

## Quick reference

| Command                    | What it runs                                              |
|----------------------------|-----------------------------------------------------------|
| `npm run test:unit`        | vitest — `tests/unit/`, `tests/component/`                |
| `npm run test:api`         | vitest — `tests/api-js/` (auto-starts PHP on port 8083)   |
| `npm run test:integration` | vitest — `tests/integration/` (real API + real crypto)    |
| `npm run test:e2e`         | Playwright — `tests/e2e/`                                 |
| `npm run test`             | `test:unit` + `test:api`                                  |
| `npm run test:all`         | `test:unit` + `test:api` + `test:e2e`                     |

Run from the repo root (`citadel/`).

### Baseline pass counts (drifts over time)
- ~33 unit/component test files
- ~22 API test files
- 2 integration test files
- E2E count varies

## Prerequisites

1. **Node.js** + `npm install` (populates `node_modules/`)
2. **PHP 8.x** available as `php`
3. **Playwright browsers** (one-time): `npx playwright install`
4. **MySQL** running locally on `localhost:3306`
5. Two MySQL databases: `citadel_vault_db` (dev) and `citadel_vault_test_db` (tests)
6. Local MySQL user: `nitinkum` with no password (matches `config/.env.test`)

### One-time DB setup

```bash
# Dev database
mysql -u nitinkum -e "CREATE DATABASE IF NOT EXISTS citadel_vault_db;"
mysql -u nitinkum citadel_vault_db < database/01-schema.sql
mysql -u nitinkum citadel_vault_db < database/02-seed.sql

# Test database (schema gets dropped/recreated per test run, but DB must exist)
mysql -u nitinkum -e "CREATE DATABASE IF NOT EXISTS citadel_vault_test_db;"
```

The API test harness (`tests/helpers/apiTestServer.js`) drops the test schema, recreates it from `database/01-schema.sql`, then runs `tests/helpers/_seed_test_data.php` before each `npm run test:api`. No manual reseed needed.

## How `test:api` works

1. `vitest.api.config.js` sets `TEST_API_URL=http://localhost:8083/src/api` and points `globalSetup` at `tests/helpers/apiTestServer.js`.
2. The setup file:
   - Kills anything on port 8083
   - Sets `CITADEL_ENV_FILE` to `config/.env.test` (the PHP config loader reads this — see `config/config.php`)
   - Connects to `citadel_vault_test_db`, drops tables, applies `database/01-schema.sql`
   - Runs `tests/helpers/_seed_test_data.php` (creates test users + account types)
   - Spawns `php -S localhost:8083 router.php`
   - Waits for `/src/api/auth.php?action=registration-status` to respond
3. Tests in `tests/api-js/` use `tests/helpers/apiClient.js` to hit the server.

The local dev backend (`localhost:8081`) is unrelated to the test server (`localhost:8083`) — they don't conflict, but don't confuse them.

## Test users (seeded by `_seed_test_data.php`)

| Username             | Password         | Role  | Notes                              |
|----------------------|------------------|-------|------------------------------------|
| `initial_user`       | `TestAdmin123`   | admin | matches `apiClient.js` TEST_USERS.admin |
| `test_regular_user`  | `TestRegular1`   | user  | `must_reset_password=0`            |

Both have `is_active=1`, `email_verified=1`. Vault keys are set up client-side per test — not seeded.

## Layout

```
tests/
├── unit/                vitest — pure JS units (crypto, stores, hooks, utils)
├── component/           vitest — React components (jsdom + Testing Library)
├── api-js/              vitest — HTTP tests against PHP backend on :8083
├── integration/         vitest — real API + real crypto end-to-end
├── e2e/                 Playwright — full browser flows
├── helpers/
│   ├── apiTestServer.js   global setup: drops schema, seeds, starts PHP
│   ├── apiClient.js       per-test HTTP client + TEST_USERS map
│   ├── _seed_test_data.php seeds users, account_types, system_settings
│   ├── fixtures.js
│   ├── renderWithProviders.jsx
│   └── testServer.js
├── exports/             throwaway artifacts (gitignored)
├── setup.js             vitest global setup (jest-dom matchers)
└── .venv/               Python scratchpad (gitignored)
```

Config files at repo root: `vitest.config.js`, `vitest.api.config.js`, `vitest.integration.config.js`, `playwright.config.js`.

## Critical rules

- **Run `npm run test:unit` after any change to entry-related code** — `validateEntryShape()` and `checkMutationIntegrity()` in `src/client/lib/entryStore.js` enforce data invariants. Per `citadel/CLAUDE.md`: do not weaken these; fix the calling code.
- **Field name is `encrypted_data`** (not `data`) — enforced at runtime.
- **`template_id` is immutable** after entry creation — enforced both client and server side.
- **Playwright on macOS 15**: blocked by MDM (`fork failed: Operation not permitted` or similar). E2E runs in CI; for local E2E work, run on another machine or skip.

## Conventions

- API tests assume backend at `http://localhost:8083`. vitest's `globalSetup` starts/stops it — don't run `php -S` manually unless using the Python scratchpad below.
- E2E auth state is cached at `tests/e2e/.auth/user.json` (gitignored).
- `tests/exports/` is throwaway (gitignored).
- Admin for the **dev** DB (not test DB) is not seeded — create manually:
  ```bash
  php -r "echo password_hash('YourPassword', PASSWORD_BCRYPT, ['cost' => 12]);"
  # then INSERT INTO users (...) via mysql CLI or phpMyAdmin
  ```

## Python scratchpad venv

`tests/.venv/` exists for ad-hoc HTTP probing against a running PHP backend — useful when reproducing a bug interactively. **No Python tests are checked in; this is a local convenience only.**

Recreate on a fresh machine:

```bash
python3 -m venv tests/.venv
tests/.venv/bin/pip install -q -r tests/requirements.txt
tests/.venv/bin/pytest --version    # sanity check
```

`tests/requirements.txt` pins `pytest` and `requests`. `tests/.venv/` is gitignored.

If you don't use it, delete to free ~29 MB — nothing depends on it:

```bash
rm -rf tests/.venv
```
