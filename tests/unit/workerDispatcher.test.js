/**
 * Worker Dispatcher Tests
 *
 * Tests the routing logic and main-thread fallback path.
 * Worker path is tested via mocks (no real Web Workers in Vitest/Node).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  configure, decryptBatch, encryptBatch, aggregateBatch,
  terminate, isWorkerActive, getConfig,
} from '../../src/client/lib/workerDispatcher.js';

// ── configure ────────────────────────────────────────────────────────

describe('configure', () => {
  beforeEach(() => {
    terminate(); // reset state
  });

  it('sets threshold and enabled from strings', () => {
    configure({ workerEnabled: '1', workerThreshold: '100' });
    expect(getConfig()).toEqual({ enabled: true, threshold: 100 });
  });

  it('disables worker when workerEnabled is "0"', () => {
    configure({ workerEnabled: '0', workerThreshold: '50' });
    expect(getConfig().enabled).toBe(false);
  });

  it('disables worker when workerEnabled is false', () => {
    configure({ workerEnabled: false, workerThreshold: '50' });
    expect(getConfig().enabled).toBe(false);
  });

  it('defaults threshold to 50 for invalid input', () => {
    configure({ workerEnabled: '1', workerThreshold: 'abc' });
    expect(getConfig().threshold).toBe(50);
  });
});

// ── Main thread path (below threshold) ──────────────────────────────

describe('main thread path', () => {
  beforeEach(() => {
    terminate();
    configure({ workerEnabled: '1', workerThreshold: '1000' }); // high threshold = always main thread
  });

  it('decryptBatch returns null for invalid blobs on main thread', async () => {
    // Create a mock CryptoKey-like object — decryptEntry will fail, return null
    const fakeDek = {};
    const results = await decryptBatch(['invalid_blob_1', 'invalid_blob_2'], fakeDek);
    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
  });

  it('does not create worker when below threshold', async () => {
    const fakeDek = {};
    await decryptBatch(['blob'], fakeDek);
    expect(isWorkerActive()).toBe(false);
  });

  it('aggregateBatch runs on main thread below threshold', async () => {
    const currencies = [
      { code: 'GBP', symbol: '£', exchange_rate_to_base: '1.00' },
      { code: 'USD', symbol: '$', exchange_rate_to_base: '0.79' },
    ];
    const entries = [{
      id: 1,
      entry_type: 'asset',
      decrypted: { title: 'Test', value: '100', currency: 'USD' },
      template: {
        name: 'Cash', icon: 'wallet', key: 'asset', subtype: 'cash',
        is_liability: false,
        fields: [{ key: 'value', label: 'Value', type: 'number', portfolio_role: 'value' }],
      },
    }];
    const result = await aggregateBatch(entries, currencies, 'GBP', 'GBP');
    expect(result.summary).toBeDefined();
    expect(result.summary.asset_count).toBe(1);
    expect(isWorkerActive()).toBe(false);
  });
});

// ── Kill switch ─────────────────────────────────────────────────────

describe('kill switch', () => {
  beforeEach(() => {
    terminate();
  });

  it('uses main thread when worker disabled even above threshold', async () => {
    configure({ workerEnabled: '0', workerThreshold: '1' }); // threshold=1 but disabled
    const fakeDek = {};
    await decryptBatch(['blob'], fakeDek);
    expect(isWorkerActive()).toBe(false);
  });
});

// ── Config updates ──────────────────────────────────────────────────

describe('config updates', () => {
  it('respects config changes mid-session', async () => {
    terminate();
    configure({ workerEnabled: '1', workerThreshold: '1000' });
    expect(getConfig().threshold).toBe(1000);

    configure({ workerEnabled: '1', workerThreshold: '25' });
    expect(getConfig().threshold).toBe(25);
  });
});

// ── terminate ───────────────────────────────────────────────────────

describe('terminate', () => {
  it('clears worker state', () => {
    terminate();
    expect(isWorkerActive()).toBe(false);
  });
});
