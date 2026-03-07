import { describe, it, expect } from 'vitest';
import {
  putSave,
  getSave,
  deleteSave,
  getSavesByIfid,
  putPlaythrough,
  getPlaythroughsByIfid,
  getMeta,
  setMeta,
} from '../../src/saves/idb';
import type { SaveRecord, PlaythroughRecord } from '../../src/saves/types';

// In Node there's no IndexedDB, so all operations use the in-memory fallback.

function makeSaveRecord(id: string, ifid: string, ptId: string): SaveRecord {
  return {
    meta: {
      id,
      ifid,
      playthroughId: ptId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: `Save ${id}`,
      passage: 'Start',
      custom: {},
    },
    payload: {
      passage: 'Start',
      variables: {},
      history: [{ passage: 'Start', variables: {}, timestamp: Date.now() }],
      historyIndex: 0,
    },
  };
}

describe('idb fallback (in-memory)', () => {
  const IFID = 'idb-test-' + Date.now();
  const PT_ID = 'pt-idb-test';

  describe('saves', () => {
    it('putSave + getSave round-trips', async () => {
      const record = makeSaveRecord('s1', IFID, PT_ID);
      await putSave(record);
      const loaded = await getSave('s1');
      expect(loaded).toBeDefined();
      expect(loaded!.meta.id).toBe('s1');
      expect(loaded!.meta.ifid).toBe(IFID);
    });

    it('getSave returns undefined for missing', async () => {
      const result = await getSave('nonexistent-idb-save');
      expect(result).toBeUndefined();
    });

    it('deleteSave removes the record', async () => {
      const record = makeSaveRecord('s-del', IFID, PT_ID);
      await putSave(record);
      await deleteSave('s-del');
      const loaded = await getSave('s-del');
      expect(loaded).toBeUndefined();
    });

    it('getSavesByIfid returns saves matching ifid', async () => {
      const uniqueIfid = 'ifid-filter-' + Date.now();
      await putSave(makeSaveRecord('sf1', uniqueIfid, PT_ID));
      await putSave(makeSaveRecord('sf2', uniqueIfid, PT_ID));
      await putSave(makeSaveRecord('sf3', 'other-ifid', PT_ID));

      const results = await getSavesByIfid(uniqueIfid);
      expect(results.length).toBe(2);
      expect(results.every((r) => r.meta.ifid === uniqueIfid)).toBe(true);
    });
  });

  describe('playthroughs', () => {
    it('putPlaythrough + getPlaythroughsByIfid round-trips', async () => {
      const uniqueIfid = 'pt-ifid-' + Date.now();
      const record: PlaythroughRecord = {
        id: 'pt-1',
        ifid: uniqueIfid,
        createdAt: new Date().toISOString(),
        label: 'Playthrough 1',
      };
      await putPlaythrough(record);
      const results = await getPlaythroughsByIfid(uniqueIfid);
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe('pt-1');
      expect(results[0]!.label).toBe('Playthrough 1');
    });

    it('filters playthroughs by ifid', async () => {
      const ifid1 = 'pt-filter-1-' + Date.now();
      const ifid2 = 'pt-filter-2-' + Date.now();
      await putPlaythrough({
        id: 'pf1',
        ifid: ifid1,
        createdAt: new Date().toISOString(),
        label: 'A',
      });
      await putPlaythrough({
        id: 'pf2',
        ifid: ifid2,
        createdAt: new Date().toISOString(),
        label: 'B',
      });
      const results = await getPlaythroughsByIfid(ifid1);
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe('pf1');
    });
  });

  describe('meta (key-value)', () => {
    it('setMeta + getMeta round-trips', async () => {
      await setMeta('testKey', 'testValue');
      const result = await getMeta<string>('testKey');
      expect(result).toBe('testValue');
    });

    it('getMeta returns undefined for missing key', async () => {
      const result = await getMeta('nonexistent-key-' + Date.now());
      expect(result).toBeUndefined();
    });

    it('setMeta overwrites existing value', async () => {
      const key = 'overwrite-key-' + Date.now();
      await setMeta(key, 'first');
      await setMeta(key, 'second');
      const result = await getMeta<string>(key);
      expect(result).toBe('second');
    });

    it('supports complex values', async () => {
      const key = 'complex-' + Date.now();
      const value = { nested: { data: [1, 2, 3] } };
      await setMeta(key, value);
      const result = await getMeta<typeof value>(key);
      expect(result).toEqual(value);
    });
  });
});
