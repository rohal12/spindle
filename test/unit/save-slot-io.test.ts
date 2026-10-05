// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { getBackend, resetBackend } from '../../src/saves/storage';
import { populateKnownSaves } from '../../src/saves/save-manager';
import type { StoryData, Passage } from '../../src/parser';
import type { SaveExport } from '../../src/saves/types';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

let ifidCounter = 0;

function makeStoryData(ifid: string): StoryData {
  const passages = [
    makePassage(1, 'Start', 'Hello'),
    makePassage(2, 'Room', 'A room'),
  ];
  return {
    name: 'Slot IO',
    startNode: 1,
    ifid,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

/**
 * Run the suite once per storage backend. Spindle picks IndexedDB, then
 * localStorage, then memory; happy-dom has no IndexedDB, so hiding
 * localStorage as well forces the memory backend.
 */
const BACKENDS = [
  { name: 'localstorage', hide: [] as string[] },
  { name: 'memory', hide: ['localStorage'] },
] as const;

describe.each(BACKENDS)('Story.exportSave / importSave ($name)', (backend) => {
  let Story: StoryAPI;
  let ifid: string;

  async function saveTo(slot?: string, custom?: Record<string, unknown>) {
    Story.save(slot, custom);
    await vi.waitFor(() => expect(Story.hasSave(slot)).toBe(true));
  }

  beforeEach(async () => {
    for (const key of backend.hide) vi.stubGlobal(key, undefined);
    resetBackend();
    expect((await getBackend()).type).toBe(backend.name);

    _resetRuntimePhase();
    ifid = `slot-io-${backend.name}-${++ifidCounter}`;
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    useStoryStore.getState().init(makeStoryData(ifid), { hp: 100 });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );

    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetBackend();
  });

  it('exports a slot as a portable SaveExport', async () => {
    Story.set('hp', 42);
    await saveTo('slot-1', { day: 3 });

    const data = await Story.exportSave('slot-1');
    expect(data).not.toBeNull();
    expect(data!.version).toBe(1);
    expect(data!.ifid).toBe(ifid);
    expect(data!.save.meta.custom).toMatchObject({ day: 3, slot: 'slot-1' });
    expect(data!.save.payload.variables).toEqual({ hp: 42 });

    // Plain JSON: survives a file round-trip unchanged
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('exportSave resolves to null for an empty slot', async () => {
    expect(await Story.exportSave('nothing-here')).toBeNull();
    expect(await Story.exportSave()).toBeNull();
  });

  it('imports into an empty slot and the slot loads', async () => {
    Story.set('hp', 42);
    // Recorded on entering Room, which is what a load restores
    Story.goto('Room');
    await saveTo('slot-1', { day: 3 });
    const file = JSON.stringify(await Story.exportSave('slot-1'));

    const info = await Story.importSave(JSON.parse(file), 'slot-2');
    expect(info).toMatchObject({
      slot: 'slot-2',
      passage: 'Room',
      custom: { day: 3, slot: 'slot-2', isAutosave: false },
    });

    // Known-saves index and slot listing are up to date
    expect(Story.hasSave('slot-2')).toBe(true);
    const listed = await Story.listSaves();
    expect(listed.map((s) => s.slot).sort()).toEqual(['slot-1', 'slot-2']);
    expect(await Story.getSaveInfo('slot-2')).toEqual(info);

    // Loading the imported slot restores its state
    Story.set('hp', 1);
    Story.load('slot-2');
    await vi.waitFor(() => expect(Story.get('hp')).toBe(42));
  });

  it('replaces the save already in the target slot', async () => {
    Story.set('hp', 10);
    await saveTo('slot-1');
    Story.set('hp', 20);
    await saveTo('slot-2');
    const before = await (await getBackend()).getSavesByIfid(ifid);

    const data = await Story.exportSave('slot-1');
    await Story.importSave(data, 'slot-2');

    const after = await (await getBackend()).getSavesByIfid(ifid);
    expect(after).toHaveLength(before.length);
    expect((await Story.exportSave('slot-2'))!.save.payload.variables).toEqual({
      hp: 10,
    });
  });

  it('imports into the default slot', async () => {
    await saveTo();
    const data = await Story.exportSave();
    Story.deleteSave();
    await vi.waitFor(() => expect(Story.hasSave()).toBe(false));

    const info = await Story.importSave(data);
    expect(info.slot).toBe('');
    expect(info.custom).toMatchObject({ isAutosave: true });
    expect(info.custom).not.toHaveProperty('slot');
    expect(Story.hasSave()).toBe(true);
  });

  it('rejects saves from another story and leaves the slot alone', async () => {
    await saveTo('slot-1');
    const data = (await Story.exportSave('slot-1'))!;
    const foreign: SaveExport = {
      ...data,
      ifid: 'some-other-story',
      save: {
        ...data.save,
        meta: { ...data.save.meta, ifid: 'some-other-story' },
      },
    };

    await expect(Story.importSave(foreign, 'slot-9')).rejects.toThrow(
      /different story/,
    );
    expect(Story.hasSave('slot-9')).toBe(false);
    expect(await Story.getSaveInfo('slot-9')).toBeNull();
  });

  it('rejects data that is not a save export', async () => {
    await expect(
      Story.importSave({ hello: 'world' }, 'slot-1'),
    ).rejects.toThrow('Invalid save file format');
    await expect(Story.importSave(null, 'slot-1')).rejects.toThrow(
      'Invalid save file format',
    );
    expect(Story.hasSave('slot-1')).toBe(false);
  });

  it('rejects malformed history and keeps the save it would replace', async () => {
    // Loads restore the moment's entry snapshot, so set hp before entering
    Story.set('hp', 42);
    Story.goto('Room');
    await saveTo('slot-1');
    const before = await Story.getSaveInfo('slot-1');
    const data = (await Story.exportSave('slot-1'))!;
    const malformed = structuredClone(data);
    (malformed.save.payload as { history: unknown[] }).history = [null];

    await expect(Story.importSave(malformed, 'slot-1')).rejects.toThrow(
      'Invalid save file format',
    );
    expect(await Story.getSaveInfo('slot-1')).toEqual(before);
    Story.set('hp', 1);
    await expect(Story.load('slot-1')).resolves.toBeUndefined();
    expect(Story.get('hp')).toBe(42);
    expect(Story.passage).toBe('Room');
  });

  it.each([
    ['the live variables', 'variables'],
    ['a history moment', 'history'],
  ])(
    'rejects a malformed encoded value in %s and keeps the save it would replace',
    async (_, where) => {
      Story.set('hp', 42);
      Story.goto('Room');
      await saveTo('slot-1');
      const before = await Story.getSaveInfo('slot-1');
      const data = (await Story.exportSave('slot-1'))!;
      const malformed = structuredClone(data);
      const bad = {
        __spindle_class__: '__Map__',
        __spindle_data__: { entries: 42 },
      };
      const payload = malformed.save.payload;
      if (where === 'variables') payload.variables.inventory = bad;
      else payload.history[0]!.variables.inventory = bad;

      await expect(Story.importSave(malformed, 'slot-1')).rejects.toThrow(
        'Invalid save file format',
      );
      expect(await Story.getSaveInfo('slot-1')).toEqual(before);
      Story.set('hp', 1);
      await expect(Story.load('slot-1')).resolves.toBeUndefined();
      expect(Story.get('hp')).toBe(42);
      expect(Story.passage).toBe('Room');
    },
  );

  it('rejects an out-of-range history index', async () => {
    await saveTo('slot-1');
    const data = (await Story.exportSave('slot-1'))!;
    const malformed = structuredClone(data);
    malformed.save.payload.historyIndex = 5;

    await expect(Story.importSave(malformed, 'slot-2')).rejects.toThrow(
      'Invalid save file format',
    );
    expect(Story.hasSave('slot-2')).toBe(false);
  });

  it.each([
    ['the default slot', undefined],
    ['a named slot', 'slot-1'],
  ])(
    'a save to %s after restart belongs to the new playthrough',
    async (_, slot) => {
      Story.set('hp', 10);
      await saveTo(slot);
      const oldPt = useStoryStore.getState().playthroughId;

      Story.restart();
      await vi.waitFor(() =>
        expect(useStoryStore.getState().playthroughId).not.toBe(oldPt),
      );
      const newPt = useStoryStore.getState().playthroughId;
      Story.set('hp', 20);
      Story.goto('Room');
      await Story.save(slot);

      const data = (await Story.exportSave(slot))!;
      expect(data.save.meta.playthroughId).toBe(newPt);

      // Deleting the old playthrough keeps the new game's save
      await Story.storage.deletePlaythrough(oldPt);
      expect(Story.hasSave(slot)).toBe(true);
      Story.set('hp', 1);
      await Story.load(slot);
      expect(Story.get('hp')).toBe(20);
      expect(Story.passage).toBe('Room');
    },
  );

  it('creates an "Imported" playthrough for an unknown playthrough', async () => {
    await saveTo('slot-1');
    const data = (await Story.exportSave('slot-1'))!;
    data.save.meta.playthroughId = 'playthrough-from-another-browser';

    await Story.importSave(data, 'slot-2');

    const playthroughs = await (await getBackend()).getPlaythroughsByIfid(ifid);
    expect(
      playthroughs.find((p) => p.id === 'playthrough-from-another-browser'),
    ).toMatchObject({ label: 'Imported' });
  });

  it("addresses the default save by the slot '' its SaveInfo reports", async () => {
    Story.set('hp', 42);
    // Recorded on entering Room, which is what a load restores
    Story.goto('Room');
    await saveTo();
    const info = (await Story.getSaveInfo())!;
    expect(info.slot).toBe('');

    // Lookup and listing
    expect(await Story.getSaveInfo(info.slot)).toEqual(info);
    expect(Story.hasSave(info.slot)).toBe(true);
    expect(await Story.listSaves()).toEqual([info]);

    // Export
    const data = (await Story.exportSave(info.slot))!;
    expect(data).not.toBeNull();
    expect(data.save.meta.id).toBe((await Story.exportSave())!.save.meta.id);

    // Load
    Story.set('hp', 1);
    Story.load(info.slot);
    await vi.waitFor(() => expect(Story.get('hp')).toBe(42));

    // Save into '' overwrites the default save instead of creating a slot
    Story.set('hp', 7);
    Story.save(info.slot);
    await vi.waitFor(async () =>
      expect((await Story.exportSave())!.save.payload.variables).toMatchObject({
        hp: 7,
      }),
    );
    expect((await Story.listSaves()).map((s) => s.slot)).toEqual(['']);

    // Import into '' replaces the default save
    const imported = await Story.importSave(data, info.slot);
    expect(imported.slot).toBe('');
    expect(imported.custom).toMatchObject({ isAutosave: true });
    expect(imported.custom).not.toHaveProperty('slot');
    expect((await Story.exportSave())!.save.payload.variables).toEqual({
      hp: 42,
    });
    expect((await Story.listSaves()).map((s) => s.slot)).toEqual(['']);

    // Delete
    Story.deleteSave(info.slot);
    await vi.waitFor(() => expect(Story.hasSave()).toBe(false));
    expect(await Story.getSaveInfo()).toBeNull();
    expect(await Story.listSaves()).toEqual([]);
  });

  it('round-trips every listed slot through lookup, export, import and delete', async () => {
    await saveTo();
    await saveTo('slot-1');
    const listed = await Story.listSaves();
    expect(listed.map((s) => s.slot).sort()).toEqual(['', 'slot-1']);

    for (const info of listed) {
      expect(await Story.getSaveInfo(info.slot)).toEqual(info);
      const data = (await Story.exportSave(info.slot))!;
      expect(data).not.toBeNull();
      expect((await Story.importSave(data, info.slot)).slot).toBe(info.slot);
    }
    expect((await Story.listSaves()).map((s) => s.slot).sort()).toEqual([
      '',
      'slot-1',
    ]);

    for (const info of listed) Story.deleteSave(info.slot);
    await vi.waitFor(async () => expect(await Story.listSaves()).toEqual([]));
  });

  it('agrees with storage for slot names found on Object.prototype', async () => {
    expect(Story.hasSave('constructor')).toBe(false);
    expect(await Story.getSaveInfo('constructor')).toBeNull();
    expect(Story.hasSave('toString')).toBe(false);
    expect(await Story.getSaveInfo('toString')).toBeNull();

    await Story.save('constructor');
    await Story.save('__proto__');
    expect(Story.hasSave('constructor')).toBe(true);
    expect(Story.hasSave('__proto__')).toBe(true);
    expect(Story.hasSave('toString')).toBe(false);

    // After a reload, known saves are rebuilt from the slot index
    const known = await populateKnownSaves(ifid);
    expect(Object.keys(known).sort()).toEqual(['__proto__', 'constructor']);
    expect(Object.prototype.hasOwnProperty.call(known, 'toString')).toBe(false);

    await Story.deleteSave('__proto__');
    expect(Story.hasSave('__proto__')).toBe(false);
    expect(Story.hasSave('constructor')).toBe(true);
  });

  it('indexes every slot when saving to new slots concurrently', async () => {
    Story.save('parallel-a');
    Story.save('parallel-b');
    Story.save('parallel-c');
    await vi.waitFor(() => {
      expect(Story.hasSave('parallel-a')).toBe(true);
      expect(Story.hasSave('parallel-b')).toBe(true);
      expect(Story.hasSave('parallel-c')).toBe(true);
    });

    expect((await Story.listSaves()).map((s) => s.slot).sort()).toEqual([
      'parallel-a',
      'parallel-b',
      'parallel-c',
    ]);
    // After a reload, known saves are rebuilt from the slot index
    expect(await populateKnownSaves(ifid)).toEqual({
      'parallel-a': true,
      'parallel-b': true,
      'parallel-c': true,
    });
  });

  it('indexes every slot when importing into new slots concurrently', async () => {
    await saveTo();
    const data = (await Story.exportSave())!;

    await Promise.all([
      Story.importSave(data, 'import-a'),
      Story.importSave(data, 'import-b'),
      Story.importSave(data, 'import-c'),
    ]);

    expect((await Story.listSaves()).map((s) => s.slot).sort()).toEqual([
      '',
      'import-a',
      'import-b',
      'import-c',
    ]);
    expect(await populateKnownSaves(ifid)).toEqual({
      '': true,
      'import-a': true,
      'import-b': true,
      'import-c': true,
    });
  });

  it('removes every slot from the index when deleting slots concurrently', async () => {
    await saveTo('slot-1');
    await saveTo('slot-2');
    await saveTo('slot-3');

    Story.deleteSave('slot-1');
    Story.deleteSave('slot-2');
    Story.save('slot-4');
    await vi.waitFor(() => {
      expect(Story.hasSave('slot-1')).toBe(false);
      expect(Story.hasSave('slot-2')).toBe(false);
      expect(Story.hasSave('slot-4')).toBe(true);
    });

    const index = await (await getBackend()).getMeta(`slotIndex.${ifid}`);
    expect(index).toEqual(['slot-3', 'slot-4']);
  });
});
