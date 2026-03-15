/**
 * Worker Dispatcher Tests
 *
 * Tests the routing logic and main-thread fallback path.
 * Worker path is tested via mocks (no real Web Workers in Vitest/Node).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configure, decryptBatch, encryptBatch, aggregateBatch,
  terminate, isWorkerActive, getConfig,
} from '../../src/client/lib/workerDispatcher.js';

// ── configure ────────────────────────────────────────────────────────

describe('configure', () => {
  beforeEach(() => {
    terminate();
  });

  it('sets mode and threshold', () => {
    configure({ workerMode: 'count', workerThreshold: '100' });
    const c = getConfig();
    expect(c.mode).toBe('count');
    expect(c.threshold).toBe(100);
  });

  it('sets disabled mode', () => {
    configure({ workerMode: 'disabled', workerThreshold: '50' });
    expect(getConfig().mode).toBe('disabled');
  });

  it('defaults to count for invalid mode', () => {
    configure({ workerMode: 'invalid', workerThreshold: '50' });
    expect(getConfig().mode).toBe('count');
  });

  it('defaults threshold to 50 for invalid input', () => {
    configure({ workerMode: 'count', workerThreshold: 'abc' });
    expect(getConfig().threshold).toBe(50);
  });

  it('sets adaptive config', () => {
    configure({ workerMode: 'adaptive', workerThreshold: '50', workerAdaptiveMs: '200' });
    const c = getConfig();
    expect(c.mode).toBe('adaptive');
    expect(c.adaptiveMs).toBe(200);
  });

  it('sets adaptive_decay config', () => {
    configure({ workerMode: 'adaptive_decay', workerThreshold: '50', workerAdaptiveMs: '150' });
    const c = getConfig();
    expect(c.mode).toBe('adaptive_decay');
    expect(c.adaptiveMs).toBe(150);
  });

  it('defaults adaptiveMs to 100 for invalid input', () => {
    configure({ workerMode: 'adaptive', workerAdaptiveMs: 'bad' });
    expect(getConfig().adaptiveMs).toBe(100);
  });
});

// ── Main thread path (below threshold) ──────────────────────────────

describe('main thread path', () => {
  beforeEach(() => {
    terminate();
    configure({ workerMode: 'count', workerThreshold: '1000' }); // high threshold = always main thread
  });

  it('decryptBatch returns null for invalid blobs on main thread', async () => {
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

// ── Disabled mode (kill switch) ──────────────────────────────────────

describe('disabled mode', () => {
  beforeEach(() => {
    terminate();
  });

  it('uses main thread when mode is disabled even with threshold=1', async () => {
    configure({ workerMode: 'disabled', workerThreshold: '1' });
    const fakeDek = {};
    await decryptBatch(['blob'], fakeDek);
    expect(isWorkerActive()).toBe(false);
  });
});

// ── Config updates ──────────────────────────────────────────────────

describe('config updates', () => {
  it('respects config changes mid-session', () => {
    terminate();
    configure({ workerMode: 'count', workerThreshold: '1000' });
    expect(getConfig().threshold).toBe(1000);

    configure({ workerMode: 'count', workerThreshold: '25' });
    expect(getConfig().threshold).toBe(25);
  });

  it('switches modes mid-session', () => {
    terminate();
    configure({ workerMode: 'count', workerThreshold: '50' });
    expect(getConfig().mode).toBe('count');

    configure({ workerMode: 'adaptive', workerAdaptiveMs: '200' });
    expect(getConfig().mode).toBe('adaptive');
    expect(getConfig().adaptiveMs).toBe(200);
  });
});

// ── terminate ───────────────────────────────────────────────────────

describe('terminate', () => {
  it('clears worker state', () => {
    terminate();
    expect(isWorkerActive()).toBe(false);
  });
});
