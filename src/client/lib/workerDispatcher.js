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
import { encryptEntry, decryptEntry } from './crypto';
import { aggregatePortfolio } from './portfolioAggregator';

// ── Configuration ────────────────────────────────────────────────────
let config = { enabled: true, threshold: 50 };

export function configure({ workerEnabled, workerThreshold }) {
  config = {
    enabled: workerEnabled !== '0' && workerEnabled !== false,
    threshold: parseInt(workerThreshold, 10) || 50,
  };
}

// ── Worker lifecycle ─────────────────────────────────────────────────
let worker = null;
let workerKeyInitialized = false;
let cachedRawKey = null;
let msgCounter = 0;
const pendingMessages = new Map();

function shouldUseWorker(itemCount) {
  return config.enabled && itemCount >= config.threshold;
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
    const results = [];
    for (const blob of entries) {
      try {
        results.push(await decryptEntry(blob, dek));
      } catch {
        results.push(null);
      }
    }
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
    const results = [];
    for (const item of items) {
      results.push(await encryptEntry(item, dek));
    }
    return results;
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
  pendingMessages.clear();
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
