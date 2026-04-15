const DB_NAME_BASE = 'citadel_vault';
const DB_VERSION = 1;
const IS_DEV = import.meta.env?.DEV ?? false;

const VALID_ENTRY_TYPES = ['password', 'account', 'asset', 'license', 'insurance', 'custom'];
const IMMUTABLE_FIELDS = ['id', 'entry_type', 'template_id'];

// ═══════════════════════════════════════════════════════════════════════════
// DATA INTEGRITY FUNCTIONS — DO NOT MODIFY WITHOUT REVIEW
//
// These functions protect the core data model. They prevent:
//   - Field name mismatches (e.g., "data" vs "encrypted_data")
//   - Template corruption (template_id accidentally dropped or changed)
//   - Entry type mutations (entry_type changed on update)
//   - Missing required fields
//
// RULES FOR CHANGES:
//   1. Any change to these functions requires updating entryIntegrity.test.js
//   2. Run ALL tests before committing: npm run test:unit
//   3. Never weaken validation (remove checks) without explicit approval
//   4. The "data" vs "encrypted_data" field name is intentionally enforced —
//      the server API returns "encrypted_data", all client code must match
//   5. template_id is IMMUTABLE after creation — it must never change on update
//
// AI AGENTS: Do not modify these functions. If your changes trigger validation
// errors, fix the calling code — not the validator.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate entry shape before writing to IndexedDB.
 * Throws in development, warns in production.
 *
 * @critical — Data integrity function. See rules above.
 */
function validateEntryShape(entry, label = 'entryStore') {
  const errors = [];

  if (typeof entry.id !== 'number' || !entry.id) {
    errors.push('id must be a non-zero number');
  }
  if (!VALID_ENTRY_TYPES.includes(entry.entry_type)) {
    errors.push(`entry_type "${entry.entry_type}" is invalid`);
  }
  if (entry.template_id !== null && entry.template_id !== undefined && typeof entry.template_id !== 'number') {
    errors.push(`template_id must be number or null, got ${typeof entry.template_id}`);
  }
  if (typeof entry.encrypted_data !== 'string' || !entry.encrypted_data) {
    errors.push('encrypted_data must be a non-empty string');
  }
  if ('data' in entry && !('encrypted_data' in entry)) {
    errors.push('entry has "data" field instead of "encrypted_data" — field name mismatch');
  }

  if (errors.length > 0) {
    const msg = `[${label}] Entry validation failed (id=${entry.id}): ${errors.join('; ')}`;
    if (IS_DEV) throw new Error(msg);
    console.warn(msg);
  }
}

/**
 * Mutation guard: verify immutable fields haven't changed on update.
 * Compares new entry against existing entry in IndexedDB.
 *
 * @critical — Data integrity function. See rules above.
 */
function checkMutationIntegrity(existing, updated, label = 'entryStore', { allowTemplateChange = false } = {}) {
  if (!existing) return; // new entry, no comparison needed

  const violations = [];
  for (const field of IMMUTABLE_FIELDS) {
    // Skip template_id check if user deliberately changed it (edit modal)
    if (field === 'template_id' && allowTemplateChange) continue;

    const oldVal = existing[field];
    const newVal = updated[field];
    // Allow null → number (first time template_id is set) but not number → null/different
    if (oldVal !== null && oldVal !== undefined && newVal !== oldVal) {
      violations.push(`${field} changed from ${oldVal} to ${newVal}`);
    }
  }

  if (violations.length > 0) {
    const msg = `[${label}] Mutation integrity violation (id=${updated.id}): ${violations.join('; ')}`;
    if (IS_DEV) throw new Error(msg);
    console.warn(msg);
  }
}

const STORES = {
    entries: { keyPath: 'id', indexes: [{ name: 'entry_type', keyPath: 'entry_type' }] },
    shared_items: { keyPath: 'id', indexes: [{ name: 'entry_type', keyPath: 'entry_type' }] },
    templates: { keyPath: 'id', indexes: [{ name: 'template_key', keyPath: 'template_key' }] },
    snapshots: { keyPath: 'id', indexes: [{ name: 'snapshot_date', keyPath: 'snapshot_date' }] },
};

class EntryStore {
    constructor() {
        this._db = null;
        this._opening = null;
        this._dbName = DB_NAME_BASE;
        this._legacyCleaned = false;
        // Cache policy (cachePolicy.js) handles IndexedDB lifecycle.
        // No beforeunload clear — entries persist per cache_mode setting.
    }

    /**
     * Scope the IndexedDB to a specific user.
     * Closes any existing connection and sets the DB name to citadel_vault_<userId>.
     * Pass null/undefined to reset to the unscoped base name.
     */
    switchUser(userId) {
        // Close existing connection
        if (this._db) {
            this._db.close();
            this._db = null;
        }
        this._opening = null;
        this._dbName = userId ? `${DB_NAME_BASE}_${userId}` : DB_NAME_BASE;

        // One-time cleanup: delete the legacy unscoped database
        if (userId && !this._legacyCleaned) {
            this._legacyCleaned = true;
            indexedDB.deleteDatabase(DB_NAME_BASE);
        }
    }

    _open() {
        if (this._db) return Promise.resolve(this._db);
        if (this._opening) return this._opening;

        this._opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                for (const [name, config] of Object.entries(STORES)) {
                    if (!db.objectStoreNames.contains(name)) {
                        const store = db.createObjectStore(name, { keyPath: config.keyPath });
                        for (const idx of config.indexes) {
                            store.createIndex(idx.name, idx.keyPath, { unique: false });
                        }
                    }
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                this._db.onclose = () => { this._db = null; this._opening = null; };
                resolve(this._db);
            };

            request.onerror = () => {
                this._opening = null;
                reject(request.error);
            };
        });

        return this._opening;
    }

    // ── Entries ──────────────────────────────────────────────────────────

    async getAll() {
        const db = await this._open();
        return this._getAllFromStore(db, 'entries');
    }

    async getByType(entryType) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('entries', 'readonly');
            const index = tx.objectStore('entries').index('entry_type');
            const request = index.getAll(entryType);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getById(id) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('entries', 'readonly');
            const request = tx.objectStore('entries').get(id);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    }

    async put(entry, { allowTemplateChange = false } = {}) {
        validateEntryShape(entry, 'entryStore.put');
        const db = await this._open();
        // Mutation guard: check immutable fields if entry already exists
        const existing = await this.getById(entry.id).catch(() => null);
        checkMutationIntegrity(existing, entry, 'entryStore.put', { allowTemplateChange });
        return this._putInStore(db, 'entries', entry);
    }

    async putAll(entries) {
        const db = await this._open();
        for (const entry of entries) {
            validateEntryShape(entry, 'entryStore.putAll');
        }
        return this._putAllInStore(db, 'entries', entries);
    }

    async delete(id) {
        const db = await this._open();
        return this._deleteFromStore(db, 'entries', id);
    }

    // ── Templates ───────────────────────────────────────────────────────

    async getAllTemplates() {
        const db = await this._open();
        return this._getAllFromStore(db, 'templates');
    }

    async putTemplates(templates) {
        const db = await this._open();
        return this._putAllInStore(db, 'templates', templates);
    }

    async clearTemplates() {
        const db = await this._open();
        return this._clearStore(db, 'templates');
    }

    // ── Shared Items ────────────────────────────────────────────────────

    async getAllSharedItems() {
        const db = await this._open();
        return this._getAllFromStore(db, 'shared_items');
    }

    async putSharedItems(items) {
        const db = await this._open();
        return this._putAllInStore(db, 'shared_items', items);
    }

    async clearSharedItems() {
        const db = await this._open();
        return this._clearStore(db, 'shared_items');
    }

    // ── Snapshots ───────────────────────────────────────────────────────

    async getSnapshots() {
        const db = await this._open();
        return this._getAllFromStore(db, 'snapshots');
    }

    async putSnapshots(snapshots) {
        const db = await this._open();
        return this._putAllInStore(db, 'snapshots', snapshots);
    }

    async clearSnapshots() {
        const db = await this._open();
        return this._clearStore(db, 'snapshots');
    }

    /** Clear entries store and write fresh set in a single transaction. */
    async replaceAllEntries(items) {
        const db = await this._open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');
            store.clear();
            for (const item of items) { store.put(item); }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ── Clear All ───────────────────────────────────────────────────────

    async clear() {
        const db = await this._open();
        const storeNames = Object.keys(STORES);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeNames, 'readwrite');
            for (const name of storeNames) {
                tx.objectStore(name).clear();
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ── Internal helpers ────────────────────────────────────────────────

    _getAllFromStore(db, storeName) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _putInStore(db, storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(item);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    _putAllInStore(db, storeName, items) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            for (const item of items) {
                store.put(item);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    _deleteFromStore(db, storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    _clearStore(db, storeName) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

export const entryStore = new EntryStore();

// Exported for testing only
export { validateEntryShape, checkMutationIntegrity };
