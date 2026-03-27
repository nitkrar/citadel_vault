/**
 * workerDispatcher.js — Routes bulk operations to main thread or Web Worker.
 *
 * Decision logic:
 *   config.enabled && itemCount >= config.threshold → Web Worker
 *   otherwise → main thread (direct function call)
 *
 * Worker is lazy-initialized on first use above threshold.
 * DEK raw bytes are cached and sent to worker on first init.
 */
import { encryptEntry, decryptEntry, _getDekForContext } from './crypto';
import { aggregatePortfolio } from './portfolioAggregator';

// ── Configuration ────────────────────────────────────────────────────
// worker_mode:
//   disabled       — all ops on main thread (kill switch)
//   count          — use worker when itemCount >= threshold (default)
//   adaptive       — benchmark first bulk op vs adaptiveMs, sticks for session
//   adaptive_decay — rolling avg of last 3 timings vs adaptiveMs (re-evaluates)
const VALID_MODES = ['disabled', 'count', 'adaptive', 'adaptive_decay'];
let config = { mode: 'count', threshold: 50, adaptiveMs: 100 };

export function configure({ workerMode, workerThreshold, workerAdaptiveMs }) {
  config = {
    mode: VALID_MODES.includes(workerMode) ? workerMode : 'count',
    threshold: parseInt(workerThreshold, 10) || 50,
    adaptiveMs: parseInt(workerAdaptiveMs, 10) || 100,
  };
}

// ── Worker lifecycle ─────────────────────────────────────────────────
let worker = null;
let workerKeyInitialized = false;
let cachedRawKey = null;
let msgCounter = 0;
const pendingMessages = new Map();

// ── Adaptive timing ──────────────────────────────────────────────────
const TIMING_HISTORY_KEY = 'pv_worker_timings';
const MAX_TIMINGS = 3;
let adaptiveDecision = null; // null = not yet decided, true/false = use worker

function loadTimings() {
  try {
    return JSON.parse(sessionStorage.getItem(TIMING_HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveTimings(timings) {
  try {
    sessionStorage.setItem(TIMING_HISTORY_KEY, JSON.stringify(timings.slice(-MAX_TIMINGS)));
  } catch { /* quota */ }
}

function recordTiming(ms) {
  if (config.mode === 'count') return;

  if (config.mode === 'adaptive') {
    // One-shot: decide on first measurement, stick for session
    if (adaptiveDecision === null) {
      adaptiveDecision = ms >= config.adaptiveMs;
    }
    return;
  }

  if (config.mode === 'adaptive_decay') {
    // Rolling average of last 3 timings, re-evaluates each time
    const timings = loadTimings();
    timings.push(ms);
    saveTimings(timings);
    const recent = timings.slice(-MAX_TIMINGS);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    adaptiveDecision = avg >= config.adaptiveMs;
  }
}

function shouldUseWorker(itemCount) {
  if (config.mode === 'disabled') return false;

  if (config.mode === 'count') {
    return itemCount >= config.threshold;
  }

  // adaptive or adaptive_decay: use timing decision if available, else fall back to count
  if (adaptiveDecision !== null) return adaptiveDecision;
  return itemCount >= config.threshold;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./computeWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, success, result, error } = e.data;
      const pending = pendingMessages.get(id);
      if (!pending) return;
      pendingMessages.delete(id);
      if (success) {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error));
      }
    };
    worker.onerror = (err) => {
      for (const [, { reject }] of pendingMessages) {
        reject(new Error('Worker error: ' + err.message));
      }
      pendingMessages.clear();
    };
    workerKeyInitialized = false;
  }
  return worker;
}

function postAndWait(type, payload) {
  const id = `msg_${++msgCounter}`;
  return new Promise((resolve, reject) => {
    pendingMessages.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload });
  });
}

async function ensureWorkerKey() {
  if (!workerKeyInitialized && cachedRawKey) {
    await postAndWait('initKey', cachedRawKey);
    workerKeyInitialized = true;
  }
}

// ── Key management ───────────────────────────────────────────────────

/**
 * Cache the DEK's raw bytes for worker transfer.
 * Called by EncryptionContext on vault unlock.
 * @param {CryptoKey|null} cryptoKey — the DEK, or null to clear
 */
export async function setKey(cryptoKey) {
  if (cryptoKey) {
    cachedRawKey = await crypto.subtle.exportKey('raw', cryptoKey);
  } else {
    cachedRawKey = null;
    // Clear DEK inside the worker too (H4 fix)
    if (worker) {
      worker.postMessage({ id: `msg_${++msgCounter}`, type: 'clearKey', payload: null });
    }
  }
  workerKeyInitialized = false;
}

// ── Bulk operations ──────────────────────────────────────────────────

/**
 * Decrypt an array of encrypted blobs.
 * @param {string[]} entries — array of base64 encrypted blobs
 * @param {CryptoKey} dek — main thread DEK (used if below threshold)
 * @returns {Promise<Array>} decrypted objects (null for failures)
 */
export async function decryptBatch(entries, dek) {
  if (!shouldUseWorker(entries.length)) {
    const start = performance.now();
    const results = [];
    for (const blob of entries) {
      try {
        results.push(await decryptEntry(blob, dek));
      } catch {
        results.push(null);
      }
    }
    recordTiming(performance.now() - start);
    return results;
  }
  await ensureWorkerKey();
  return postAndWait('decryptBatch', { entries });
}

/**
 * Encrypt an array of objects.
 * @param {object[]} items — array of plain objects to encrypt
 * @param {CryptoKey} dek — main thread DEK (used if below threshold)
 * @returns {Promise<string[]>} encrypted blobs
 */
export async function encryptBatch(items, dek) {
  if (!shouldUseWorker(items.length)) {
    const key = dek || _getDekForContext();
    const start = performance.now();
    try {
      const results = [];
      for (const item of items) {
        results.push(await encryptEntry(item, key));
      }
      recordTiming(performance.now() - start);
      return results;
    } catch (err) {
      throw new Error('encryptBatch (main thread) failed: ' + err.message);
    }
  }
  await ensureWorkerKey();
  return postAndWait('encryptBatch', { items });
}

/**
 * Run portfolio aggregation.
 * Below threshold: runs synchronously, returns result directly.
 * Above threshold: offloads to worker, returns promise.
 * @returns {Promise<object>} aggregated portfolio
 */
export async function aggregateBatch(entries, currencies, baseCurrency, displayCurrency) {
  if (!shouldUseWorker(entries.length)) {
    return aggregatePortfolio(entries, currencies, baseCurrency, displayCurrency);
  }
  return postAndWait('aggregate', { entries, currencies, baseCurrency, displayCurrency });
}

// ── Cleanup ──────────────────────────────────────────────────────────

/**
 * Terminate the worker and clear state. Called on logout.
 */
export function terminate() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  cachedRawKey = null;
  workerKeyInitialized = false;
  adaptiveDecision = null;
  pendingMessages.clear();
  try { sessionStorage.removeItem(TIMING_HISTORY_KEY); } catch { /* */ }
}

/**
 * Check if the worker is currently active (for debugging/admin).
 */
export function isWorkerActive() {
  return worker !== null;
}

export function getConfig() {
  return { ...config };
}
