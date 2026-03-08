const DB_NAME = 'citadel_vault';
const DB_VERSION = 1;

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

        // Clear on tab close
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                this.clear().catch(() => {});
            });
        }
    }

    _open() {
        if (this._db) return Promise.resolve(this._db);
        if (this._opening) return this._opening;

        this._opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

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

    async put(entry) {
        const db = await this._open();
        return this._putInStore(db, 'entries', entry);
    }

    async putAll(entries) {
        const db = await this._open();
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
