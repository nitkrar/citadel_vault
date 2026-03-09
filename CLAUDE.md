# Citadel — Project Guidelines

## Search Preferences
- ALWAYS prefer local file searches (Glob, Grep, Read) first before using remote or meta codesearch agents
- This is NOT a Meta monorepo project — all code is local
- Only use remote/web searches for external documentation or APIs

## Core Rules
- NEVER break core functionality (auth, encryption, vault key unlock) during changes
- APIs must always be backward-compatible — new fields/columns are optional, queries must not fail if a migration hasn't been run
- When making breaking changes, ASK the user first
- NEVER hardcode values that should be configurable via .env
- ALWAYS think about the deployment target (HelioHost shared hosting, document root = public/) before making structural changes
- When debugging, CHECK CSS/config/structure FIRST before trying random fixes

## Build & Deploy
- Run `npm run build` before git push — builds React to `dist/` (NOT `public/`)
- `dist/` contains compiled frontend (committed to git)
- `index.php` serves `dist/index.html` as SPA fallback
- `.htaccess` rewrites `/assets/*` → `dist/assets/*`
- `router.php` is for local dev only (`php -S localhost:8081 router.php`)
- `.htaccess` is for production (Apache on HelioHost)
- Hosting server has NO Node.js — only compiled assets + PHP are deployed
- Deploy target: git pulls repo into `citadelvault.heliohost.us/public/` (document root)

## Project Structure
- `config/` — PHP config + .env (`.env` is gitignored)
- `src/api/` — PHP REST endpoints
- `src/core/` — PHP classes (Auth, Encryption, Mailer, Response, WebAuthn)
- `src/client/` — React source (compiles to dist/)
- `database/` — MySQL schema (01-schema.sql, 02-seed.sql, 03-testdata.sql)
- `dist/` — Built frontend output (committed, Vite builds here)
- `static/` — Static assets (CSS, favicon) copied to dist/ by Vite
- `index.php` — SPA front controller (serves dist/index.html)
- `index.html` — Vite dev entry point (NOT served in production)
- `.htaccess` — Apache routing + security rules for production

## Database
- Local: localhost:3306, citadel_vault_db, citadel_db_admin
- Prod: HelioHost prefixed names (spmcoolnits_citadel_vault_db)
- Schema files in `database/` — run 01-schema.sql then 02-seed.sql for fresh setup

## Configuration
- ALL security thresholds, policies, and secrets are in `.env` (never hardcode in PHP/JS)
- `.env` parser supports inline comments (`KEY=value # comment`)
- Production safety: app refuses to start if critical secrets missing when APP_ENV=production
- Vault key policy, lockout tiers, rate limits, SMTP — all env-driven

## Testing
- `php -S localhost:8081 router.php` — start backend
- `npm run dev` — start frontend dev server (Vite, port 5173)
- Test API: `curl http://localhost:8081/src/api/auth.php?action=registration-status`

## Admin Setup
- Seed script (02-seed.sql) creates ghost user only — NO hardcoded admin
- Generate hash locally: `php -r "echo password_hash('YourPassword', PASSWORD_BCRYPT, ['cost' => 12]);"`
- INSERT via phpMyAdmin: `INSERT INTO users (username, email, password_hash, role, is_active, email_verified) VALUES ('admin', 'admin@example.com', '<hash>', 'admin', 1, 1);`
- Vault key is set up in-browser after first login (client-side crypto, no SQL)

## Security Audit
- Report: `SECURITY_AUDIT.md` at project root
- REMIND THE USER at the start of next session to review findings
- Key resolved items: vault key policy, rate limiting, progressive lockout, fail-closed defaults, CSP headers, JWT base64url
- Pending: JWT in localStorage, no JWT revocation, RSA-2048, console.error in prod

## Pending Decisions & Follow-ups
> PROMPT USER once per session: "There are pending items in CLAUDE.md — want to review or address any?"

- **Dead code in auth.php (lines ~715-730)**: Server-side data session token logic (`DATA_SESSION_EXPIRY_TIMED`, `DATA_SESSION_EXPIRY_LOGIN`, `vault_session_preference` column) — references constants not defined in config.php and a column not in schema. Should be removed.
- **Session vs Manual auto-lock**: Currently functionally identical when `persist_in_tab` is set (both rely on sessionStorage which clears on tab close). Consider whether Manual should use localStorage for true cross-tab persistence, or remove Manual as an option.
- **Keyboard shortcuts on mobile**: Currently hidden. User mentioned possibly adding gesture-based equivalents (e.g., long-press to lock) — deferred.
- **SMTP setup for prod**: SMTP is disabled. Needed for: invite emails, lockout notifications, password reset, email verification. Decide on email provider for HelioHost.
- **Security audit pending items**: JWT in localStorage (XSS risk), no JWT revocation mechanism, RSA-2048 (consider upgrading to 4096), console.error in production code.
