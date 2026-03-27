/**
 * computeWorker.js — Web Worker for offloading CPU-heavy operations.
 *
 * Imports the same pure functions used on the main thread.
 * Receives typed messages, runs the operation, posts results back.
 * DEK (CryptoKey) is imported once via 'initKey' message and cached.
 */
import { encryptEntry, decryptEntry } from './crypto';
import { aggregatePortfolio } from './portfolioAggregator';

let cachedKey = null;

async function importKey(rawKeyBytes) {
  cachedKey = await self.crypto.subtle.importKey(
    'raw',
    rawKeyBytes,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable inside worker
    ['encrypt', 'decrypt']
  );
}

async function handleInitKey(payload) {
  await importKey(payload);
  return { initialized: true };
}

async function handleDecryptBatch(payload) {
  if (!cachedKey) throw new Error('Worker key not initialized');
  const results = [];
  for (const blob of payload.entries) {
    try {
      const decrypted = await decryptEntry(blob, cachedKey);
      results.push(decrypted);
    } catch {
      results.push(null);
    }
  }
  return results;
}

async function handleEncryptBatch(payload) {
  if (!cachedKey) throw new Error('Worker key not initialized');
  const results = [];
  for (const item of payload.items) {
    const encrypted = await encryptEntry(item, cachedKey);
    results.push(encrypted);
  }
  return results;
}

function handleAggregate(payload) {
  const { entries, currencies, baseCurrency, displayCurrency } = payload;
  return aggregatePortfolio(entries, currencies, baseCurrency, displayCurrency);
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    let result;
    switch (type) {
      case 'initKey':
        result = await handleInitKey(payload);
        break;
      case 'decryptBatch':
        result = await handleDecryptBatch(payload);
        break;
      case 'encryptBatch':
        result = await handleEncryptBatch(payload);
        break;
      case 'aggregate':
        result = handleAggregate(payload);
        break;
      case 'clearKey':
        cachedKey = null;
        result = { cleared: true };
        break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    self.postMessage({ id, type, success: true, result });
  } catch (err) {
    self.postMessage({ id, type, success: false, error: err.message });
  }
};
