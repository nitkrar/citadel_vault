# Full-Stack Architecture — Best Practices Skill

> Invoke this skill when starting a new full-stack project or making architectural decisions.
> Derived from production-hardened patterns in a real vault application.

---

## 1. API Design

### Consistent Endpoint Structure
Every API endpoint MUST follow the same skeleton in the same order:

1. Load shared utilities (response formatting, config)
2. Load auth/middleware
3. Set CORS / handle preflight
4. Run authentication gate
5. Run authorization gate (role checks, feature gates)
6. Extract user identity from auth context
7. Parse request method + route params
8. Get database/service connection
9. Dispatch to method handler (GET/POST/PUT/DELETE)
10. Return fallback error for unmatched methods

This guarantees that auth, CORS, and access control run **before** any business logic — no endpoint can accidentally skip them.

### Standardized Response Envelope
Every response uses the same shape:

```
Success: { "success": true, "data": <payload> }
Error:   { "success": false, "error": "<message>" }
```

Rules:
- NEVER mix success and error fields in the same response
- ALWAYS terminate execution after sending a response (no accidental code execution after)
- Error messages in production are generic; detailed messages only in development mode
- HTTP status codes must be semantically correct (400 for bad input, 401 for unauthenticated, 403 for unauthorized, 404 for missing, 500 for server errors)

### Ownership Enforcement in SQL
Every data mutation query MUST include the user's identity in the WHERE clause:

```
-- CORRECT: ownership enforced at the query level
UPDATE items SET name = ? WHERE id = ? AND user_id = ?

-- WRONG: trusting application logic alone
UPDATE items SET name = ? WHERE id = ?
```

Never trust the client to be the owner. Never rely solely on application-level checks — enforce at the SQL layer. This makes cross-user data access structurally impossible.

### Dynamic Update Builders for Partial PUT
PUT/PATCH operations should only update fields present in the request body:

- Iterate over allowed fields
- Build SET clauses dynamically for fields that exist in the request
- Separate encrypted fields from plain fields if applicable
- Reject requests with zero valid fields

This allows partial updates without requiring all fields and prevents accidentally nulling fields the client didn't intend to change.

### Batch Operations with Per-Item Error Handling
When processing bulk operations:

- Wrap the batch in a transaction
- Process each item individually within the transaction
- Record success/failure per item (with index and error message)
- Return a summary: `{ succeeded: N, failed: N, results: [...] }`
- Commit if at least some items succeeded (or roll back entirely — choose based on your use case and document the behavior)

### Soft Delete vs Hard Delete
- Use **soft delete** (`is_active = 0` or `deleted_at` timestamp) for entities with foreign key references or audit requirements
- Use **hard delete** only for entities with no FK dependents and no audit trail needs
- Use `ON DELETE CASCADE` at the schema level for user-deletion scenarios
- Always filter soft-deleted records in read queries (`WHERE is_active = 1`)

---

## 2. Database

### Secure Connection Defaults
Database connections MUST be configured with:

- **Exception-mode error handling** — never silent failures
- **Associative fetch mode** — avoid numeric-indexed results
- **Real prepared statements** (disable emulated prepares) — this is the single most important SQL injection defense
- **UTC timezone** set at connection time — consistent timestamps across environments

### Migration Resilience
Code MUST gracefully handle missing columns or tables from un-run migrations:

- Wrap queries that reference new columns in try-catch
- On failure, fall back to a query without the new columns
- Default missing values to safe defaults (false, null, empty)
- Add comments explaining WHY the fallback exists

This ensures the application works during partial deployments and avoids hard coupling between code deploys and database migrations.

### Schema Design Principles
- **Encrypted/variable-length data** uses TEXT, not VARCHAR — ciphertext length is unpredictable
- **Every foreign key column has an index** — prevents full table scans on JOINs and cascade deletes
- **Named constraints** (`fk_items_user`, `uk_emails_unique`) — not auto-generated names
- **Composite unique keys** where business logic demands it (e.g., `UNIQUE(user_id, snapshot_date)`)
- **UTF-8 with full Unicode support** (`utf8mb4` in MySQL, `UTF8` in PostgreSQL)
- **Transaction-capable engine** (InnoDB, not MyISAM)
- **Deferred foreign keys** when tables have circular references — use ALTER TABLE after creation

### Seed Data Patterns
- **Ghost/sentinel records** (`id=0` system user) for cases where a foreign key must reference *something* even when the original entity is gone
- **Admin accounts seeded with forced credential change** — never let default credentials persist
- **Reference data** (currencies, countries, categories) seeded from schema files, not application code
- **Schema-driven dynamic forms** — store JSON field definitions in the database so the frontend can render forms without code changes

---

## 3. Configuration Management

### Environment-Driven Configuration
ALL thresholds, secrets, policies, and feature flags MUST live in environment configuration (`.env`, env vars, or config service):

- Security thresholds (lockout attempts, rate limit windows, token expiry)
- Feature toggles (registration mode, email enabled, maintenance mode)
- Service credentials (database, SMTP, API keys)
- Crypto parameters (bcrypt cost, PBKDF2 iterations, key sizes)

NEVER hardcode values that could change between environments.

### Fail-Closed Production Validation
On application startup in production:

1. Check that ALL critical secrets are set and non-empty
2. Check that dangerous development defaults are NOT active (wildcard CORS, debug mode, weak crypto)
3. If ANY critical check fails: **halt the application with a clear error** — do NOT start in a degraded state
4. In development: log warnings but allow startup

This prevents accidental deployment with missing or default secrets.

### Zero-Dependency Config Parsing
When targeting constrained environments (shared hosting, containers without package managers):

- Write a minimal `.env` parser that handles: comments, quoted values, inline comments, empty lines
- Don't override existing environment variables (respect the host's env)
- Set values in both the process environment AND language-specific globals

### Comprehensive .env.example
Every config option MUST be documented in `.env.example` with:

- Descriptive comment explaining purpose
- Generation command for secrets (`openssl rand -hex 32`)
- Valid options for enums
- Warnings about breaking changes
- Default values and whether they're safe for production

---

## 4. Frontend Architecture

### Context-Based State Management
Separate application state into focused contexts by domain:

- **Auth context**: user state, tokens, login/logout, role checks, forced-action flags
- **Feature contexts** (e.g., encryption/vault context): feature-specific state, lock/unlock, timers

Rules:
- Re-validate tokens on mount (call a `/me` or `/session` endpoint)
- Never trust cached roles — the backend should re-check on every request
- Use refs (`useRef`) to avoid stale closures in timers and callbacks
- Clear ALL client state on logout (localStorage, sessionStorage, context state)

### Protected Route Pattern
Implement a composable route guard:

```
ProtectedRoute({ children, adminOnly })
  - If loading → show spinner
  - If not authenticated → redirect to login/home
  - If adminOnly and not admin → redirect to dashboard
  - Otherwise → render children
```

- Define public paths as a constant array
- Don't render authenticated-only UI (modals, sidebars) on public pages
- Priority-order forced-action modals (password change blocks everything else)

### HTTP Client Interceptors
Configure a global HTTP client with:

**Request interceptor:**
- Attach auth token (e.g., `Authorization: Bearer`)
- Attach any session tokens (e.g., encryption session)

**Response interceptor:**
- On 401: clear all stored tokens, redirect to login
- Extract error messages from response body

This eliminates per-component auth header management and ensures consistent session expiry handling.

### Reusable CRUD Hook
Most data pages repeat the same 6+ state declarations. Extract into a single hook:

- `showModal`, `editItem`, `formError`, `saving`, `form`, `detailItem`
- Methods: `openAdd()`, `openEdit(item)`, `closeModal()`, `saveEntity()`, `deleteEntity()`
- Integrate draft persistence (auto-save form state with debounce)
- On unmount: flush pending drafts to prevent data loss
- On logout: clear all draft keys

### Draft Persistence
Auto-save in-progress form data to survive accidental navigation:

- Save to `localStorage` or `sessionStorage` with a namespaced key prefix
- Debounce saves (1 second is a good default)
- Flush on component unmount
- Prompt before discarding dirty data (`confirmClear()`)
- **Exclude sensitive fields** (passwords, keys, tokens) from persistence
- Clean up all drafts on logout

### Module-Level Reference Data Cache
For data that rarely changes (currencies, countries, categories):

- Cache at module level (outside React lifecycle) so it survives SPA navigation
- Load in parallel (`Promise.all`) with graceful per-request error handling
- Only refetch when explicitly invalidated
- Expose via a hook that returns `{ data, loading, error }`

### Strict Truthiness and Type Utilities
Don't rely on JavaScript's implicit coercion. Create explicit utility functions:

- `isTruthy(val)` — only `true`, `1`, `"true"`, `"1"`, `"yes"` return true
- `dbBool(val)` — explicit alias for database 0/1 boolean handling
- `apiData(response)` — safely navigate `response.data.data` with fallback
- Null-safe formatting utilities for currency, dates, numbers

---

## 5. Error Handling

### Global Exception Handler
Register a global error handler that activates automatically when utilities are loaded:

- **Production**: return generic error message, log details server-side
- **Development**: return full error details (message, stack, context)
- Auto-register on module load — no per-endpoint setup required
- Always return the standard response envelope format

### Non-Fatal Degradation
Optional features (email, analytics, rate history, audit logging) MUST NOT crash core functionality:

- Wrap optional feature calls in try-catch
- Log failures but continue execution
- Comment WHY each catch block exists
- Pattern: `try { optionalFeature() } catch { /* table may not exist yet — skip */ }`

This ensures the application is resilient during partial deployments, missing services, or un-run migrations.

### Frontend Error Extraction Chain
Handle all error shapes with a single chain:

```javascript
const message = error?.response?.data?.error   // API error with body
  || error?.response?.data?.message            // Alternative API format
  || error?.message                            // Network/JS error
  || 'An unexpected error occurred.';          // Ultimate fallback
```

This handles: API errors with response bodies, network errors, generic JS errors, and unknown shapes.

---

## 6. Build and Deployment

### Manual Chunk Splitting
Configure your bundler to split large dependencies into named chunks:

- Framework vendor chunk (react, vue, angular + router)
- Charting library chunk
- Icon library chunk
- HTTP client chunk
- Heavy utility chunks (xlsx, pdf, etc.)

Benefits: better cache hit rates (vendor chunk rarely changes), smaller initial bundle, parallel loading.

### Two-Mode Serving Architecture
Support both development and production serving:

**Development:**
- Frontend dev server with hot reload (Vite, webpack-dev-server)
- Backend dev server (PHP built-in, nodemon, etc.)
- Dev server proxies API requests to backend (maintains path parity with production)
- Path alias (`@` → `src/client`) for clean imports

**Production:**
- Single entry point (index.php, server.js) serves the SPA
- Web server (Apache, nginx) handles routing, rewrites, and static assets
- Hashed filenames get immutable cache headers (`max-age=31536000, immutable`)
- Non-hashed files get `no-cache, must-revalidate`

### Constrained-Environment Deployment
When deploying to environments without build tools (shared hosting, serverless):

- Commit built artifacts to the repository
- Build locally before push — CI/CD is a luxury, not a requirement
- Document the build step prominently
- Ensure the SPA fallback works without server-side rendering

### Dev/Prod Parity in Headers
Security headers (CSP, X-Frame-Options, etc.) should be set in BOTH:

- Production web server config (`.htaccess`, nginx.conf)
- Development server/router

This catches CSP violations during development, not after deployment.

---

## 7. Environment Awareness

### Environment-Conditional Behavior
The application should behave differently based on environment:

| Behavior | Development | Production |
|----------|-------------|------------|
| Error detail | Full stack traces | Generic messages |
| Missing config | Warn and continue | Halt application |
| CORS | Allow wildcards | Strict allowlist |
| Error reporting | All errors displayed | Errors hidden, logged |
| Cookie Secure flag | Off (HTTP) | On (HTTPS) |
| Debug tooling | Enabled | Disabled |

### Graceful Service Degradation
External services (email, exchange rates, analytics) should degrade gracefully:

- Check if the service is configured before attempting to use it
- Return structured results from service calls (not exceptions)
- Wrap service calls at the call site with `if (serviceEnabled)` checks
- Never let a non-critical service failure cascade to core functionality

Example: login must never fail because exchange rate refresh failed. Wrap optional post-login tasks in silent try-catch.

### Cookie/Session Security Adapts to Protocol
Security flags should adapt to the runtime environment automatically:

- `Secure` flag: set when HTTPS is detected, skip for local HTTP
- `SameSite`: always `Strict` for sensitive cookies
- `HttpOnly`: always `true` for server-managed tokens
- Session expiry: configurable via environment (shorter in production, longer in development)

---

## Summary Checklist

Before shipping any full-stack feature, verify:

- [ ] Every API endpoint follows the standard skeleton (auth → authz → business logic → response)
- [ ] All responses use the standard envelope format
- [ ] All data queries include ownership in WHERE clause
- [ ] Database connection uses real prepared statements
- [ ] New columns/tables have migration-resilient fallbacks
- [ ] All secrets and thresholds are env-configurable
- [ ] Production startup validates critical secrets (fail-closed)
- [ ] Frontend auth state is re-validated on mount
- [ ] HTTP client has global auth and error interceptors
- [ ] Optional features degrade gracefully without crashing core paths
- [ ] Build output has proper cache headers (immutable for hashed, no-cache for others)
- [ ] Security headers are present in both dev and production servers
