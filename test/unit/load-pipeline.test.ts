// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { current } from 'immer';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetBackend } from '../../src/saves/storage';
import { loadSession, saveWithHooks } from '../../src/saves/save-manager';
import type { SavePayload } from '../../src/saves/types';
import { resetEmitter } from '../../src/event-emitter';
import { initPRNG, random } from '../../src/prng';
import type { StoryData, Passage } from '../../src/parser';
import { deepClone } from '../../src/class-registry';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

let ifidCounter = 0;

function makeStoryData(ifid: string): StoryData {
  const passages = [
    makePassage(1, 'A', 'a'),
    makePassage(2, 'B', 'b'),
    makePassage(3, 'C', 'c'),
  ];
  return {
    name: 'Load pipeline',
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

function typedData(n: number) {
  return {
    date: new Date(Date.UTC(2025, 0, n)),
    regex: new RegExp(`a${n}`, 'g'),
    map: new Map<string, unknown>([['a', n]]),
    set: new Set([n]),
  };
}

function expectTyped(value: unknown, n: number) {
  const v = value as ReturnType<typeof typedData>;
  expect(v.date).toBeInstanceOf(Date);
  expect(v.date.toISOString()).toBe(
    new Date(Date.UTC(2025, 0, n)).toISOString(),
  );
  expect(v.regex).toBeInstanceOf(RegExp);
  expect(v.regex.source).toBe(`a${n}`);
  expect(v.regex.flags).toBe('g');
  expect(v.map).toBeInstanceOf(Map);
  expect([...v.map]).toEqual([['a', n]]);
  expect(v.set).toBeInstanceOf(Set);
  expect([...v.set]).toEqual([n]);
}

describe('load pipeline', () => {
  let Story: StoryAPI;
  let ifid: string;
  let storyData: StoryData;

  async function saveTo(slot?: string) {
    let done = false;
    const unsub = Story.on('aftersave', () => {
      done = true;
    });
    Story.save(slot);
    await vi.waitFor(() => expect(done).toBe(true));
    unsub();
  }

  async function loadFrom(slot?: string) {
    let done = false;
    const unsub = Story.on('afterload', () => {
      done = true;
    });
    Story.load(slot);
    await vi.waitFor(() => expect(done).toBe(true));
    unsub();
  }

  /** Simulate a page refresh: re-init the store and restore the session, as index.tsx does. */
  function refresh() {
    useStoryStore.getState().init(storyData, { data: typedData(0) });
    const payload = loadSession(ifid);
    expect(payload).toBeDefined();
    useStoryStore.getState().loadFromPayload(payload!);
  }

  beforeEach(async () => {
    resetBackend();
    resetEmitter();
    _resetRuntimePhase();
    sessionStorage.clear();
    ifid = `load-pipeline-${++ifidCounter}`;
    storyData = makeStoryData(ifid);
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    useStoryStore.getState().init(storyData, { data: typedData(0) });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    resetBackend();
    resetEmitter();
  });

  describe('built-in value types (#158)', () => {
    it('survive Story.save → Story.load, including history snapshots', async () => {
      Story.set('data', typedData(1));
      Story.goto('B');
      Story.set('data', typedData(2));
      Story.goto('C');
      await saveTo('typed');

      Story.set('data', {});
      await loadFrom('typed');

      expectTyped(Story.get('data'), 2);
      const state = useStoryStore.getState();
      expectTyped(state.getHistoryVariables(0).data, 0);
      expectTyped(state.getHistoryVariables(1).data, 1);
      expectTyped(state.getHistoryVariables(2).data, 2);

      // Navigating back through restored history keeps the types
      state.goBack();
      expectTyped(Story.get('data'), 1);
      useStoryStore.getState().goBack();
      expectTyped(Story.get('data'), 0);
    });

    it('survive navigation → page refresh, including history snapshots', () => {
      Story.set('data', typedData(1));
      Story.goto('B');
      Story.set('data', typedData(2));
      Story.goto('C');

      refresh();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('C');
      expectTyped(Story.get('data'), 2);
      expectTyped(state.getHistoryVariables(0).data, 0);
      expectTyped(state.getHistoryVariables(1).data, 1);
      expectTyped(state.getHistoryVariables(2).data, 2);

      state.goBack();
      expectTyped(Story.get('data'), 1);
    });

    it('survive a second refresh after restoring a session', () => {
      Story.set('data', typedData(1));
      Story.goto('B');
      Story.set('data', typedData(2));
      Story.goto('C');

      refresh();
      refresh();

      expectTyped(Story.get('data'), 2);
      expectTyped(useStoryStore.getState().getHistoryVariables(1).data, 1);
    });

    it('survive loading a live payload from getSavePayload()', () => {
      Story.set('data', typedData(1));
      Story.goto('B');
      const payload = useStoryStore.getState().getSavePayload();

      Story.set('data', {});
      useStoryStore.getState().loadFromPayload(payload);

      expectTyped(Story.get('data'), 1);
      expectTyped(useStoryStore.getState().getHistoryVariables(1).data, 1);
    });
  });

  describe('session persistence after load (#165)', () => {
    it('refresh right after a load restores the loaded game', async () => {
      initPRNG('seed', false);
      Story.set('data', { n: 1 });
      random();
      Story.goto('B');
      const entryPrng = useStoryStore.getState().history[1]!.prng!;
      // Made after entering B: not part of what a load restores
      Story.set('data', { n: 2 });
      random();
      random();
      await saveTo('slot');

      Story.goto('C');
      Story.set('data', { n: 3 });
      random();

      await loadFrom('slot');
      expect(Story.get('data')).toEqual({ n: 1 });
      expect(Story.prng.pull).toBe(entryPrng.pull);

      refresh();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('B');
      expect(Story.get('data')).toEqual({ n: 1 });
      expect(state.history.map((m) => m.passage)).toEqual(['A', 'B']);
      expect(state.historyIndex).toBe(1);
      expect(state.getHistoryVariables(1).data).toEqual({ n: 1 });
      expect(entryPrng.pull).toBe(1);
      expect(Story.prng.pull).toBe(entryPrng.pull);
      expect(Story.prng.seed).toBe(entryPrng.seed);
    });

    it('refresh after loading a save made mid-history keeps every moment', async () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      Story.set('data', { n: 2 });
      Story.goto('C');
      useStoryStore.getState().goBack();
      await saveTo('mid');

      useStoryStore.getState().goForward();
      await loadFrom('mid');
      refresh();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('B');
      expect(state.historyIndex).toBe(1);
      expect(state.history.map((m) => m.passage)).toEqual(['A', 'B', 'C']);
      expect(Story.get('data')).toEqual({ n: 1 });
      expect(state.getHistoryVariables(1).data).toEqual({ n: 1 });
      expect(state.getHistoryVariables(2).data).toEqual({ n: 2 });

      state.goForward();
      expect(Story.get('data')).toEqual({ n: 2 });
    });

    it('refresh right after a dialog-style loadFromPayload restores it', () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      const payload = useStoryStore.getState().getSavePayload();
      Story.goto('C');

      useStoryStore.getState().loadFromPayload(payload);
      refresh();

      expect(useStoryStore.getState().currentPassage).toBe('B');
      expect(useStoryStore.getState().history.map((m) => m.passage)).toEqual([
        'A',
        'B',
      ]);
    });
  });

  describe('state restored by a load', () => {
    it('restores the snapshot taken on entering the saved passage', async () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      // Edited after entering B, so the live variables differ from B's snapshot
      Story.set('data', { n: 2 });
      await saveTo('edited');
      Story.set('data', { n: 9 });

      await loadFrom('edited');
      expect(Story.get('data')).toEqual({ n: 1 });
    });

    it('discards changes made after entering the passage on refresh', () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      Story.set('data', { n: 2 });

      refresh();

      expect(useStoryStore.getState().currentPassage).toBe('B');
      expect(Story.get('data')).toEqual({ n: 1 });
    });

    it('records the next move from the loaded moment snapshot', async () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      Story.set('data', { n: 2 });
      await saveTo('edited');

      await loadFrom('edited');
      Story.set('data', { n: 3 });
      Story.goto('C');

      const state = useStoryStore.getState();
      expect(state.getHistoryVariables(1).data).toEqual({ n: 1 });
      expect(state.getHistoryVariables(2).data).toEqual({ n: 3 });
      expect(loadSession(ifid)!.history[2]!.variables).toEqual({
        data: { n: 3 },
      });

      state.goBack();
      expect(Story.get('data')).toEqual({ n: 1 });
    });

    it('restores the variables a beforesave hook changed (#227)', async () => {
      Story.set({ data: { n: 1 }, engine: { v: 1 }, stale: true });
      Story.goto('B');
      Story.set('data', { n: 2 });
      Story.on('beforesave', () => {
        Story.set('engine', { v: 2 });
        Story.set('added', 'x');
        useStoryStore.getState().deleteVariable('stale');
      });
      await saveTo('hooked');
      Story.set({ engine: { v: 9 }, added: 'y', stale: false });

      await loadFrom('hooked');
      expect(Story.get('engine')).toEqual({ v: 2 });
      expect(Story.get('added')).toBe('x');
      expect(Story.get('stale')).toBeUndefined();
      // Changes made on the passage outside the hook are still not restored
      expect(Story.get('data')).toEqual({ n: 1 });
    });

    it('keeps beforesave writes out of the live history (#227)', async () => {
      Story.set('engine', { v: 1 });
      Story.goto('B');
      Story.on('beforesave', () => Story.set('engine', { v: 2 }));
      await saveTo('hooked');

      const state = useStoryStore.getState();
      expect(state.getHistoryVariables(1).engine).toEqual({ v: 1 });
      state.goBack();
      state.goForward();
      expect(Story.get('engine')).toEqual({ v: 1 });
    });

    it('falls back to the payload variables for an out-of-range index', () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      Story.set('data', { n: 2 });
      const payload = useStoryStore.getState().getSavePayload();
      payload.historyIndex = 5;

      useStoryStore.getState().loadFromPayload(payload);

      expect(useStoryStore.getState().historyIndex).toBe(1);
      expect(Story.get('data')).toEqual({ n: 2 });
    });

    it('falls back to the payload PRNG for moments without one', () => {
      initPRNG('seed', false);
      Story.goto('B');
      random();
      const payload = useStoryStore.getState().getSavePayload();
      // Saved before history moments recorded the PRNG state
      delete payload.history[1]!.prng;

      useStoryStore.getState().loadFromPayload(payload);

      expect(Story.prng.pull).toBe(1);
    });

    it('saves and goes on with the PRNG state before save hook draws', async () => {
      initPRNG('seed', false);
      Story.goto('B');
      random();
      Story.on('beforesave', () => random());
      Story.on('aftersave', () => random());
      await saveTo('hooked');

      expect(Story.prng.pull).toBe(1);
      const payload = (await Story.exportSave('hooked'))!.save.payload;
      // The fallback for saves whose moments have no PRNG state
      expect(payload.prng).toEqual({ seed: 'seed', pull: 1 });
    });

    it('takes back save hook draws on the save dialog path', async () => {
      initPRNG('seed', false);
      Story.on('beforesave', () => random());
      Story.on('aftersave', () => random());
      let saved: SavePayload | undefined;
      await saveWithHooks(
        undefined,
        undefined,
        useStoryStore.getState().beginSave,
        async (payload) => {
          saved = payload;
        },
      );
      expect(saved!.prng).toEqual({ seed: 'seed', pull: 0 });
      expect(Story.prng.pull).toBe(0);
    });

    it('replays the passage rolls after afterload draws', async () => {
      initPRNG('seed', false);
      Story.goto('B');
      await saveTo('s');
      Story.on('afterload', () => random());

      await loadFrom('s');

      // The passage's first roll comes next, as on entering it
      expect(Story.prng.pull).toBe(0);
    });
  });

  describe('beforesave writes inside a value the passage changed (#232)', () => {
    type Vars = Record<string, any>;
    const update = (recipe: (vars: Vars) => void) =>
      useStoryStore
        .getState()
        .updateVariables((draft) => recipe(draft.variables as Vars));

    /** Enter B from `entry`, run `passage` there, save with `hook`, load. */
    async function saveAndLoad(
      entry: Vars,
      passage: (vars: Vars) => void,
      hook: (vars: Vars) => void,
    ) {
      Story.set(entry);
      Story.goto('B');
      update(passage);
      Story.on('beforesave', () => update(hook));
      await saveTo('hooked');
      Story.goto('C');
      await loadFrom('hooked');
    }

    it('keeps the entry value of fields only the passage changed', async () => {
      await saveAndLoad(
        { state: { count: 0, engine: 0 } },
        (v) => {
          v.state.count = 1;
        },
        (v) => {
          v.state.engine = 42;
        },
      );
      expect(Story.get('state')).toEqual({ count: 0, engine: 42 });
    });

    it('merges at any depth', async () => {
      await saveAndLoad(
        { a: { b: { c: 0, d: 0 }, e: 0 } },
        (v) => {
          v.a.b.c = 1;
          v.a.e = 1;
        },
        (v) => {
          v.a.b.d = 2;
        },
      );
      expect(Story.get('a')).toEqual({ b: { c: 0, d: 2 }, e: 0 });
    });

    it('merges into array elements by index', async () => {
      await saveAndLoad(
        { party: [{ hp: 10 }, { hp: 10 }] },
        (v) => {
          v.party[1].hp = 5;
        },
        (v) => {
          v.party[0].xp = 3;
        },
      );
      expect(Story.get('party')).toEqual([{ hp: 10, xp: 3 }, { hp: 10 }]);
    });

    it('applies elements a hook adds to or removes from an array', async () => {
      await saveAndLoad(
        { s: { log: ['a'], stack: [1, 2, 3], n: 0 } },
        (v) => {
          v.s.n = 1;
        },
        (v) => {
          v.s.log.push('saved');
          v.s.stack.splice(1, 1);
        },
      );
      expect(Story.get('s')).toEqual({
        log: ['a', 'saved'],
        stack: [1, 3],
        n: 0,
      });
    });

    it('appends hook additions to an array the passage resized', async () => {
      // The passage's own push runs again on load: copying the saved array
      // would record 'entered' twice
      await saveAndLoad(
        { log: [] },
        (v) => {
          v.log.push('entered');
        },
        (v) => {
          v.log.push('saved');
        },
      );
      expect(Story.get('log')).toEqual(['saved']);
    });

    it('deletes the nested keys a hook deleted', async () => {
      await saveAndLoad(
        { state: { count: 0, cache: { x: 1 } } },
        (v) => {
          v.state.count = 1;
        },
        (v) => {
          delete v.state.cache;
        },
      );
      expect(Story.get('state')).toEqual({ count: 0 });
    });

    it('adds the variables and keys a hook added', async () => {
      await saveAndLoad(
        { state: { count: 0 } },
        (v) => {
          v.state.count = 1;
        },
        (v) => {
          v.state.meta = { at: 5 };
          v.saveInfo = { slot: 'hooked', tags: ['x'] };
        },
      );
      expect(Story.get('state')).toEqual({ count: 0, meta: { at: 5 } });
      expect(Story.get('saveInfo')).toEqual({ slot: 'hooked', tags: ['x'] });
    });

    it('writes values whose type the hook changed', async () => {
      await saveAndLoad(
        { s: { count: 0, a: { x: 1 }, b: 1, c: [1], d: { y: 1 } } },
        (v) => {
          v.s.count = 1;
        },
        (v) => {
          v.s.a = 7;
          v.s.b = { z: 2 };
          v.s.c = { 0: 1 };
          v.s.d = ['y'];
        },
      );
      expect(Story.get('s')).toEqual({
        count: 0,
        a: 7,
        b: { z: 2 },
        c: { 0: 1 },
        d: ['y'],
      });
      expect(Array.isArray((Story.get('s') as Vars).d)).toBe(true);
      expect(Array.isArray((Story.get('s') as Vars).c)).toBe(false);
    });

    it('copies the whole value where the entry snapshot lacks its parent', async () => {
      await saveAndLoad(
        { other: 0 },
        (v) => {
          v.fresh = { a: 1 };
          v.prim = 1;
        },
        (v) => {
          v.fresh.b = 2;
          v.prim = { c: 3 };
        },
      );
      expect(Story.get('fresh')).toEqual({ a: 1, b: 2 });
      expect(Story.get('prim')).toEqual({ c: 3 });
    });

    it('ignores values a hook replaced with an equal copy', async () => {
      await saveAndLoad(
        { state: { count: 0, engine: 0, when: new Date(0), seen: new Set() } },
        (v) => {
          v.state.count = 1;
          v.state.when = new Date(1);
          v.state.seen.add('B');
        },
        // A hook that rebuilds the object (as mutation code commits may)
        (v) => {
          v.state = { ...deepClone(current(v.state)), engine: 42 };
        },
      );
      const state = Story.get('state') as Vars;
      expect(state.count).toBe(0);
      expect(state.engine).toBe(42);
      expect(state.when).toEqual(new Date(0));
      expect([...state.seen]).toEqual([]);
    });

    it('replaces built-in values the hook changed as a whole', async () => {
      await saveAndLoad(
        { s: { count: 0, seen: new Set(['A']), when: new Date(0) } },
        (v) => {
          v.s.count = 1;
        },
        (v) => {
          v.s.seen.add('save');
          v.s.when = new Date(5);
        },
      );
      const s = Story.get('s') as Vars;
      expect(s.count).toBe(0);
      expect([...s.seen]).toEqual(['A', 'save']);
      expect(s.when).toEqual(new Date(5));
    });

    it('keeps the live history as recorded', async () => {
      Story.set('state', { count: 0, engine: 0, list: [{ n: 0 }] });
      Story.goto('B');
      update((v) => {
        v.state.count = 1;
      });
      Story.on('beforesave', () =>
        update((v) => {
          v.state.engine = 42;
          v.state.list[0].n = 1;
          v.state.list.push({ n: 2 });
        }),
      );
      await saveTo('hooked');

      const state = useStoryStore.getState();
      expect(state.getHistoryVariables(1).state).toEqual({
        count: 0,
        engine: 0,
        list: [{ n: 0 }],
      });
      state.goBack();
      state.goForward();
      expect(Story.get('state')).toEqual({
        count: 0,
        engine: 0,
        list: [{ n: 0 }],
      });
    });
  });

  describe('load events receive the slot (#174)', () => {
    it('passes a named slot to beforeload and afterload', async () => {
      await saveTo('named');
      const calls: Array<[string, string | undefined]> = [];
      Story.on('beforeload', (slot) => calls.push(['before', slot]));
      Story.on('afterload', (slot) => calls.push(['after', slot]));

      await loadFrom('named');

      expect(calls).toEqual([
        ['before', 'named'],
        ['after', 'named'],
      ]);
    });

    it('passes undefined for the default slot', async () => {
      await saveTo();
      const calls: Array<[string, string | undefined]> = [];
      Story.on('beforeload', (slot) => calls.push(['before', slot]));
      Story.on('afterload', (slot) => calls.push(['after', slot]));

      await loadFrom();

      expect(calls).toEqual([
        ['before', undefined],
        ['after', undefined],
      ]);
    });

    it('passes undefined when loading a payload directly (session restore)', () => {
      Story.goto('B');
      const calls: Array<[string, string | undefined]> = [];
      Story.on('beforeload', (slot) => calls.push(['before', slot]));
      Story.on('afterload', (slot) => calls.push(['after', slot]));

      refresh();

      expect(calls).toEqual([
        ['before', undefined],
        ['after', undefined],
      ]);
    });
  });
});
