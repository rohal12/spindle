// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetBackend } from '../../src/saves/storage';
import { loadSession } from '../../src/saves/save-manager';
import { resetEmitter } from '../../src/event-emitter';
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
});
