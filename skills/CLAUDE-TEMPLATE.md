# Full-Stack Project — Architecture Guidelines

> Drop this file into any new project as `CLAUDE.md` and customize the placeholders.

---

## Core Rules

- NEVER break core functionality during changes — identify and protect critical paths first
- APIs MUST be backward-compatible — new fields/columns are optional, queries must not fail if a migration hasn't been run
- When making breaking changes, ASK the user first
- NEVER hardcode values that should be configurable via environment variables
- When debugging, CHECK configuration/structure FIRST before trying random fixes
- Avoid over-engineering — only make changes that are directly requested or clearly necessary
- Do not add error handling or validation for scenarios that can't happen
- Prefer editing existing files over creating new ones

## API Design

- Every endpoint follows the same structure: load utils → CORS → auth → authz → extract user → dispatch by method → fallback error
- Standardized response format: `{ success: true, data }` or `{ success: false, error }`
- Terminate execution after sending a response — no accidental post-response code
- ALL data queries include `user_id = ?` (or equivalent ownership) in the WHERE clause — never trust the client
- PUT/PATCH operations only update fields present in the request body (dynamic SET builders)
- Batch operations record per-item success/failure and return a summary
- Use soft delete for entities with FK references; hard delete only for isolated records

## Database

- Connection MUST use: exception error mode, associative fetch, **real prepared statements** (no emulated prepares), UTC timezone
- Queries referencing new columns/tables are wrapped in try-catch with fallback to older schema — migration resilience
- Named constraints and indexes on every foreign key column
- Encrypted data stored as TEXT (not VARCHAR) — ciphertext length is unpredictable
- Seed data includes: system sentinel records, admin with forced credential change, reference data from schema files

## Configuration

- ALL secrets, thresholds, policies, and feature flags live in `.env` (or environment variables)
- On production startup: validate all critical secrets are set; **halt** if any are missing (fail-closed)
- On development startup: warn about missing config but allow startup
- `.env.example` documents every option with: purpose, generation command, valid values, defaults, warnings
- Environment parser does not override existing environment variables

## Frontend Architecture

- Separate state into focused contexts by domain (auth context, feature contexts)
- Re-validate auth on mount by calling a server endpoint — never trust cached tokens
- Protected route component: loading → unauthenticated redirect → authorization check → render
- Global HTTP interceptor: attach auth tokens on request, clear tokens + redirect on 401 response
- Extract reusable CRUD hooks: modal state, form state, save/delete methods, draft persistence
- Auto-save form drafts with debounce; exclude sensitive fields; clean up on logout
- Cache reference data at module level (outside React lifecycle) to survive navigation
- Use explicit truthiness checks — never rely on implicit coercion for booleans from APIs/databases

## Error Handling

- Global exception handler auto-registered on module load — no per-endpoint setup
- Production: generic error messages to client, full details logged server-side
- Development: full error details returned to client
- Optional features (email, analytics, external APIs) wrapped in try-catch — failures never crash core paths
- Frontend error extraction: `error?.response?.data?.error || error?.message || 'An unexpected error occurred.'`

## Build & Deployment

- <!-- CUSTOMIZE: Describe your build command and output directory -->
- Manual chunk splitting for large dependencies (framework, charts, icons, HTTP client)
- Dev server proxies API requests to backend — maintains path parity with production
- Hashed filenames get `immutable` cache headers; non-hashed get `no-cache`
- Security headers (CSP, X-Frame-Options, etc.) set in BOTH dev and production servers
- <!-- CUSTOMIZE: Describe your deployment target and constraints -->

## Environment Awareness

- Error reporting: verbose in dev, silent in production
- Missing config: warnings in dev, hard stop in production
- CORS: permissive in dev, strict allowlist in production
- Cookie Secure flag: adapts to HTTPS detection
- External service failures degrade gracefully — core functionality always works
- Login/auth must never fail due to optional background tasks

## Project Structure

<!-- CUSTOMIZE: Replace with your project's structure -->

```
config/       — Configuration files + .env
src/api/      — Backend API endpoints
src/core/     — Backend shared classes/modules
src/client/   — Frontend source code
database/     — Schema and migrations
dist/         — Built frontend output
static/       — Static assets (CSS, images, favicon)
```

## Testing

<!-- CUSTOMIZE: Replace with your project's test commands -->

```
# Start backend
<your-backend-start-command>

# Start frontend dev server
<your-frontend-start-command>

# Run tests
<your-test-command>
```
