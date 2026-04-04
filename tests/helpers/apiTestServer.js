/**
 * API test server management — starts/stops a PHP server on port 8083
 * with .env.test for full isolation from the dev environment.
 *
 * Used as vitest globalSetup for API tests.
 * Rebuilds test DB from schema + seed, seeds admin user,
 * and starts an isolated PHP server with relaxed rate limits.
 */
import { spawn, execSync } from 'child_process';
import { resolve } from 'path';

const PORT = 8083;
const ROOT = resolve(import.meta.dirname, '..', '..');
const ENV_FILE = resolve(ROOT, 'config', '.env.test');
const DB_NAME = 'citadel_vault_test_db';
const DB_USER = 'nitinkum';

let serverProcess = null;

export async function setup() {
  // 0. Kill any stale server on this port
  try {
    execSync(`lsof -ti:${PORT} | xargs kill 2>/dev/null`, { stdio: 'ignore' });
  } catch {}

  // 1. Apply full schema (drops + recreates all tables)
  execSync(`mysql -u ${DB_USER} ${DB_NAME} < "${resolve(ROOT, 'database', '01-schema.sql')}"`, { stdio: 'ignore' });

  // 2. Seed reference data (ghost user, templates, currencies, countries, exchanges, system settings)
  execSync(`mysql -u ${DB_USER} ${DB_NAME} < "${resolve(ROOT, 'database', '02-seed.sql')}"`, { stdio: 'ignore' });

  // 3. Seed admin user via PHP (avoids shell escaping issues with passwords)
  execSync(`php "${resolve(ROOT, 'tests', 'helpers', '_seed_test_data.php')}" "${DB_NAME}" "${DB_USER}"`, { stdio: 'ignore' });

  // 4. Start PHP server with test config
  serverProcess = spawn('php', ['-S', `localhost:${PORT}`, 'router.php'], {
    cwd: ROOT,
    env: { ...process.env, CITADEL_ENV_FILE: ENV_FILE, PHP_CLI_SERVER_WORKERS: '4' },
    stdio: 'ignore',
  });

  // 5. Wait for server to be ready
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`http://localhost:${PORT}/src/api/auth.php?action=registration-status`);
      if (resp.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`API test server failed to start on port ${PORT}`);
}

export async function teardown() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}
