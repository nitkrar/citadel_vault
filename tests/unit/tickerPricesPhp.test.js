import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const TICKER_PRICES_PATH = resolve(ROOT, 'src', 'core', 'TickerPrices.php');

function runPhp(script, env = {}) {
  return execFileSync('php', ['-r', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  }).trim();
}

function runPhpJson(script, env = {}) {
  return JSON.parse(runPhp(script, env));
}

function phpBootstrap(code) {
  return `
    define('DB_HOST', 'localhost');
    define('DB_PORT', 3306);
    define('DB_NAME', 'citadel_vault_test_db');
    define('DB_USER', 'nitinkum');
    define('DB_PASS', '');
    define('STORAGE_ADAPTER', 'memory');
    require_once '${TICKER_PRICES_PATH}';
    ${code}
  `;
}

function buildPayload(meta) {
  return Buffer.from(JSON.stringify({
    chart: {
      result: [
        {
          meta,
        },
      ],
    },
  })).toString('base64');
}

function parseResponse(meta, ticker = 'TEST') {
  return runPhpJson(
    phpBootstrap(`
      $result = TickerPrices::parseResponse(getenv('TEST_TICKER'), base64_decode(getenv('TEST_PAYLOAD')));
      echo json_encode($result);
    `),
    {
      TEST_TICKER: ticker,
      TEST_PAYLOAD: buildPayload(meta),
    },
  );
}

describe('TickerPrices PHP helpers', () => {
  it('normalize maps aliases and uppercases unknown inputs', () => {
    const result = runPhpJson(phpBootstrap(`
      echo json_encode([
        TickerPrices::normalize(' brk.b '),
        TickerPrices::normalize('BRKB'),
        TickerPrices::normalize('bf.b'),
        TickerPrices::normalize(' bfb '),
        TickerPrices::normalize('fb'),
        TickerPrices::normalize('twtr'),
        TickerPrices::normalize(' hcn '),
        TickerPrices::normalize(' voo '),
      ]);
    `));

    expect(result).toEqual([
      'BRK-B',
      'BRK-B',
      'BF-B',
      'BF-B',
      'META',
      'X',
      'WELL',
      'VOO',
    ]);
  });

  it('parseResponse uses regular price when no post-market price is present', () => {
    expect(parseResponse({
      regularMarketPrice: 100,
      regularMarketTime: 1000,
      currency: 'USD',
      fullExchangeName: 'NasdaqGS',
      longName: 'Test Corp',
    })).toEqual({
      price: 100,
      currency: 'USD',
      exchange: 'NasdaqGS',
      name: 'Test Corp',
      after_hours: false,
    });
  });

  it('parseResponse prefers valid after-hours pricing', () => {
    expect(parseResponse({
      regularMarketPrice: 100,
      postMarketPrice: 102,
      marketState: 'POST',
      regularMarketTime: 1000,
      postMarketTime: 1100,
      currency: 'USD',
      fullExchangeName: 'NasdaqGS',
      longName: 'Test Corp',
    })).toEqual({
      price: 102,
      currency: 'USD',
      exchange: 'NasdaqGS',
      name: 'Test Corp',
      after_hours: true,
    });
  });

  it('parseResponse ignores stale after-hours pricing', () => {
    expect(parseResponse({
      regularMarketPrice: 100,
      postMarketPrice: 102,
      marketState: 'POST',
      regularMarketTime: 1100,
      postMarketTime: 1000,
      currency: 'USD',
      fullExchangeName: 'NasdaqGS',
      longName: 'Test Corp',
    })).toEqual({
      price: 100,
      currency: 'USD',
      exchange: 'NasdaqGS',
      name: 'Test Corp',
      after_hours: false,
    });
  });

  it('parseResponse ignores after-hours pricing during regular trading', () => {
    expect(parseResponse({
      regularMarketPrice: 100,
      postMarketPrice: 102,
      marketState: 'REGULAR',
      regularMarketTime: 1000,
      postMarketTime: 1100,
      currency: 'USD',
      fullExchangeName: 'NasdaqGS',
      longName: 'Test Corp',
    })).toEqual({
      price: 100,
      currency: 'USD',
      exchange: 'NasdaqGS',
      name: 'Test Corp',
      after_hours: false,
    });
  });

  it('parseResponse ignores after-hours pricing with a large delta', () => {
    expect(parseResponse({
      regularMarketPrice: 100,
      postMarketPrice: 150,
      marketState: 'CLOSED',
      regularMarketTime: 1000,
      postMarketTime: 1100,
      currency: 'USD',
      fullExchangeName: 'NasdaqGS',
      longName: 'Test Corp',
    })).toEqual({
      price: 100,
      currency: 'USD',
      exchange: 'NasdaqGS',
      name: 'Test Corp',
      after_hours: false,
    });
  });
});
