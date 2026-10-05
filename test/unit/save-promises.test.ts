// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import * as saveManager from '../../src/saves/save-manager';
import type { StoryData, Passage } from '../../src/parser';

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
    name: 'Save promises',
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

describe('awaitable Story.save / deleteSave / load', () => {
  let Story: StoryAPI;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    resetEmitter();
    _resetRuntimePhase();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    useStoryStore
      .getState()
      .init(makeStoryData(`save-promises-${++ifidCounter}`), { hp: 100 });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetBackend();
  });

  it('save() resolves after the save is persisted and listed', async () => {
    const after = vi.fn();
    Story.on('aftersave', after);

    await Story.save('slot-1', { day: 2 });

    expect(after).toHaveBeenCalledWith('slot-1');
    expect(Story.hasSave('slot-1')).toBe(true);
    const saves = await Story.listSaves();
    expect(saves.map((s) => s.slot)).toEqual(['slot-1']);
  });

  it('deleteSave() resolves after the save is removed', async () => {
    await Story.save('slot-1');
    await Story.save('slot-2');

    await Story.deleteSave('slot-1');

    expect(Story.hasSave('slot-1')).toBe(false);
    const saves = await Story.listSaves();
    expect(saves.map((s) => s.slot)).toEqual(['slot-2']);
  });

  it('load() resolves after the loaded state is applied', async () => {
    // Loads restore the moment's entry snapshot, so set hp before entering
    Story.set('hp', 42);
    Story.goto('Room');
    await Story.save('slot-1');
    Story.set('hp', 1);
    Story.goto('Start');

    await Story.load('slot-1');

    expect(Story.get('hp')).toBe(42);
    expect(Story.passage).toBe('Room');
  });

  // Found by the save model property test (test/property/saves-model)
  it('deleting the current playthrough moves the game to a new one', async () => {
    const ifid = useStoryStore.getState().storyData!.ifid;
    const old = useStoryStore.getState().playthroughId;
    await Story.save('slot-1');

    await Story.storage.deletePlaythrough(old);
    const current = useStoryStore.getState().playthroughId;
    expect(current).not.toBe(old);
    expect(current).not.toBe('');
    expect(Story.hasSave('slot-1')).toBe(false);

    // Later saves belong to the new playthrough, not to a deleted one
    await Story.save('slot-2');
    const groups = await saveManager.getSavesGrouped(ifid);
    expect(
      groups.map((g) => [
        g.playthrough.id,
        g.playthrough.label,
        g.saves.length,
      ]),
    ).toEqual([[current, 'Playthrough 2', 1]]);
  });

  it('load() of an empty slot resolves without changing state', async () => {
    Story.set('hp', 7);
    await expect(Story.load('nothing-here')).resolves.toBeUndefined();
    expect(Story.get('hp')).toBe(7);
  });

  it('save() rejects when persisting fails, and still records saveError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(saveManager, 'quickSave').mockRejectedValueOnce(
      new Error('disk full'),
    );

    await expect(Story.save('slot-1')).rejects.toThrow('disk full');
    expect(useStoryStore.getState().saveError).toBe('disk full');
    expect(Story.hasSave('slot-1')).toBe(false);
  });

  it('save() rejects when a beforesave hook throws, and records saveError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    Story.on('beforesave', () => {
      throw new Error('hook failed');
    });
    Story.on('aftersave', after);

    let pending: Promise<void> | undefined;
    expect(() => {
      pending = Story.save('slot-1');
    }).not.toThrow();

    await expect(pending).rejects.toThrow('hook failed');
    expect(useStoryStore.getState().saveError).toBe('hook failed');
    expect(after).not.toHaveBeenCalled();
    expect(Story.hasSave('slot-1')).toBe(false);
    expect(await Story.listSaves()).toEqual([]);
  });

  it('save() rejects when capturing the payload throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSavePayload } = useStoryStore.getState();
    useStoryStore.setState({
      getSavePayload: () => {
        throw new Error('cannot serialize');
      },
    });
    try {
      let pending: Promise<void> | undefined;
      expect(() => {
        pending = Story.save('slot-1');
      }).not.toThrow();

      await expect(pending).rejects.toThrow('cannot serialize');
      expect(useStoryStore.getState().saveError).toBe('cannot serialize');
    } finally {
      useStoryStore.setState({ getSavePayload });
    }
  });

  it('beforesave still runs before the payload is captured', async () => {
    Story.on('beforesave', () => Story.set('hp', 55));
    await Story.save('slot-1');

    const data = await Story.exportSave('slot-1');
    expect(data!.save.payload.variables.hp).toBe(55);
  });

  it('an ignored failing save does not cause an unhandled rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(saveManager, 'quickSave').mockRejectedValueOnce(
      new Error('disk full'),
    );
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      Story.save('slot-1'); // not awaited
      await vi.waitFor(() =>
        expect(useStoryStore.getState().saveError).toBe('disk full'),
      );
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

// Shrunk counterexamples of the save race property test
// (test/property/saves-race): storage operations issued together, without
// awaiting, take effect in the order they were called.
describe('storage operations run in call order', () => {
  let Story: StoryAPI;
  let ifid: string;

  function boot(): void {
    resetEmitter();
    _resetRuntimePhase();
    useStoryStore.getState().init(makeStoryData(ifid), { hp: 100 });
  }

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    ifid = `save-order-${++ifidCounter}`;
    boot();
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetBackend();
  });

  it('a delete issued right after a save deletes it', async () => {
    const saved = Story.save('b');
    const deleted = Story.deleteSave('b');
    await Promise.all([saved, deleted]);

    expect(Story.hasSave('b')).toBe(false);
    expect(await Story.listSaves()).toEqual([]);
  });

  it('a load issued right after a save loads it', async () => {
    Story.set('hp', 7);
    Story.goto('Room');
    const saved = Story.save();
    Story.goto('Start');
    const loaded = Story.load();
    await Promise.all([saved, loaded]);

    expect(Story.passage).toBe('Room');
    expect(Story.get('hp')).toBe(7);
  });

  it('a rename issued during an overwrite keeps both', async () => {
    await Story.save('a');
    const id = (await Story.exportSave('a'))!.save.meta.id;
    // Hold the overwrite's read of the record until the rename has run
    const backend = await getBackend();
    const getSave = backend.getSave.bind(backend);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.spyOn(backend, 'getSave').mockImplementationOnce(async (saveId) => {
      const record = await getSave(saveId);
      await held;
      return record;
    });

    Story.goto('Room');
    const saved = Story.save('a');
    const renamed = saveManager.renameSave(id, 'Mine');
    setTimeout(release, 10);
    await Promise.all([saved, renamed]);

    const data = await Story.exportSave('a');
    expect(data!.save.meta.title).toBe('Mine');
    expect(data!.save.payload.passage).toBe('Room');
  });

  it('clearGameData restarts at once: a save issued after it belongs to the new game', async () => {
    const old = useStoryStore.getState().playthroughId;
    const cleared = Story.storage.clearGameData();
    const current = useStoryStore.getState().playthroughId;
    expect(current).not.toBe(old);
    const saved = Story.save('a');
    await Promise.all([cleared, saved]);

    expect(Story.hasSave('a')).toBe(true);
    const groups = await saveManager.getSavesGrouped(ifid);
    expect(
      groups.map((g) => [
        g.playthrough.id,
        g.playthrough.label,
        g.saves.length,
      ]),
    ).toEqual([[current, 'Playthrough 1', 1]]);
  });

  it('clearGameData deletes a save issued right before it', async () => {
    const saved = Story.save('a');
    const cleared = Story.storage.clearGameData();
    await Promise.all([saved, cleared]);

    expect(Story.hasSave('a')).toBe(false);
    expect(await Story.listSaves()).toEqual([]);
  });

  it('deleting the playthrough a booting game looks up replaces it', async () => {
    await Story.save('a');
    const old = useStoryStore.getState().playthroughId;

    // A page refresh: the store has no playthrough until init looks it up
    boot();
    expect(useStoryStore.getState().playthroughId).toBe('');
    const deleted = Story.storage.deletePlaythrough(old);
    const saved = Story.save('b');
    await Promise.all([deleted, saved]);

    const current = useStoryStore.getState().playthroughId;
    expect(current).not.toBe(old);
    const groups = await saveManager.getSavesGrouped(ifid);
    expect(
      groups.map((g) => [
        g.playthrough.id,
        g.playthrough.label,
        g.saves.map((s) => s.meta.custom.slot),
      ]),
    ).toEqual([[current, 'Playthrough 2', ['b']]]);
  });
});
