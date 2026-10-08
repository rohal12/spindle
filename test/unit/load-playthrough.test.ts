// @vitest-environment happy-dom
/**
 * Loading a save switches the running game to the save's playthrough: saves
 * made after the load are grouped with the loaded one (docs/saves.md,
 * "Playthroughs").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useStoryStore,
  _resetRuntimePhase,
  resolvePlaythroughId,
} from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { executeMutation } from '../../src/execute-mutation';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import {
  decodeSavePayload,
  getSavesGrouped,
  loadSession,
} from '../../src/saves/save-manager';
import type { SaveExport } from '../../src/saves/types';
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
    name: 'Load playthrough',
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

const state = () => useStoryStore.getState();
const g = globalThis as Record<string, unknown>;

describe('loading a save switches to its playthrough', () => {
  let Story: StoryAPI;
  let ifid: string;

  /** Boot the story, as a page load does. */
  function boot(): void {
    resetEmitter();
    _resetRuntimePhase();
    state().init(makeStoryData(ifid), { hp: 100 });
  }

  /** A page refresh: boot again and restore the session. */
  function refresh(): void {
    const session = loadSession(ifid);
    boot();
    if (session) state().loadFromPayload(session);
  }

  /** [playthrough ID, label, slots of its saves] of each group. */
  async function groups(): Promise<[string, string, unknown[]][]> {
    return (await getSavesGrouped(ifid)).map((gr) => [
      gr.playthrough.id,
      gr.playthrough.label,
      gr.saves.map((s) => s.meta.custom.slot ?? '').sort(),
    ]);
  }

  async function groupOf(id: string) {
    return (await groups()).find(([pt]) => pt === id);
  }

  /** Save `slot` in playthrough 1, then restart into playthrough 2. */
  async function saveThenRestart(slot: string): Promise<[string, string]> {
    const first = state().playthroughId;
    Story.set('hp', 42);
    Story.goto('Room');
    await Story.save(slot);
    Story.restart();
    await resolvePlaythroughId();
    return [first, state().playthroughId];
  }

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    sessionStorage.clear();
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    ifid = `load-playthrough-${++ifidCounter}`;
    boot();
    await vi.waitFor(() => expect(state().playthroughId).not.toBe(''));
    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetBackend();
    delete g.saved;
  });

  it('Story.load() switches to the loaded save’s playthrough', async () => {
    const [first, second] = await saveThenRestart('a');
    expect(second).not.toBe(first);

    await Story.load('a');
    expect(state().playthroughId).toBe(first);
    expect(Story.get('hp')).toBe(42);

    // Later saves are grouped with the loaded one
    await Story.save('b');
    expect(await groupOf(first)).toEqual([first, 'Playthrough 1', ['a', 'b']]);
    expect(await groupOf(second)).toEqual([second, 'Playthrough 2', []]);
  });

  it('loading a save of the current playthrough leaves it as it is', async () => {
    await Story.save('a');
    const current = state().playthroughId;
    const before = await groups();
    const info = await Story.storage.getInfo();

    await Story.load('a');
    expect(state().playthroughId).toBe(current);
    expect(await groups()).toEqual(before);
    expect((await Story.storage.getInfo()).playthroughCount).toBe(
      info.playthroughCount,
    );
  });

  it('loading an empty slot leaves the playthrough as it is', async () => {
    const current = state().playthroughId;
    await Story.load('nothing-here');
    expect(state().playthroughId).toBe(current);
    await Story.save('a');
    expect(await groupOf(current)).toEqual([current, 'Playthrough 1', ['a']]);
  });

  it('a page refresh after a load stays in the loaded playthrough', async () => {
    const [first] = await saveThenRestart('a');
    await Story.load('a');

    refresh();
    await resolvePlaythroughId();
    expect(state().playthroughId).toBe(first);
    expect(Story.passage).toBe('Room');
    expect(Story.get('hp')).toBe(42);
  });

  it('a dialog load (loadFromPayload with a playthrough) switches to it', async () => {
    const [first, second] = await saveThenRestart('a');
    const data = (await Story.exportSave('a'))!;

    state().loadFromPayload(
      decodeSavePayload(data.save.payload),
      undefined,
      data.save.meta.playthroughId,
    );
    // At once: the payload is at hand
    expect(state().playthroughId).toBe(first);
    await Story.save('b');
    expect(await groupOf(first)).toEqual([first, 'Playthrough 1', ['a', 'b']]);

    // A refresh stays in it
    refresh();
    await resolvePlaythroughId();
    expect(state().playthroughId).toBe(first);
    expect(await groupOf(second)).toEqual([second, 'Playthrough 2', []]);
  });

  it('restoring the session does not switch playthroughs', async () => {
    const [, second] = await saveThenRestart('a');
    refresh();
    await resolvePlaythroughId();
    expect(state().playthroughId).toBe(second);
  });

  describe('in call order', () => {
    it('a save issued right after a load belongs to the loaded playthrough', async () => {
      const [first, second] = await saveThenRestart('a');

      const loaded = Story.load('a');
      const saved = Story.save('b');
      await Promise.all([loaded, saved]);

      expect(state().playthroughId).toBe(first);
      expect(await groupOf(first)).toEqual([
        first,
        'Playthrough 1',
        ['a', 'b'],
      ]);
      expect(await groupOf(second)).toEqual([second, 'Playthrough 2', []]);
    });

    it('a load issued right after a restart ends in the loaded playthrough', async () => {
      const first = state().playthroughId;
      Story.goto('Room');
      await Story.save('a');

      Story.restart();
      const second = state().playthroughId;
      const loaded = Story.load('a');
      const saved = Story.save('b');
      await Promise.all([loaded, saved]);

      expect(state().playthroughId).toBe(first);
      expect(Story.passage).toBe('Room');
      expect(await groupOf(first)).toEqual([
        first,
        'Playthrough 1',
        ['a', 'b'],
      ]);
      // The restart's playthrough was started, and keeps its number
      expect(await groupOf(second)).toEqual([second, 'Playthrough 2', []]);
    });

    it('a load issued while the booting game looks up its playthrough ends in the loaded one', async () => {
      const [first] = await saveThenRestart('a');

      boot();
      expect(state().playthroughId).toBe('');
      const loaded = Story.load('a');
      const saved = Story.save('b');
      await Promise.all([loaded, saved]);

      expect(state().playthroughId).toBe(first);
      expect(await groupOf(first)).toEqual([
        first,
        'Playthrough 1',
        ['a', 'b'],
      ]);
    });

    it('a restart issued after a load wins over it', async () => {
      const [first] = await saveThenRestart('a');
      const afterload = vi.fn();
      Story.on('afterload', afterload);

      const loaded = Story.load('a');
      const saved = Story.save('b');
      Story.restart();
      const third = state().playthroughId;
      const savedAfter = Story.save('c');
      await Promise.all([loaded, saved, savedAfter]);

      // The game is the restarted one, in the restart's playthrough
      expect(state().playthroughId).toBe(third);
      expect(Story.passage).toBe('Start');
      expect(Story.get('hp')).toBe(100);
      expect(afterload).not.toHaveBeenCalled();
      expect(await groupOf(first)).toEqual([
        first,
        'Playthrough 1',
        ['a', 'b'],
      ]);
      expect(await groupOf(third)).toEqual([third, 'Playthrough 3', ['c']]);

      // And a refresh keeps it
      refresh();
      await resolvePlaythroughId();
      expect(state().playthroughId).toBe(third);
    });

    it('deleting the loaded playthrough right after the load moves the loaded game to a new one', async () => {
      const [first, second] = await saveThenRestart('a');

      const loaded = Story.load('a');
      const deleted = Story.storage.deletePlaythrough(first);
      const saved = Story.save('b');
      await Promise.all([loaded, deleted, saved]);

      const current = state().playthroughId;
      expect(current).not.toBe(first);
      expect(current).not.toBe(second);
      // The load had read the save: the game is the loaded one
      expect(Story.passage).toBe('Room');
      expect(await groups()).toEqual(
        expect.arrayContaining([
          [current, 'Playthrough 3', ['b']],
          [second, 'Playthrough 2', []],
        ]),
      );
      expect(await groupOf(first)).toBeUndefined();
    });

    it('deleting the playthrough the game was in before a load keeps the loaded one', async () => {
      const [first, second] = await saveThenRestart('a');

      const loaded = Story.load('a');
      const deleted = Story.storage.deletePlaythrough(second);
      const saved = Story.save('b');
      await Promise.all([loaded, deleted, saved]);

      expect(state().playthroughId).toBe(first);
      expect(await groups()).toEqual([[first, 'Playthrough 1', ['a', 'b']]]);
    });

    it('two loads in a row end in the second one’s playthrough', async () => {
      const [first, second] = await saveThenRestart('a');
      Story.goto('Room');
      await Story.save('b');

      const loads = [Story.load('a'), Story.load('b')];
      const saved = Story.save('c');
      await Promise.all([...loads, saved]);

      expect(state().playthroughId).toBe(second);
      expect(await groupOf(first)).toEqual([first, 'Playthrough 1', ['a']]);
      expect(await groupOf(second)).toEqual([
        second,
        'Playthrough 2',
        ['b', 'c'],
      ]);
    });
  });

  describe('imported saves', () => {
    /** Export slot `a`, then clear all data (its playthrough is gone). */
    async function exportAndClear(): Promise<[SaveExport, string]> {
      Story.goto('Room');
      await Story.save('a');
      const data = (await Story.exportSave('a'))!;
      await Story.storage.clearGameData();
      return [
        JSON.parse(JSON.stringify(data)) as SaveExport,
        state().playthroughId,
      ];
    }

    it('loading an imported save switches to its playthrough, which takes no number', async () => {
      const [data, fresh] = await exportAndClear();
      const imported = data.save.meta.playthroughId;
      expect(fresh).not.toBe(imported);

      await Story.importSave(data, 'imp');
      await Story.load('imp');
      expect(state().playthroughId).toBe(imported);

      await Story.save('later');
      expect(await groupOf(imported)).toEqual([
        imported,
        'Imported',
        ['imp', 'later'],
      ]);
      expect(await groupOf(fresh)).toEqual([fresh, 'Playthrough 1', []]);

      // The next playthrough started takes the next number
      Story.restart();
      await resolvePlaythroughId();
      expect(await groupOf(state().playthroughId)).toEqual([
        state().playthroughId,
        'Playthrough 2',
        [],
      ]);
    });

    it('deleting the imported playthrough the game is in moves it to a new one', async () => {
      const [data] = await exportAndClear();
      const imported = data.save.meta.playthroughId;
      await Story.importSave(data, 'imp');
      await Story.load('imp');

      await Story.storage.deletePlaythrough(imported);
      const current = state().playthroughId;
      expect(current).not.toBe(imported);
      expect(await groupOf(imported)).toBeUndefined();
      expect(await groupOf(current)).toEqual([current, 'Playthrough 2', []]);
    });

    it('a refresh after loading an imported save stays in its playthrough', async () => {
      const [data] = await exportAndClear();
      await Story.importSave(data, 'imp');
      await Story.load('imp');

      refresh();
      await resolvePlaythroughId();
      expect(state().playthroughId).toBe(data.save.meta.playthroughId);
    });
  });

  it('loading a save whose playthrough was deleted records it again, as imported', async () => {
    const [first] = await saveThenRestart('a');
    const data = (await Story.exportSave('a'))!;
    // A dialog still showing the save after its playthrough was deleted
    await Story.storage.deletePlaythrough(first);

    state().loadFromPayload(
      decodeSavePayload(data.save.payload),
      undefined,
      first,
    );
    expect(state().playthroughId).toBe(first);
    await Story.save('b');
    expect(await groupOf(first)).toEqual([first, 'Imported', ['b']]);

    // Numbers are not reused: the next playthrough is the third
    Story.restart();
    await resolvePlaythroughId();
    expect((await groupOf(state().playthroughId))![1]).toBe('Playthrough 3');
  });

  it('Story.load() in running code: a save after it belongs to the loaded playthrough', async () => {
    const [first] = await saveThenRestart('a');

    executeMutation(
      '$hp = 5; globalThis.saved = Promise.all([Story.load("a"), Story.save("b")])',
      {},
      () => {},
    );
    await g.saved;

    expect(state().playthroughId).toBe(first);
    expect(Story.get('hp')).toBe(42);
    expect(await groupOf(first)).toEqual([first, 'Playthrough 1', ['a', 'b']]);
    // The save holds the code's write, made before it (program order)
    expect(
      decodeSavePayload((await Story.exportSave('b'))!.save.payload).variables
        .hp,
    ).toBe(5);
  });

  it('a rejected load keeps the current playthrough (#357)', async () => {
    const [, second] = await saveThenRestart('a');
    // The story is updated: the saved passage is gone
    const passages = [makePassage(1, 'Start', 'Hello')];
    useStoryStore.setState({
      storyData: {
        ...makeStoryData(ifid),
        passages: new Map(passages.map((p) => [p.name, p])),
        passagesById: new Map(passages.map((p) => [p.pid, p])),
      },
    });

    await Story.load('a').catch(() => undefined);
    expect(state().loadError).toContain('does not have');
    expect(state().playthroughId).toBe(second);
    await Story.save('after');
    expect((await groupOf(second))![2]).toEqual(['after']);
  });

  it('a refresh stays in the tab’s own playthrough (#356)', async () => {
    const first = state().playthroughId;
    Story.goto('Room');
    await Story.save('first');
    const tabA = new Map(
      Array.from({ length: sessionStorage.length }, (_, i) => {
        const key = sessionStorage.key(i)!;
        return [key, sessionStorage.getItem(key)!] as const;
      }),
    );

    // Another tab restarts the game: the shared current playthrough moves on
    sessionStorage.clear();
    Story.restart();
    await resolvePlaythroughId();
    const second = state().playthroughId;
    expect(second).not.toBe(first);

    // Tab A refreshes
    sessionStorage.clear();
    for (const [key, value] of tabA) sessionStorage.setItem(key, value);
    refresh();
    await resolvePlaythroughId();
    expect(Story.passage).toBe('Room');
    expect(state().playthroughId).toBe(first);
    await Story.save('afterreload');
    expect((await groupOf(first))![2]).toEqual(['afterreload', 'first']);
  });
});
