/**
 * API test server management — starts/stops a PHP server on port 8083
 * with .env.test for full isolation from the dev environment.
 *
 * Used as vitest globalSetup for API tests.
 * Seeds ghost user, reference data, and admin user for test authentication.
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

  // 1. Truncate all tables for a clean slate
  truncateTestDb();

  // 2. Seed reference data (ghost user, templates, currencies, countries, exchanges)
  seedTestDb();

  // 3. Create admin user with known credentials
  seedAdminUser();

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

function truncateTestDb() {
  // Get all table names dynamically to avoid missing any
  const result = execSync(
    `mysql -u ${DB_USER} ${DB_NAME} -N -e "SHOW TABLES"`,
    { encoding: 'utf-8' },
  ).trim();
  const tables = result.split('\n').filter(Boolean);
  if (tables.length === 0) return;

  const sql = 'SET FOREIGN_KEY_CHECKS=0; '
    + tables.map(t => `TRUNCATE TABLE ${t};`).join(' ')
    + ' SET FOREIGN_KEY_CHECKS=1;';
  execSync(`mysql -u ${DB_USER} ${DB_NAME} -e "${sql}"`, { stdio: 'ignore' });
}

function seedTestDb() {
  const seedFile = resolve(ROOT, 'database', '02-seed.sql');
  execSync(`mysql -u ${DB_USER} ${DB_NAME} < "${seedFile}"`, { stdio: 'ignore' });
}

function seedAdminUser() {
  // Generate bcrypt hash for 'Initial#12$' via PHP (avoids shell escaping issues)
  const phpScript = resolve(ROOT, 'tests', 'helpers', '_seed_admin.php');
  execSync(`php "${phpScript}" "${DB_NAME}" "${DB_USER}"`, { stdio: 'ignore' });
}
