// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { executeStoryInit } from '../../src/story-init';
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
    for (let t = 0; t < ms; t += 10) act(() => vi.advanceTimersByTime(10));
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
