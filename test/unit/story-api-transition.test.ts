// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content = ''): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

let Story: any;

describe('Story.setTransition / setNextTransition', () => {
  beforeEach(async () => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Hello')]));
    const mod = await import('../../src/story-api');
    mod.installStoryAPI();
    Story = (globalThis as any).window?.Story ?? (globalThis as any).Story;
  });

  it('Story.setTransition sets persistent default in store', () => {
    Story.setTransition({ type: 'crossfade', duration: 600 });
    expect(useStoryStore.getState().transitionConfig).toEqual({
      type: 'crossfade',
      duration: 600,
    });
  });

  it('Story.setTransition(null) clears it', () => {
    Story.setTransition({ type: 'none' });
    Story.setTransition(null);
    expect(useStoryStore.getState().transitionConfig).toBeNull();
  });

  it('Story.setNextTransition sets one-shot in store', () => {
    Story.setNextTransition({ type: 'none' });
    expect(useStoryStore.getState().nextTransition).toEqual({ type: 'none' });
  });

  it('Story.setNextTransition(null) clears it', () => {
    Story.setNextTransition({ type: 'fade' });
    Story.setNextTransition(null);
    expect(useStoryStore.getState().nextTransition).toBeNull();
  });
});
