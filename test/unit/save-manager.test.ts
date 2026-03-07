import { describe, it, expect, beforeEach } from 'vitest';
import {
  initSaveSystem,
  startNewPlaythrough,
  getCurrentPlaythroughId,
  createSave,
  overwriteSave,
  loadSave,
  deleteSaveById,
  renameSave,
  getSavesGrouped,
  quickSave,
  hasQuickSave,
  loadQuickSave,
  exportSave,
  importSave,
  setTitleGenerator,
  setSaveTitlePassage,
} from '../../src/saves/save-manager';
import type { SavePayload } from '../../src/saves/types';

// In Node there's no IndexedDB, so idb.ts uses in-memory fallback.
// We need to reset the fallback between tests by re-importing.
// Since the fallback store is module-scoped, we'll just work with it.

const IFID = 'test-ifid-save';

function makePayload(overrides: Partial<SavePayload> = {}): SavePayload {
  return {
    passage: 'Start',
    variables: { hp: 100 },
    history: [
      {
        passage: 'Start',
        variables: { hp: 100 },
        timestamp: Date.now(),
      },
    ],
    historyIndex: 0,
    visitCounts: { Start: 1 },
    renderCounts: { Start: 1 },
    ...overrides,
  };
}

describe('save-manager', () => {
  let playthroughId: string;

  beforeEach(async () => {
    await initSaveSystem();
    playthroughId = await startNewPlaythrough(IFID);
  });

  describe('initSaveSystem', () => {
    it('can be called multiple times safely', async () => {
      await initSaveSystem();
      await initSaveSystem();
    });
  });

  describe('playthroughs', () => {
    it('creates a new playthrough and returns its id', () => {
      expect(typeof playthroughId).toBe('string');
      expect(playthroughId.length).toBeGreaterThan(0);
    });

    it('getCurrentPlaythroughId returns the latest id', async () => {
      const id = await getCurrentPlaythroughId(IFID);
      expect(id).toBe(playthroughId);
    });

    it('assigns incrementing labels', async () => {
      const id2 = await startNewPlaythrough(IFID);
      expect(id2).not.toBe(playthroughId);
    });
  });

  describe('createSave / loadSave', () => {
    it('creates a save and loads it back', async () => {
      const payload = makePayload();
      const record = await createSave(IFID, playthroughId, payload);

      expect(record.meta.ifid).toBe(IFID);
      expect(record.meta.playthroughId).toBe(playthroughId);
      expect(record.meta.passage).toBe('Start');
      expect(typeof record.meta.id).toBe('string');
      expect(typeof record.meta.title).toBe('string');

      const loaded = await loadSave(record.meta.id);
      expect(loaded).toBeDefined();
      expect(loaded!.passage).toBe('Start');
      expect(loaded!.variables.hp).toBe(100);
      expect(loaded!.historyIndex).toBe(0);
    });

    it('creates save with custom metadata', async () => {
      const payload = makePayload();
      const record = await createSave(IFID, playthroughId, payload, {
        chapter: 3,
      });
      expect(record.meta.custom.chapter).toBe(3);
    });

    it('loadSave returns undefined for nonexistent id', async () => {
      const loaded = await loadSave('nonexistent-id');
      expect(loaded).toBeUndefined();
    });
  });

  describe('overwriteSave', () => {
    it('overwrites an existing save', async () => {
      const payload1 = makePayload({ passage: 'Start' });
      const record = await createSave(IFID, playthroughId, payload1);

      const payload2 = makePayload({ passage: 'Room', variables: { hp: 50 } });
      const updated = await overwriteSave(record.meta.id, payload2);

      expect(updated).toBeDefined();
      expect(updated!.meta.passage).toBe('Room');
      expect(updated!.meta.id).toBe(record.meta.id);

      const loaded = await loadSave(record.meta.id);
      expect(loaded!.passage).toBe('Room');
      expect(loaded!.variables.hp).toBe(50);
    });

    it('returns undefined for nonexistent save', async () => {
      const result = await overwriteSave('nonexistent', makePayload());
      expect(result).toBeUndefined();
    });
  });

  describe('deleteSaveById', () => {
    it('deletes an existing save', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      await deleteSaveById(record.meta.id);
      const loaded = await loadSave(record.meta.id);
      expect(loaded).toBeUndefined();
    });
  });

  describe('renameSave', () => {
    it('renames an existing save', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      await renameSave(record.meta.id, 'My Custom Name');

      const loaded = await loadSave(record.meta.id);
      expect(loaded).toBeDefined();

      // Verify via getSavesGrouped that the rename took effect
      const groups = await getSavesGrouped(IFID);
      const allSaves = groups.flatMap((g) => g.saves);
      const renamed = allSaves.find((s) => s.meta.id === record.meta.id);
      expect(renamed?.meta.title).toBe('My Custom Name');
    });

    it('does nothing for nonexistent save', async () => {
      await renameSave('nonexistent', 'Whatever');
      // Should not throw
    });
  });

  describe('getSavesGrouped', () => {
    it('returns empty groups for no saves', async () => {
      const freshIfid = 'fresh-ifid-' + Date.now();
      await startNewPlaythrough(freshIfid);
      const groups = await getSavesGrouped(freshIfid);
      // There should be at least one group (the playthrough) even with no saves
      expect(groups.length).toBeGreaterThanOrEqual(1);
      expect(groups[0]!.saves).toHaveLength(0);
    });

    it('groups saves by playthrough', async () => {
      await createSave(IFID, playthroughId, makePayload());
      await createSave(IFID, playthroughId, makePayload({ passage: 'Room' }));

      const groups = await getSavesGrouped(IFID);
      const myGroup = groups.find((g) => g.playthrough.id === playthroughId);
      expect(myGroup).toBeDefined();
      expect(myGroup!.saves.length).toBeGreaterThanOrEqual(2);
    });

    it('sorts saves newest-first within group', async () => {
      await createSave(IFID, playthroughId, makePayload({ passage: 'First' }));
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await createSave(IFID, playthroughId, makePayload({ passage: 'Second' }));

      const groups = await getSavesGrouped(IFID);
      const myGroup = groups.find((g) => g.playthrough.id === playthroughId);
      expect(myGroup).toBeDefined();
      const saves = myGroup!.saves;
      if (saves.length >= 2) {
        const t0 = new Date(saves[0]!.meta.updatedAt).getTime();
        const t1 = new Date(saves[1]!.meta.updatedAt).getTime();
        expect(t0).toBeGreaterThanOrEqual(t1);
      }
    });
  });

  describe('quickSave / hasQuickSave / loadQuickSave', () => {
    it('hasQuickSave returns false initially', async () => {
      const freshIfid = 'quick-' + Date.now();
      expect(await hasQuickSave(freshIfid)).toBe(false);
    });

    it('quickSave creates a save', async () => {
      const freshIfid = 'quicksave-' + Date.now();
      const ptId = await startNewPlaythrough(freshIfid);
      const payload = makePayload();
      const record = await quickSave(freshIfid, ptId, payload);
      expect(record.meta.ifid).toBe(freshIfid);
    });

    it('hasQuickSave returns true after quickSave', async () => {
      const freshIfid = 'quickhas-' + Date.now();
      const ptId = await startNewPlaythrough(freshIfid);
      await quickSave(freshIfid, ptId, makePayload());
      expect(await hasQuickSave(freshIfid)).toBe(true);
    });

    it('loadQuickSave returns the payload', async () => {
      const freshIfid = 'quickload-' + Date.now();
      const ptId = await startNewPlaythrough(freshIfid);
      await quickSave(freshIfid, ptId, makePayload({ passage: 'Room' }));
      const loaded = await loadQuickSave(freshIfid);
      expect(loaded).toBeDefined();
      expect(loaded!.passage).toBe('Room');
    });

    it('loadQuickSave returns undefined when no save', async () => {
      const loaded = await loadQuickSave('no-save-ifid-' + Date.now());
      expect(loaded).toBeUndefined();
    });

    it('quickSave overwrites existing quicksave', async () => {
      const freshIfid = 'quickoverwrite-' + Date.now();
      const ptId = await startNewPlaythrough(freshIfid);
      await quickSave(freshIfid, ptId, makePayload({ passage: 'Start' }));
      await quickSave(
        freshIfid,
        ptId,
        makePayload({ passage: 'Room', variables: { hp: 50 } }),
      );
      const loaded = await loadQuickSave(freshIfid);
      expect(loaded!.passage).toBe('Room');
      expect(loaded!.variables.hp).toBe(50);
    });
  });

  describe('exportSave / importSave', () => {
    it('exports a save as SaveExport', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);
      expect(exported).toBeDefined();
      expect(exported!.version).toBe(1);
      expect(exported!.ifid).toBe(IFID);
      expect(exported!.save.meta.id).toBe(record.meta.id);
    });

    it('export contains exportedAt timestamp', async () => {
      const before = new Date().toISOString();
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);
      const after = new Date().toISOString();
      expect(exported!.exportedAt).toBeDefined();
      expect(exported!.exportedAt >= before).toBe(true);
      expect(exported!.exportedAt <= after).toBe(true);
    });

    it('export contains full save record with meta and payload', async () => {
      const payload = makePayload({
        passage: 'Room',
        variables: { hp: 42, name: 'Hero' },
      });
      const record = await createSave(IFID, playthroughId, payload);
      const exported = await exportSave(record.meta.id);
      expect(exported!.save.meta.passage).toBe('Room');
      expect(exported!.save.payload.passage).toBe('Room');
      expect(exported!.save.payload.historyIndex).toBe(0);
      expect(exported!.save.payload.history).toHaveLength(1);
    });

    it('exportSave returns undefined for nonexistent id', async () => {
      const result = await exportSave('nonexistent');
      expect(result).toBeUndefined();
    });

    it('export is valid JSON (round-trips through stringify/parse)', async () => {
      const payload = makePayload({
        passage: 'Room',
        variables: { hp: 100, items: ['sword', 'shield'], nested: { a: 1 } },
      });
      const record = await createSave(IFID, playthroughId, payload);
      const exported = await exportSave(record.meta.id);

      const json = JSON.stringify(exported, null, 2);
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(1);
      expect(parsed.ifid).toBe(IFID);
      expect(parsed.save.meta.id).toBe(record.meta.id);
      expect(parsed.save.payload.passage).toBe('Room');
    });

    it('imports a save and assigns a new unique ID', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);

      const imported = await importSave(exported!, IFID);
      expect(imported.meta.id).not.toBe(record.meta.id);
      expect(typeof imported.meta.id).toBe('string');
      expect(imported.meta.id.length).toBeGreaterThan(0);
      expect(imported.meta.ifid).toBe(IFID);
    });

    it('imported save updates updatedAt timestamp', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);
      const originalUpdatedAt = exported!.save.meta.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      const imported = await importSave(exported!, IFID);
      expect(imported.meta.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('imported save preserves original payload data', async () => {
      const payload = makePayload({
        passage: 'Room',
        variables: { gold: 999, name: 'Hero' },
      });
      const record = await createSave(IFID, playthroughId, payload);
      const exported = await exportSave(record.meta.id);

      const imported = await importSave(exported!, IFID);
      const loaded = await loadSave(imported.meta.id);
      expect(loaded).toBeDefined();
      expect(loaded!.passage).toBe('Room');
      expect(loaded!.variables.gold).toBe(999);
      expect(loaded!.variables.name).toBe('Hero');
    });

    it('imported save preserves history', async () => {
      const payload = makePayload({
        passage: 'End',
        history: [
          { passage: 'Start', variables: { hp: 100 }, timestamp: 1000 },
          { passage: 'Room', variables: { hp: 80 }, timestamp: 2000 },
          { passage: 'End', variables: { hp: 60 }, timestamp: 3000 },
        ],
        historyIndex: 2,
      });
      const record = await createSave(IFID, playthroughId, payload);
      const exported = await exportSave(record.meta.id);
      const imported = await importSave(exported!, IFID);
      const loaded = await loadSave(imported.meta.id);
      expect(loaded!.history).toHaveLength(3);
      expect(loaded!.historyIndex).toBe(2);
      expect(loaded!.history[0]!.passage).toBe('Start');
      expect(loaded!.history[2]!.passage).toBe('End');
    });

    it('imported save preserves visitCounts and renderCounts', async () => {
      const payload = makePayload({
        visitCounts: { Start: 3, Room: 2, End: 1 },
        renderCounts: { Start: 5, Room: 3, End: 1 },
      });
      const record = await createSave(IFID, playthroughId, payload);
      const exported = await exportSave(record.meta.id);

      // JSON round-trip to simulate file export/import
      const json = JSON.stringify(exported);
      const parsed = JSON.parse(json);
      const imported = await importSave(parsed, IFID);
      const loaded = await loadSave(imported.meta.id);
      expect(loaded!.visitCounts).toEqual({ Start: 3, Room: 2, End: 1 });
      expect(loaded!.renderCounts).toEqual({ Start: 5, Room: 3, End: 1 });
    });

    it('full export-JSON-import round-trip preserves all data', async () => {
      const payload = makePayload({
        passage: 'Boss Room',
        variables: { hp: 42, items: ['potion', 'key'], flags: { seen: true } },
        history: [
          { passage: 'Start', variables: { hp: 100 }, timestamp: 1 },
          { passage: 'Boss Room', variables: { hp: 42 }, timestamp: 2 },
        ],
        historyIndex: 1,
        visitCounts: { Start: 1, 'Boss Room': 1 },
        renderCounts: { Start: 2, 'Boss Room': 1 },
      });
      const record = await createSave(IFID, playthroughId, payload, {
        chapter: 5,
        difficulty: 'hard',
      });
      const exported = await exportSave(record.meta.id);

      // Simulate writing to file and reading back
      const fileContent = JSON.stringify(exported);
      const fromFile = JSON.parse(fileContent);

      const imported = await importSave(fromFile, IFID);
      expect(imported.meta.ifid).toBe(IFID);
      expect(imported.meta.id).not.toBe(record.meta.id);

      const loaded = await loadSave(imported.meta.id);
      expect(loaded!.passage).toBe('Boss Room');
      expect(loaded!.variables.hp).toBe(42);
      expect(loaded!.variables.items).toEqual(['potion', 'key']);
      expect(loaded!.variables.flags).toEqual({ seen: true });
      expect(loaded!.history).toHaveLength(2);
      expect(loaded!.historyIndex).toBe(1);
    });

    it('import throws on wrong version', async () => {
      const data = {
        version: 99 as any,
        ifid: IFID,
        exportedAt: new Date().toISOString(),
        save: { meta: {}, payload: {} },
      };
      await expect(importSave(data as any, IFID)).rejects.toThrow(
        'Unsupported save version',
      );
    });

    it('import throws on wrong IFID', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);
      await expect(importSave(exported!, 'wrong-ifid')).rejects.toThrow(
        'different story',
      );
    });

    it('import throws descriptive error with expected vs got IFID', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);
      try {
        await importSave(exported!, 'my-other-story');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('my-other-story');
        expect((err as Error).message).toContain(IFID);
      }
    });

    it('import creates playthrough if missing', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);

      const freshIfid = 'import-pt-' + Date.now();
      const modified = {
        ...exported!,
        ifid: freshIfid,
        save: {
          ...exported!.save,
          meta: { ...exported!.save.meta, ifid: freshIfid },
        },
      };
      const imported = await importSave(modified as any, freshIfid);
      expect(imported.meta.ifid).toBe(freshIfid);

      // Verify the playthrough was created
      const groups = await getSavesGrouped(freshIfid);
      expect(groups.length).toBeGreaterThanOrEqual(1);
      const importedGroup = groups.find((g) =>
        g.saves.some((s) => s.meta.id === imported.meta.id),
      );
      expect(importedGroup).toBeDefined();
      expect(importedGroup!.playthrough.label).toBe('Imported');
    });

    it('import reuses existing playthrough if it matches', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);

      // Import back into the same IFID — the playthrough already exists
      const imported = await importSave(exported!, IFID);
      const groups = await getSavesGrouped(IFID);
      const ptGroup = groups.find((g) =>
        g.saves.some((s) => s.meta.id === imported.meta.id),
      );
      expect(ptGroup).toBeDefined();
      // Should reuse the existing playthrough, not create "Imported"
      expect(ptGroup!.playthrough.label).not.toBe('Imported');
    });

    it('multiple imports create distinct saves', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      const exported = await exportSave(record.meta.id);

      const imported1 = await importSave(exported!, IFID);
      const imported2 = await importSave(exported!, IFID);
      expect(imported1.meta.id).not.toBe(imported2.meta.id);

      // Both should be loadable
      const loaded1 = await loadSave(imported1.meta.id);
      const loaded2 = await loadSave(imported2.meta.id);
      expect(loaded1).toBeDefined();
      expect(loaded2).toBeDefined();
    });
  });

  describe('title generation', () => {
    it('generates default title with passage name', async () => {
      const record = await createSave(IFID, playthroughId, makePayload());
      expect(record.meta.title).toContain('Start');
    });

    it('uses custom title generator', async () => {
      setTitleGenerator((payload) => `Save at ${payload.passage}`);
      const record = await createSave(IFID, playthroughId, makePayload());
      expect(record.meta.title).toBe('Save at Start');
      setTitleGenerator(null as any); // reset
    });

    it('uses SaveTitle passage content', async () => {
      setSaveTitlePassage('return "Chapter " + variables.chapter');
      const payload = makePayload();
      payload.variables = { chapter: 5 };
      const record = await createSave(IFID, playthroughId, payload);
      expect(record.meta.title).toBe('Chapter 5');
      setSaveTitlePassage(null as any); // reset
    });

    it('falls back to default if SaveTitle throws', async () => {
      setSaveTitlePassage('throw new Error("oops")');
      const record = await createSave(IFID, playthroughId, makePayload());
      expect(record.meta.title).toContain('Start');
      setSaveTitlePassage(null as any); // reset
    });

    it('falls back to default if titleGenerator throws', async () => {
      setTitleGenerator(() => {
        throw new Error('oops');
      });
      const record = await createSave(IFID, playthroughId, makePayload());
      expect(record.meta.title).toContain('Start');
      setTitleGenerator(null as any); // reset
    });

    it('falls back if titleGenerator returns empty string', async () => {
      setTitleGenerator(() => '  ');
      const record = await createSave(IFID, playthroughId, makePayload());
      expect(record.meta.title).toContain('Start');
      setTitleGenerator(null as any); // reset
    });
  });
});
