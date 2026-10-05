// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { getBackend, resetBackend } from '../../src/saves/storage';
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
    await saveTo('slot-1', { day: 3 });
    const file = JSON.stringify(await Story.exportSave('slot-1'));

    const info = await Story.importSave(JSON.parse(file), 'slot-2');
    expect(info).toMatchObject({
      slot: 'slot-2',
      passage: 'Start',
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
});
