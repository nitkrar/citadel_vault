/**
 * EntryStore CRUD + Validation Tests
 *
 * Tests the IndexedDB-backed EntryStore singleton: entries, templates,
 * shared items, snapshots, and the clear-all operation.
 * Also covers validateEntryShape and checkMutationIntegrity from
 * the perspective of the store's put/putAll integration.
 *
 * Uses fake-indexeddb to polyfill IndexedDB in Node.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { entryStore, validateEntryShape, checkMutationIntegrity } from '../../src/client/lib/entryStore.js';
import { makeEntry, makeTemplate, makeSnapshotPayload } from '../helpers/fixtures.js';

// ── Lifecycle ────────────────────────────────────────────────────────────

beforeEach(async () => {
  await entryStore.clear();
});

afterEach(async () => {
  await entryStore.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
// EntryStore CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe('EntryStore CRUD', () => {
  describe('entries', () => {
    it('put and getById', async () => {
      const entry = makeEntry({ id: 1 });
      await entryStore.put(entry);
      const result = await entryStore.getById(1);
      expect(result).toEqual(entry);
    });

    it('put and getAll returns all entries', async () => {
      const e1 = makeEntry({ id: 1 });
      const e2 = makeEntry({ id: 2, entry_type: 'account' });
      await entryStore.put(e1);
      await entryStore.put(e2);
      const all = await entryStore.getAll();
      expect(all).toHaveLength(2);
      expect(all).toEqual(expect.arrayContaining([e1, e2]));
    });

    it('getByType returns filtered entries', async () => {
      const pw = makeEntry({ id: 1, entry_type: 'password' });
      const acct = makeEntry({ id: 2, entry_type: 'account' });
      const asset = makeEntry({ id: 3, entry_type: 'asset' });
      await entryStore.put(pw);
      await entryStore.put(acct);
      await entryStore.put(asset);

      const passwords = await entryStore.getByType('password');
      expect(passwords).toHaveLength(1);
      expect(passwords[0].id).toBe(1);

      const accounts = await entryStore.getByType('account');
      expect(accounts).toHaveLength(1);
      expect(accounts[0].id).toBe(2);
    });

    it('delete removes entry', async () => {
      const entry = makeEntry({ id: 1 });
      await entryStore.put(entry);
      expect(await entryStore.getById(1)).toEqual(entry);

      await entryStore.delete(1);
      expect(await entryStore.getById(1)).toBeNull();
    });

    it('getById returns null for non-existent', async () => {
      const result = await entryStore.getById(9999);
      expect(result).toBeNull();
    });

    it('put overwrites existing entry with same id', async () => {
      const entry = makeEntry({ id: 1, encrypted_data: 'original' });
      await entryStore.put(entry);

      const updated = { ...entry, encrypted_data: 'updated', updated_at: '2026-02-01T00:00:00Z' };
      await entryStore.put(updated);

      const result = await entryStore.getById(1);
      expect(result.encrypted_data).toBe('updated');
    });
  });

  describe('putAll', () => {
    it('puts multiple entries at once', async () => {
      const entries = [
        makeEntry({ id: 1 }),
        makeEntry({ id: 2, entry_type: 'account' }),
        makeEntry({ id: 3, entry_type: 'asset' }),
      ];
      await entryStore.putAll(entries);
      const all = await entryStore.getAll();
      expect(all).toHaveLength(3);
    });

    it('validates shape for each entry', async () => {
      const entries = [
        makeEntry({ id: 1 }),
        makeEntry({ id: 0 }), // invalid: id=0
      ];
      await expect(entryStore.putAll(entries)).rejects.toThrow('id must be');
    });

    it('skips mutation integrity check (by design)', async () => {
      // Pre-populate an entry with template_id=1
      const original = makeEntry({ id: 1, template_id: 1 });
      await entryStore.put(original);

      // putAll with a changed template_id should NOT throw,
      // because putAll intentionally skips mutation checks
      const changed = makeEntry({ id: 1, template_id: 99 });
      await expect(entryStore.putAll([changed])).resolves.not.toThrow();

      // Verify the overwrite happened
      const result = await entryStore.getById(1);
      expect(result.template_id).toBe(99);
    });
  });

  describe('put mutation guard integration', () => {
    it('put throws when template_id changes on existing entry', async () => {
      const original = makeEntry({ id: 1, template_id: 1 });
      await entryStore.put(original);

      const mutated = { ...original, template_id: 99 };
      await expect(entryStore.put(mutated)).rejects.toThrow('template_id changed');
    });

    it('put allows template change with allowTemplateChange option', async () => {
      const original = makeEntry({ id: 1, template_id: 1 });
      await entryStore.put(original);

      const changed = { ...original, template_id: 99 };
      await expect(entryStore.put(changed, { allowTemplateChange: true })).resolves.not.toThrow();
    });

    it('put throws on shape validation failure', async () => {
      const bad = makeEntry({ id: 1, encrypted_data: '' });
      await expect(entryStore.put(bad)).rejects.toThrow('encrypted_data');
    });
  });

  describe('templates', () => {
    it('putTemplates and getAllTemplates', async () => {
      const templates = [
        makeTemplate({ id: 1, template_key: 'password' }),
        makeTemplate({ id: 2, template_key: 'account', name: 'Account', icon: 'bank' }),
      ];
      await entryStore.putTemplates(templates);

      const all = await entryStore.getAllTemplates();
      expect(all).toHaveLength(2);
      expect(all.map(t => t.template_key)).toEqual(expect.arrayContaining(['password', 'account']));
    });

    it('clearTemplates empties store', async () => {
      await entryStore.putTemplates([makeTemplate({ id: 1 })]);
      expect(await entryStore.getAllTemplates()).toHaveLength(1);

      await entryStore.clearTemplates();
      expect(await entryStore.getAllTemplates()).toHaveLength(0);
    });
  });

  describe('shared items', () => {
    it('putSharedItems and getAllSharedItems', async () => {
      const items = [
        makeEntry({ id: 10, entry_type: 'password' }),
        makeEntry({ id: 11, entry_type: 'account' }),
      ];
      await entryStore.putSharedItems(items);

      const all = await entryStore.getAllSharedItems();
      expect(all).toHaveLength(2);
      expect(all.map(i => i.id)).toEqual(expect.arrayContaining([10, 11]));
    });

    it('clearSharedItems empties store', async () => {
      await entryStore.putSharedItems([makeEntry({ id: 10 })]);
      expect(await entryStore.getAllSharedItems()).toHaveLength(1);

      await entryStore.clearSharedItems();
      expect(await entryStore.getAllSharedItems()).toHaveLength(0);
    });
  });

  describe('snapshots', () => {
    it('putSnapshots and getSnapshots', async () => {
      const snapshots = [
        { id: 1, ...makeSnapshotPayload({ snapshot_date: '2026-01-01' }) },
        { id: 2, ...makeSnapshotPayload({ snapshot_date: '2026-01-02' }) },
      ];
      await entryStore.putSnapshots(snapshots);

      const all = await entryStore.getSnapshots();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.snapshot_date)).toEqual(expect.arrayContaining(['2026-01-01', '2026-01-02']));
    });

    it('clearSnapshots empties store', async () => {
      await entryStore.putSnapshots([{ id: 1, ...makeSnapshotPayload() }]);
      expect(await entryStore.getSnapshots()).toHaveLength(1);

      await entryStore.clearSnapshots();
      expect(await entryStore.getSnapshots()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('clears all 4 object stores at once', async () => {
      // Populate all stores
      await entryStore.put(makeEntry({ id: 1 }));
      await entryStore.putTemplates([makeTemplate({ id: 1 })]);
      await entryStore.putSharedItems([makeEntry({ id: 10 })]);
      await entryStore.putSnapshots([{ id: 1, ...makeSnapshotPayload() }]);

      // Verify populated
      expect(await entryStore.getAll()).toHaveLength(1);
      expect(await entryStore.getAllTemplates()).toHaveLength(1);
      expect(await entryStore.getAllSharedItems()).toHaveLength(1);
      expect(await entryStore.getSnapshots()).toHaveLength(1);

      // Clear everything
      await entryStore.clear();

      // Verify empty
      expect(await entryStore.getAll()).toHaveLength(0);
      expect(await entryStore.getAllTemplates()).toHaveLength(0);
      expect(await entryStore.getAllSharedItems()).toHaveLength(0);
      expect(await entryStore.getSnapshots()).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateEntryShape
// ═══════════════════════════════════════════════════════════════════════════

describe('validateEntryShape', () => {
  it('accepts valid entry', () => {
    expect(() => validateEntryShape(makeEntry())).not.toThrow();
  });

  it('throws when id is missing', () => {
    expect(() => validateEntryShape(makeEntry({ id: undefined }))).toThrow('id must be');
  });

  it('throws when id is zero', () => {
    expect(() => validateEntryShape(makeEntry({ id: 0 }))).toThrow('id must be');
  });

  it('throws when id is a string', () => {
    expect(() => validateEntryShape(makeEntry({ id: '5' }))).toThrow('id must be');
  });

  it('throws when entry_type is invalid', () => {
    expect(() => validateEntryShape(makeEntry({ entry_type: 'banana' }))).toThrow('entry_type');
  });

  it('throws when entry_type is missing', () => {
    expect(() => validateEntryShape(makeEntry({ entry_type: undefined }))).toThrow('entry_type');
  });

  it('throws when encrypted_data is missing', () => {
    expect(() => validateEntryShape(makeEntry({ encrypted_data: undefined }))).toThrow('encrypted_data');
  });

  it('throws when encrypted_data is empty string', () => {
    expect(() => validateEntryShape(makeEntry({ encrypted_data: '' }))).toThrow('encrypted_data');
  });

  it('throws when encrypted_data is not a string', () => {
    expect(() => validateEntryShape(makeEntry({ encrypted_data: 12345 }))).toThrow('encrypted_data');
  });

  it('throws when entry has "data" field instead of "encrypted_data"', () => {
    const bad = { id: 1, entry_type: 'password', template_id: 1, data: 'blob', created_at: 'x', updated_at: 'x' };
    expect(() => validateEntryShape(bad)).toThrow('field name mismatch');
  });

  it('does not throw when entry has both "data" and "encrypted_data"', () => {
    // The check only fires when "data" exists WITHOUT "encrypted_data"
    const entry = makeEntry({ data: 'extra-field' });
    expect(() => validateEntryShape(entry)).not.toThrow();
  });

  it('accepts template_id as null', () => {
    expect(() => validateEntryShape(makeEntry({ template_id: null }))).not.toThrow();
  });

  it('accepts template_id as undefined', () => {
    expect(() => validateEntryShape(makeEntry({ template_id: undefined }))).not.toThrow();
  });

  it('throws when template_id is a string', () => {
    expect(() => validateEntryShape(makeEntry({ template_id: '1' }))).toThrow('template_id');
  });

  it('accepts all valid entry_type values', () => {
    for (const type of ['password', 'account', 'asset', 'license', 'insurance', 'custom']) {
      expect(() => validateEntryShape(makeEntry({ entry_type: type }))).not.toThrow();
    }
  });

  it('aggregates multiple errors into one message', () => {
    const bad = { id: 0, entry_type: 'invalid', template_id: 'string', encrypted_data: '' };
    expect(() => validateEntryShape(bad)).toThrow(/id must be.*entry_type.*encrypted_data/s);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// checkMutationIntegrity
// ═══════════════════════════════════════════════════════════════════════════

describe('checkMutationIntegrity', () => {
  const base = makeEntry({ id: 1, entry_type: 'password', template_id: 1 });

  it('no error when existing is null (new entry)', () => {
    expect(() => checkMutationIntegrity(null, base)).not.toThrow();
  });

  it('no error when existing is undefined (new entry)', () => {
    expect(() => checkMutationIntegrity(undefined, base)).not.toThrow();
  });

  it('throws when id changes', () => {
    const updated = { ...base, id: 999 };
    expect(() => checkMutationIntegrity(base, updated)).toThrow('id changed');
  });

  it('throws when entry_type changes', () => {
    const updated = { ...base, entry_type: 'account' };
    expect(() => checkMutationIntegrity(base, updated)).toThrow('entry_type changed');
  });

  it('throws when template_id changes from number to different number', () => {
    const updated = { ...base, template_id: 99 };
    expect(() => checkMutationIntegrity(base, updated)).toThrow('template_id changed');
  });

  it('throws when template_id changes from number to null', () => {
    const updated = { ...base, template_id: null };
    expect(() => checkMutationIntegrity(base, updated)).toThrow('template_id changed');
  });

  it('throws when template_id changes from number to undefined', () => {
    const updated = { ...base, template_id: undefined };
    expect(() => checkMutationIntegrity(base, updated)).toThrow('template_id changed');
  });

  it('allows template_id change when allowTemplateChange=true', () => {
    const updated = { ...base, template_id: 99 };
    expect(() => checkMutationIntegrity(base, updated, 'test', { allowTemplateChange: true })).not.toThrow();
  });

  it('allows template_id from null to number (first assignment)', () => {
    const existing = { ...base, template_id: null };
    const updated = { ...base, template_id: 5 };
    expect(() => checkMutationIntegrity(existing, updated)).not.toThrow();
  });

  it('allows template_id from undefined to number (first assignment)', () => {
    const existing = { ...base, template_id: undefined };
    const updated = { ...base, template_id: 5 };
    expect(() => checkMutationIntegrity(existing, updated)).not.toThrow();
  });

  it('allows encrypted_data and updated_at changes', () => {
    const updated = { ...base, encrypted_data: 'new_blob', updated_at: '2026-02-01' };
    expect(() => checkMutationIntegrity(base, updated)).not.toThrow();
  });

  it('still rejects entry_type change even with allowTemplateChange', () => {
    const updated = { ...base, entry_type: 'asset' };
    expect(() => checkMutationIntegrity(base, updated, 'test', { allowTemplateChange: true })).toThrow('entry_type changed');
  });

  it('still rejects id change even with allowTemplateChange', () => {
    const updated = { ...base, id: 999 };
    expect(() => checkMutationIntegrity(base, updated, 'test', { allowTemplateChange: true })).toThrow('id changed');
  });
});
