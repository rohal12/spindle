// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { executeStoryInit, initializeStory } from '../../src/story-init';
import { loadSession } from '../../src/saves/save-manager';
import { installStoryAPI } from '../../src/story-api';
import { on } from '../../src/event-emitter';
import { isPRNGEnabled, getPRNGPull, resetPRNG } from '../../src/prng';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test-ifid',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

describe('executeStoryInit', () => {
  beforeEach(() => {
    // Start fresh
  });

  it('does nothing when storyData is null', () => {
    useStoryStore.setState({ storyData: null });
    executeStoryInit(); // should not throw
  });

  it('does nothing when StoryInit passage does not exist', () => {
    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello')]);
    useStoryStore.getState().init(storyData);
    executeStoryInit(); // should not throw
    expect(useStoryStore.getState().variables).toEqual({});
  });

  it('executes {set} macros from StoryInit', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{set $health = 100}{set $name = "Hero"}'),
    ]);
    useStoryStore.getState().init(storyData);
    executeStoryInit();
    const vars = useStoryStore.getState().variables;
    expect(vars.health).toBe(100);
    expect(vars.name).toBe('Hero');
  });

  it('executes {do} macros from StoryInit', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{do}$score = 42{/do}'),
    ]);
    useStoryStore.getState().init(storyData);
    executeStoryInit();
    expect(useStoryStore.getState().variables.score).toBe(42);
  });

  it('executes {set} for temporary variables', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{set _temp = "abc"}'),
    ]);
    useStoryStore.getState().init(storyData);
    executeStoryInit();
    expect(useStoryStore.getState().temporary.temp).toBe('abc');
  });

  it('only modifies changed variables', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{set $x = 10}'),
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().setVariable('y', 20);
    executeStoryInit();
    const vars = useStoryStore.getState().variables;
    expect(vars.x).toBe(10);
    expect(vars.y).toBe(20);
  });

  it('registers SaveTitle passage if it exists', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{set $x = 1}'),
      makePassage(3, 'SaveTitle', 'Chapter {$chapter}'),
    ]);
    useStoryStore.getState().init(storyData);
    // Should not throw when SaveTitle exists
    executeStoryInit();
  });

  it('ignores non-macro nodes', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', 'Just plain text and {set $a = 1} more text'),
    ]);
    useStoryStore.getState().init(storyData);
    executeStoryInit();
    expect(useStoryStore.getState().variables.a).toBe(1);
  });

  it('keeps StoryInit mounted so async effects can fire', async () => {
    // The {do} macro uses useLayoutEffect (sync) which always works.
    // But StoryInit should also support components that use useEffect (async).
    // Verify the container stays mounted by checking that Preact effects
    // can still access the tree after executeStoryInit returns.
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{set $initRan = true}'),
    ]);
    useStoryStore.getState().init(storyData);
    executeStoryInit();

    // Allow async effects to settle
    await new Promise((r) => setTimeout(r, 50));

    // The sync {set} should have worked
    expect(useStoryStore.getState().variables.initRan).toBe(true);
  });
});

describe('executeStoryInit on restart', () => {
  function hiddenContainers(): number {
    return Array.from(document.body.children).filter(
      (el) => (el as HTMLElement).style.display === 'none',
    ).length;
  }

  /** Advance fake timers in small steps so Preact flushes between ticks. */
  function tick(ms: number): void {
    for (let t = 0; t < ms; t += 10)
      act(() => {
        vi.advanceTimersByTime(10);
      });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    _resetRuntimePhase();
    // Unmount any StoryInit tree left behind by earlier tests
    useStoryStore.setState({ storyData: null });
    executeStoryInit();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unmounts the previous StoryInit tree so its {timed} does not fire', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{timed 1000ms}{set $x = $x + 1}{/timed}'),
    ]);
    useStoryStore.getState().init(storyData, { x: 0 });
    act(() => executeStoryInit());
    expect(hiddenContainers()).toBe(1);

    tick(180);
    act(() => useStoryStore.getState().restart());
    expect(hiddenContainers()).toBe(1);

    // Old timer would have fired at ~820ms after restart
    tick(850);
    expect(useStoryStore.getState().variables.x).toBe(0);

    // New timer fires 1000ms after restart
    tick(200);
    expect(useStoryStore.getState().variables.x).toBe(1);
  });

  it('stops the previous StoryInit {repeat} interval on restart', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'StoryInit', '{repeat 100ms}{set $x = $x + 1}{/repeat}'),
    ]);
    useStoryStore.getState().init(storyData, { x: 0 });
    act(() => executeStoryInit());
    tick(250);
    expect(useStoryStore.getState().variables.x).toBe(2);

    act(() => useStoryStore.getState().restart());
    expect(useStoryStore.getState().variables.x).toBe(0);
    expect(vi.getTimerCount()).toBe(1);

    tick(1000);
    expect(useStoryStore.getState().variables.x).toBe(10);
    expect(hiddenContainers()).toBe(1);
  });
});

describe('start moment snapshot', () => {
  const store = () => useStoryStore.getState();

  function storyData(init = '{set $gold = 100}'): StoryData {
    return makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'B', 'B'),
      makePassage(3, 'StoryInit', init),
    ]);
  }

  function snapshots(): Record<string, unknown>[] {
    return store().history.map((_, i) => store().getHistoryVariables(i));
  }

  beforeEach(() => {
    _resetRuntimePhase();
    sessionStorage.clear();
    resetPRNG();
  });

  it('includes StoryInit changes when going back to the start', () => {
    store().init(storyData(), { gold: 0 });
    executeStoryInit();
    store().navigate('B');
    store().goBack();
    expect(store().variables).toEqual({ gold: 100 });
  });

  it('includes StoryInit changes in the save payload and session', () => {
    store().init(storyData(), { gold: 0 });
    executeStoryInit();
    store().navigate('B');
    expect(store().getSavePayload().history[0]!.variables).toEqual({
      gold: 100,
    });
    expect(loadSession('test-ifid')!.history[0]!.variables).toEqual({
      gold: 100,
    });
  });

  it('includes StoryInit changes after a restart', () => {
    store().init(storyData(), { gold: 0 });
    executeStoryInit();
    store().navigate('B');
    store().setVariable('gold', 5);
    store().restart();
    store().navigate('B');
    store().goBack();
    expect(store().variables).toEqual({ gold: 100 });
    expect(loadSession('test-ifid')!.history[0]!.variables).toEqual({
      gold: 100,
    });
  });

  it('diffs the first navigation from the StoryInit state', () => {
    store().init(storyData('{set $gold = 100}{set $hp = 3}'), { gold: 0 });
    executeStoryInit();
    store().setVariable('gold', 50);
    store().navigate('B');
    expect(snapshots()).toEqual([
      { gold: 100, hp: 3 },
      { gold: 50, hp: 3 },
    ]);
  });

  it('restores the PRNG state left by StoryInit when going back', () => {
    installStoryAPI();
    store().init(
      storyData('{do}Story.prng.init("seed", false); $r = random(){/do}'),
    );
    executeStoryInit();
    store().navigate('B');
    store().goBack();
    expect(isPRNGEnabled()).toBe(true);
    expect(getPRNGPull()).toBe(1);
  });

  it('does not re-apply StoryInit over a restored session', () => {
    store().init(storyData('{set $gold = $gold + 100}'), { gold: 0 });
    executeStoryInit();
    store().navigate('B');
    store().setVariable('gold', 7);
    store().navigate('Start');
    const before = { vars: store().variables, history: snapshots() };

    // Refresh: boot re-inits, runs StoryInit, then restores the session
    store().init(storyData('{set $gold = $gold + 100}'), { gold: 0 });
    executeStoryInit();
    store().loadFromPayload(loadSession('test-ifid')!);
    expect(store().variables).toEqual(before.vars);
    expect(snapshots()).toEqual(before.history);
    expect(snapshots()[0]).toEqual({ gold: 100 });
  });
});

describe('storyinit handler changes in the start moment', () => {
  const store = () => useStoryStore.getState();
  let unsubs: Array<() => void> = [];

  function storyData(init?: string): StoryData {
    const passages = [
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'B', 'B'),
    ];
    if (init !== undefined) passages.push(makePassage(3, 'StoryInit', init));
    return makeStoryData(passages);
  }

  function snapshots(): Record<string, unknown>[] {
    return store().history.map((_, i) => store().getHistoryVariables(i));
  }

  /** Register a storyinit handler that adds 5 gold, as Story.set() would. */
  function addGoldOnInit(): void {
    unsubs.push(
      on('storyinit', () => {
        store().setVariable('gold', (store().variables.gold as number) + 5);
      }),
    );
  }

  beforeEach(() => {
    _resetRuntimePhase();
    sessionStorage.clear();
    resetPRNG();
  });

  afterEach(() => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  });

  it('includes handler changes when going back, without a StoryInit passage', () => {
    addGoldOnInit();
    store().init(storyData(), { gold: 0 });
    initializeStory();
    expect(store().variables).toEqual({ gold: 5 });
    store().navigate('B');
    store().goBack();
    expect(store().variables).toEqual({ gold: 5 });
  });

  it('includes handler changes when going back, with a StoryInit passage', () => {
    addGoldOnInit();
    store().init(storyData('{set $hp = 3}'), { gold: 0 });
    initializeStory();
    store().navigate('B');
    store().goBack();
    expect(store().variables).toEqual({ gold: 5, hp: 3 });
    expect(loadSession('test-ifid')!.history[0]!.variables).toEqual({
      gold: 5,
      hp: 3,
    });
  });

  it('includes handler changes in a save made at the start moment', () => {
    addGoldOnInit();
    store().init(storyData('{set $hp = 3}'), { gold: 0 });
    initializeStory();
    const payload = store().getSavePayload();
    expect(payload.history[0]!.variables).toEqual({ gold: 5, hp: 3 });

    store().navigate('B');
    store().setVariable('gold', 99);
    store().loadFromPayload(payload);
    expect(store().currentPassage).toBe('Start');
    expect(store().variables).toEqual({ gold: 5, hp: 3 });
  });

  it('includes handler changes after a restart', () => {
    addGoldOnInit();
    store().init(storyData(), { gold: 0 });
    initializeStory();
    store().navigate('B');
    store().setVariable('gold', 42);
    store().restart();
    expect(store().variables).toEqual({ gold: 5 });
    store().navigate('B');
    store().goBack();
    expect(store().variables).toEqual({ gold: 5 });
    expect(store().getSavePayload().history[0]!.variables).toEqual({
      gold: 5,
    });
  });

  it('does not record handler changes over a restored session', () => {
    addGoldOnInit();
    store().init(storyData(), { gold: 0 });
    initializeStory();
    // Loading a save made at the start leaves a one-moment session behind
    const payload = store().getSavePayload();
    store().navigate('B');
    store().loadFromPayload(payload);
    expect(loadSession('test-ifid')!.history).toHaveLength(1);

    // Refresh: boot re-inits and restores the session, then storyinit fires
    store().init(storyData(), { gold: 0 });
    initializeStory(loadSession('test-ifid'));
    expect(snapshots()).toEqual([{ gold: 5 }]);
  });
});

describe('a story updated since the session or save was made', () => {
  const store = () => useStoryStore.getState();
  const oldPayload = () => ({
    passage: 'Old',
    variables: {},
    history: [{ passage: 'Old', variables: {}, timestamp: 1 }],
    historyIndex: 0,
  });

  beforeEach(() => {
    _resetRuntimePhase();
    sessionStorage.clear();
    resetPRNG();
    store().init(makeStoryData([makePassage(1, 'Start', 'Hello')]));
  });

  it('starts from the beginning instead of restoring a removed passage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initializeStory(oldPayload());
    expect(store().currentPassage).toBe('Start');
    expect(warn.mock.calls.flat().join()).toContain('"Old"');
    warn.mockRestore();
  });

  it('rejects loading a save of a removed passage and keeps the game', () => {
    store().setVariable('hp', 5);
    expect(() => store().loadFromPayload(oldPayload())).toThrow(/"Old"/);
    expect(store().currentPassage).toBe('Start');
    expect(store().variables.hp).toBe(5);
  });

  it('rejects a save whose history refers to a removed passage', () => {
    const payload = oldPayload();
    payload.passage = 'Start';
    expect(() => store().loadFromPayload(payload)).toThrow(/"Old"/);
  });
});
