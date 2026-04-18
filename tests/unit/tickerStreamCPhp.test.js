import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DB_USER = 'nitinkum';
const DB_NAME = `citadel_stream_c_unit_${process.pid}`;
const tempDir = mkdtempSync(join(tmpdir(), 'citadel-stream-c-'));
const envFile = join(tempDir, '.env.unit');

function runMysql(sql, dbName = null) {
  const args = ['-u', DB_USER];
  if (dbName) args.push(dbName);
  args.push('-e', sql);
  execFileSync('mysql', args, { cwd: ROOT, stdio: 'pipe' });
}

function runPhp(code) {
  return execFileSync('php', ['-r', code], {
    cwd: ROOT,
    env: { ...process.env, CITADEL_ENV_FILE: envFile },
    stdio: 'pipe',
  }).toString().trim();
}

beforeAll(() => {
  writeFileSync(envFile, [
    'DB_HOST=localhost',
    'DB_PORT=3306',
    `DB_NAME=${DB_NAME}`,
    `DB_USER=${DB_USER}`,
    'DB_PASS=',
    'APP_ENV=development',
    'JWT_SECRET=test-jwt-secret',
    'AUDIT_HMAC_SECRET=test-audit-secret',
    'SHARING_TOKEN_SECRET=test-sharing-secret',
  ].join('\n'));

  runMysql(`DROP DATABASE IF EXISTS \`${DB_NAME}\`; CREATE DATABASE \`${DB_NAME}\`;`);
  runMysql(`
    CREATE TABLE ticker_prices (
      ticker VARCHAR(20) NOT NULL,
      exchange VARCHAR(50) DEFAULT NULL,
      price DECIMAL(15,8) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      name VARCHAR(255) DEFAULT NULL,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ticker)
    );
    CREATE TABLE ticker_price_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ticker VARCHAR(20) NOT NULL,
      exchange VARCHAR(50) DEFAULT NULL,
      price DECIMAL(15,8) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      recorded_at DATE NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_ticker_date (ticker, recorded_at)
    );
  `, DB_NAME);
});

afterAll(() => {
  try {
    runMysql(`DROP DATABASE IF EXISTS \`${DB_NAME}\`;`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('Stream C PHP unit coverage', () => {
  it('guards extra ticker columns before migration and uses them after migration', () => {
    const before = JSON.parse(runPhp(`
      require ${JSON.stringify(resolve(ROOT, 'config', 'config.php'))};
      require ${JSON.stringify(resolve(ROOT, 'src', 'core', 'MariaDbAdapter.php'))};
      $adapter = new MariaDbAdapter();
      $probe = (function () { return $this->hasPriceExtraColumns(); })->call($adapter);
      $adapter->upsertPrice('AAPL', 'NASDAQ', 200.0, 'USD', 'Apple', 190.0, true);
      $cached = $adapter->getCachedPrices(['AAPL'], 86400);
      echo json_encode([
          'probe' => $probe,
          'cached' => $cached[0] ?? null,
      ]);
    `));

    expect(before.probe).toBe(false);
    expect(before.cached.previous_close).toBeNull();
    expect(before.cached.after_hours).toBe(0);

    runMysql(`
      ALTER TABLE ticker_prices
        ADD COLUMN IF NOT EXISTS previous_close DECIMAL(15,8) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS after_hours TINYINT(1) DEFAULT 0;
    `, DB_NAME);

    const after = JSON.parse(runPhp(`
      require ${JSON.stringify(resolve(ROOT, 'config', 'config.php'))};
      require ${JSON.stringify(resolve(ROOT, 'src', 'core', 'MariaDbAdapter.php'))};
      $adapter = new MariaDbAdapter();
      $probe = (function () { return $this->hasPriceExtraColumns(); })->call($adapter);
      $adapter->upsertPrice('AAPL', 'NASDAQ', 201.0, 'USD', 'Apple', 191.5, true);
      $cached = $adapter->getCachedPrices(['AAPL'], 86400);
      echo json_encode([
          'probe' => $probe,
          'cached' => $cached[0] ?? null,
      ]);
    `));

    expect(after.probe).toBe(true);
    expect(Number(after.cached.previous_close)).toBeCloseTo(191.5, 4);
    expect(after.cached.after_hours).toBe(1);
  });

  it('finds historical prices by exact match, tolerance, null miss, and closest row', () => {
    runMysql('DELETE FROM ticker_price_history;', DB_NAME);
    runMysql(`
      INSERT INTO ticker_price_history (ticker, exchange, price, currency, recorded_at) VALUES
        ('EXACT7', 'NASDAQ', 101.00, 'USD', DATE_SUB(CURDATE(), INTERVAL 7 DAY)),
        ('WITHIN7', 'NASDAQ', 102.00, 'USD', DATE_SUB(CURDATE(), INTERVAL 9 DAY)),
        ('NONE7', 'NASDAQ', 103.00, 'USD', DATE_SUB(CURDATE(), INTERVAL 20 DAY)),
        ('CLOSE7', 'NASDAQ', 104.00, 'USD', DATE_SUB(CURDATE(), INTERVAL 8 DAY)),
        ('CLOSE7', 'NASDAQ', 105.00, 'USD', DATE_SUB(CURDATE(), INTERVAL 6 DAY));
    `, DB_NAME);

    const result = JSON.parse(runPhp(`
      require ${JSON.stringify(resolve(ROOT, 'config', 'config.php'))};
      require ${JSON.stringify(resolve(ROOT, 'src', 'core', 'MariaDbAdapter.php'))};
      $adapter = new MariaDbAdapter();
      echo json_encode([
          'exact' => $adapter->getPriceHistoryNear('EXACT7', 7, 0),
          'within' => $adapter->getPriceHistoryNear('WITHIN7', 7, 3),
          'none' => $adapter->getPriceHistoryNear('NONE7', 7, 3),
          'closest' => $adapter->getPriceHistoryNear('CLOSE7', 7, 3),
      ]);
    `));

    expect(Number(result.exact.price)).toBeCloseTo(101, 4);
    expect(Number(result.within.price)).toBeCloseTo(102, 4);
    expect(result.none).toBeNull();
    expect(Number(result.closest.price)).toBeCloseTo(105, 4);
  });

  it('captures previous_close in TickerPrices::parseResponse', () => {
    const parsed = JSON.parse(runPhp(`
      require ${JSON.stringify(resolve(ROOT, 'src', 'core', 'TickerPrices.php'))};
      $body = json_encode([
          'chart' => [
              'result' => [[
                  'meta' => [
                      'regularMarketPrice' => 178.52,
                      'chartPreviousClose' => 176.20,
                      'currency' => 'USD',
                      'fullExchangeName' => 'NasdaqGS',
                      'longName' => 'Apple Inc.',
                  ],
              ]],
          ],
      ]);
      echo json_encode(TickerPrices::parseResponse('AAPL', $body));
    `));

    expect(parsed.price).toBeCloseTo(178.52, 4);
    expect(parsed.previous_close).toBeCloseTo(176.2, 4);
    expect(parsed.after_hours).toBe(false);
  });
});
