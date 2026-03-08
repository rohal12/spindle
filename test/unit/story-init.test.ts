// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
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
});
