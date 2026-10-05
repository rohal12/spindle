// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetBackend } from '../../src/saves/storage';
import { loadSession } from '../../src/saves/save-manager';
import { resetEmitter } from '../../src/event-emitter';
import { initPRNG, random } from '../../src/prng';
import type { StoryData, Passage } from '../../src/parser';

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
      Story.goto('B');
      Story.set('data', { n: 2 });
      random();
      random();
      await saveTo('slot');
      const savedPrng = useStoryStore.getState().getSavePayload().prng!;

      Story.goto('C');
      Story.set('data', { n: 3 });
      random();

      await loadFrom('slot');
      expect(Story.get('data')).toEqual({ n: 2 });

      refresh();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('B');
      expect(Story.get('data')).toEqual({ n: 2 });
      expect(state.history.map((m) => m.passage)).toEqual(['A', 'B']);
      expect(state.historyIndex).toBe(1);
      expect(state.getHistoryVariables(1).data).toEqual({ n: 1 });
      expect(Story.prng.pull).toBe(savedPrng.pull);
      expect(Story.prng.seed).toBe(savedPrng.seed);
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

  describe('history after a load', () => {
    it('records the next move from the loaded moment snapshot', async () => {
      Story.set('data', { n: 1 });
      Story.goto('B');
      // Edited after entering B, so the live variables differ from B's snapshot
      Story.set('data', { n: 2 });
      await saveTo('edited');

      await loadFrom('edited');
      Story.goto('C');

      const state = useStoryStore.getState();
      expect(state.getHistoryVariables(1).data).toEqual({ n: 1 });
      expect(state.getHistoryVariables(2).data).toEqual({ n: 2 });

      state.goBack();
      expect(Story.get('data')).toEqual({ n: 1 });
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
