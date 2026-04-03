/**
 * Test server management — starts/stops a PHP server on port 8082
 * with .env.test for full isolation from the dev environment.
 *
 * Used as vitest globalSetup — server starts once, shared across all test files.
 */
import { spawn } from 'child_process';
import { resolve } from 'path';

const PORT = 8082;
const ROOT = resolve(import.meta.dirname, '..', '..');
const ENV_FILE = resolve(ROOT, 'config', '.env.test');

let serverProcess = null;

export async function setup() {
  // Truncate all tables for a clean slate
  await truncateTestDb();

  serverProcess = spawn('php', ['-S', `localhost:${PORT}`, 'router.php'], {
    cwd: ROOT,
    env: { ...process.env, CITADEL_ENV_FILE: ENV_FILE },
    stdio: 'ignore',
  });

  // Wait for server to be ready
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`http://localhost:${PORT}/src/api/auth.php?action=registration-status`);
      if (resp.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Test server failed to start on port ${PORT}`);
}

export async function teardown() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

async function truncateTestDb() {
  const { execSync } = await import('child_process');
  const tables = [
    'audit_log', 'portfolio_snapshot_entries', 'portfolio_snapshots',
    'shared_items', 'vault_entries', 'user_vault_keys', 'user_preferences',
    'webauthn_challenges', 'user_credentials_webauthn', 'rate_limits',
    'password_history', 'invite_requests', 'plaid_items',
    'ticker_prices', 'ticker_price_history', 'currency_rate_history',
    'system_settings', 'users',
  ];
  const sql = 'SET FOREIGN_KEY_CHECKS=0; '
    + tables.map(t => `TRUNCATE TABLE ${t};`).join(' ')
    + ' SET FOREIGN_KEY_CHECKS=1;';
  execSync(`mysql -u nitinkum citadel_vault_test_db -e "${sql}"`, { stdio: 'ignore' });
}
