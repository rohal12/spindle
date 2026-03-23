// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMemoryBackend,
  createLocalStorageBackend,
} from '../../src/saves/storage';
import type {
  StorageBackend,
  SaveRecord,
  PlaythroughRecord,
} from '../../src/saves/types';

function makeSaveRecord(
  id: string,
  ifid: string,
  playthroughId: string,
): SaveRecord {
  return {
    meta: {
      id,
      ifid,
      playthroughId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: `Save ${id}`,
      passage: 'Start',
      custom: {},
    },
    payload: {
      passage: 'Start',
      variables: { hp: 100 },
      history: [{ passage: 'Start', variables: {}, timestamp: Date.now() }],
      historyIndex: 0,
    },
  };
}

function makePlaythroughRecord(id: string, ifid: string): PlaythroughRecord {
  return {
    id,
    ifid,
    createdAt: new Date().toISOString(),
    label: `Playthrough ${id}`,
  };
}

function runBackendSuite(
  name: string,
  createBackend: () => StorageBackend,
): void {
  describe(name, () => {
    const IFID = `ifid-${name}-${Date.now()}`;
    const PT_ID = `pt-${name}-${Date.now()}`;
    let backend: StorageBackend;

    beforeEach(() => {
      backend = createBackend();
    });

    describe('saves', () => {
      it('putSave + getSave round-trips', async () => {
        const record = makeSaveRecord('s1', IFID, PT_ID);
        await backend.putSave(record);
        const loaded = await backend.getSave('s1');
        expect(loaded).toBeDefined();
        expect(loaded!.meta.id).toBe('s1');
        expect(loaded!.meta.ifid).toBe(IFID);
        expect(loaded!.meta.playthroughId).toBe(PT_ID);
      });

      it('getSave returns undefined for missing', async () => {
        const result = await backend.getSave('nonexistent-id');
        expect(result).toBeUndefined();
      });

      it('deleteSave removes the record', async () => {
        const record = makeSaveRecord('s-del', IFID, PT_ID);
        await backend.putSave(record);
        await backend.deleteSave('s-del');
        const loaded = await backend.getSave('s-del');
        expect(loaded).toBeUndefined();
      });

      it('getSavesByIfid filters correctly', async () => {
        const uniqueIfid = `ifid-filter-${Date.now()}`;
        const otherIfid = `ifid-other-${Date.now()}`;
        await backend.putSave(makeSaveRecord('sf1', uniqueIfid, PT_ID));
        await backend.putSave(makeSaveRecord('sf2', uniqueIfid, PT_ID));
        await backend.putSave(makeSaveRecord('sf3', otherIfid, PT_ID));

        const results = await backend.getSavesByIfid(uniqueIfid);
        expect(results.length).toBe(2);
        expect(results.every((r) => r.meta.ifid === uniqueIfid)).toBe(true);
      });

      it('deleteSavesByIfid removes all saves for an IFID', async () => {
        const uniqueIfid = `ifid-delall-${Date.now()}`;
        const otherIfid = `ifid-keep-${Date.now()}`;
        await backend.putSave(makeSaveRecord('da1', uniqueIfid, PT_ID));
        await backend.putSave(makeSaveRecord('da2', uniqueIfid, PT_ID));
        await backend.putSave(makeSaveRecord('da3', otherIfid, PT_ID));

        await backend.deleteSavesByIfid(uniqueIfid);

        const deleted = await backend.getSavesByIfid(uniqueIfid);
        expect(deleted).toHaveLength(0);

        const kept = await backend.getSavesByIfid(otherIfid);
        expect(kept).toHaveLength(1);
      });

      it('deleteSavesByPlaythrough returns deleted IDs', async () => {
        const ptId = `pt-del-${Date.now()}`;
        const otherPtId = `pt-other-${Date.now()}`;
        await backend.putSave(makeSaveRecord('dpt1', IFID, ptId));
        await backend.putSave(makeSaveRecord('dpt2', IFID, ptId));
        await backend.putSave(makeSaveRecord('dpt3', IFID, otherPtId));

        const deleted = await backend.deleteSavesByPlaythrough(ptId);
        expect(deleted.sort()).toEqual(['dpt1', 'dpt2'].sort());

        expect(await backend.getSave('dpt1')).toBeUndefined();
        expect(await backend.getSave('dpt2')).toBeUndefined();
        expect(await backend.getSave('dpt3')).toBeDefined();
      });
    });

    describe('playthroughs', () => {
      it('putPlaythrough + getPlaythroughsByIfid round-trips', async () => {
        const uniqueIfid = `pt-ifid-${Date.now()}`;
        const record = makePlaythroughRecord('pt1', uniqueIfid);
        await backend.putPlaythrough(record);

        const results = await backend.getPlaythroughsByIfid(uniqueIfid);
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe('pt1');
        expect(results[0]!.ifid).toBe(uniqueIfid);
        expect(results[0]!.label).toBe('Playthrough pt1');
      });

      it('deletePlaythroughsByIfid clears all for IFID', async () => {
        const uniqueIfid = `pt-delall-${Date.now()}`;
        const otherIfid = `pt-keep-${Date.now()}`;
        await backend.putPlaythrough(makePlaythroughRecord('ptd1', uniqueIfid));
        await backend.putPlaythrough(makePlaythroughRecord('ptd2', uniqueIfid));
        await backend.putPlaythrough(makePlaythroughRecord('ptd3', otherIfid));

        await backend.deletePlaythroughsByIfid(uniqueIfid);

        const deleted = await backend.getPlaythroughsByIfid(uniqueIfid);
        expect(deleted).toHaveLength(0);

        const kept = await backend.getPlaythroughsByIfid(otherIfid);
        expect(kept).toHaveLength(1);
      });

      it('deletePlaythroughById removes one record', async () => {
        const uniqueIfid = `pt-delone-${Date.now()}`;
        await backend.putPlaythrough(makePlaythroughRecord('pto1', uniqueIfid));
        await backend.putPlaythrough(makePlaythroughRecord('pto2', uniqueIfid));

        await backend.deletePlaythroughById('pto1');

        const results = await backend.getPlaythroughsByIfid(uniqueIfid);
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe('pto2');
      });
    });

    describe('meta', () => {
      it('setMeta + getMeta round-trips', async () => {
        await backend.setMeta('testKey', 'testValue');
        const result = await backend.getMeta<string>('testKey');
        expect(result).toBe('testValue');
      });

      it('getMeta returns undefined for missing', async () => {
        const result = await backend.getMeta(`missing-key-${Date.now()}`);
        expect(result).toBeUndefined();
      });

      it('deleteMeta removes the key', async () => {
        const key = `del-key-${Date.now()}`;
        await backend.setMeta(key, 'value');
        await backend.deleteMeta(key);
        const result = await backend.getMeta(key);
        expect(result).toBeUndefined();
      });

      it('deleteMetaByPrefix removes matching keys', async () => {
        const prefix = `pfx-${Date.now()}-`;
        await backend.setMeta(`${prefix}a`, 1);
        await backend.setMeta(`${prefix}b`, 2);
        await backend.setMeta(`other-${Date.now()}`, 3);

        await backend.deleteMetaByPrefix(prefix);

        expect(await backend.getMeta(`${prefix}a`)).toBeUndefined();
        expect(await backend.getMeta(`${prefix}b`)).toBeUndefined();
      });

      it('deleteMetaByIfid removes keys containing the IFID', async () => {
        const uniqueIfid = `ifid-meta-${Date.now()}`;
        const key1 = `currentPlaythroughId.${uniqueIfid}`;
        const key2 = `slot.A.${uniqueIfid}`;
        const otherKey = `unrelated-${Date.now()}`;

        await backend.setMeta(key1, 'value1');
        await backend.setMeta(key2, 'value2');
        await backend.setMeta(otherKey, 'value3');

        await backend.deleteMetaByIfid(uniqueIfid);

        expect(await backend.getMeta(key1)).toBeUndefined();
        expect(await backend.getMeta(key2)).toBeUndefined();
        expect(await backend.getMeta(otherKey)).toBe('value3');
      });

      it('getAllMetaKeys returns all stored keys', async () => {
        // Use a fresh backend to avoid pollution from other tests
        const freshBackend = createBackend();
        const k1 = `key1-${Date.now()}`;
        const k2 = `key2-${Date.now()}`;
        await freshBackend.setMeta(k1, 'a');
        await freshBackend.setMeta(k2, 'b');

        const keys = await freshBackend.getAllMetaKeys();
        expect(keys).toContain(k1);
        expect(keys).toContain(k2);
      });
    });

    describe('destroy', () => {
      it('destroy clears all data', async () => {
        const uniqueIfid = `destroy-ifid-${Date.now()}`;
        await backend.putSave(makeSaveRecord('ds1', uniqueIfid, PT_ID));
        await backend.putPlaythrough(makePlaythroughRecord('dpt1', uniqueIfid));
        await backend.setMeta('destroyKey', 'value');

        await backend.destroy();

        expect(await backend.getSave('ds1')).toBeUndefined();
        expect(await backend.getPlaythroughsByIfid(uniqueIfid)).toHaveLength(0);
        expect(await backend.getMeta('destroyKey')).toBeUndefined();
      });
    });
  });
}

runBackendSuite('memory backend', () => createMemoryBackend());

runBackendSuite('localStorage backend', () => {
  localStorage.clear();
  return createLocalStorageBackend();
});
