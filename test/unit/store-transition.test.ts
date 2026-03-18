// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import type { Passage } from '../../src/parser';
import type { StoryData } from '../../src/parser';
import type { TransitionConfig } from '../../src/transition';

function makePassage(pid: number, name: string, content = ''): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const passageMap = new Map<string, Passage>();
  const passagesById = new Map<number, Passage>();
  for (const p of passages) {
    passageMap.set(p.name, p);
    passagesById.set(p.pid, p);
  }
  return {
    name: 'Test Story',
    startNode,
    ifid: 'TEST-IFID',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: passageMap,
    passagesById,
    userCSS: '',
    userScript: '',
  };
}

describe('useStoryStore — transition state', () => {
  beforeEach(() => {
    useStoryStore.setState({
      storyData: null,
      currentPassage: '',
      variables: {},
      variableDefaults: {},
      temporary: {},
      history: [],
      historyIndex: -1,
      visitCounts: {},
      renderCounts: {},
      transitionConfig: null,
      nextTransition: null,
    });
  });

  describe('initial state', () => {
    it('transitionConfig is null by default', () => {
      expect(useStoryStore.getState().transitionConfig).toBeNull();
    });

    it('nextTransition is null by default', () => {
      expect(useStoryStore.getState().nextTransition).toBeNull();
    });
  });

  describe('setTransition()', () => {
    it('sets a persistent default transition config', () => {
      const config: TransitionConfig = { type: 'fade', duration: 400 };
      useStoryStore.getState().setTransition(config);
      expect(useStoryStore.getState().transitionConfig).toEqual(config);
    });

    it('clears the persistent default with null', () => {
      useStoryStore.getState().setTransition({ type: 'crossfade' });
      useStoryStore.getState().setTransition(null);
      expect(useStoryStore.getState().transitionConfig).toBeNull();
    });

    it('does not affect nextTransition', () => {
      const next: TransitionConfig = { type: 'none' };
      useStoryStore.getState().setNextTransition(next);
      useStoryStore.getState().setTransition({ type: 'fade' });
      expect(useStoryStore.getState().nextTransition).toEqual(next);
    });
  });

  describe('setNextTransition()', () => {
    it('sets a one-shot transition override', () => {
      const config: TransitionConfig = { type: 'fade-through', pause: 100 };
      useStoryStore.getState().setNextTransition(config);
      expect(useStoryStore.getState().nextTransition).toEqual(config);
    });

    it('clears the one-shot override with null', () => {
      useStoryStore.getState().setNextTransition({ type: 'fade' });
      useStoryStore.getState().setNextTransition(null);
      expect(useStoryStore.getState().nextTransition).toBeNull();
    });

    it('does not affect transitionConfig', () => {
      const cfg: TransitionConfig = { type: 'crossfade', duration: 200 };
      useStoryStore.getState().setTransition(cfg);
      useStoryStore.getState().setNextTransition({ type: 'none' });
      expect(useStoryStore.getState().transitionConfig).toEqual(cfg);
    });
  });

  describe('consumeNextTransition()', () => {
    it('returns the one-shot value and clears it', () => {
      const config: TransitionConfig = { type: 'fade', duration: 300 };
      useStoryStore.getState().setNextTransition(config);

      const consumed = useStoryStore.getState().consumeNextTransition();
      expect(consumed).toEqual(config);
      expect(useStoryStore.getState().nextTransition).toBeNull();
    });

    it('returns null when nextTransition is already null', () => {
      const result = useStoryStore.getState().consumeNextTransition();
      expect(result).toBeNull();
      expect(useStoryStore.getState().nextTransition).toBeNull();
    });

    it('does not affect transitionConfig', () => {
      const cfg: TransitionConfig = { type: 'fade-through' };
      useStoryStore.getState().setTransition(cfg);
      useStoryStore.getState().setNextTransition({ type: 'none' });
      useStoryStore.getState().consumeNextTransition();
      expect(useStoryStore.getState().transitionConfig).toEqual(cfg);
    });
  });

  describe('getSavePayload()', () => {
    it('does NOT include transitionConfig in the payload', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().setTransition({ type: 'fade', duration: 500 });

      const payload = useStoryStore.getState().getSavePayload();
      expect('transitionConfig' in payload).toBe(false);
    });

    it('does NOT include nextTransition in the payload', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().setNextTransition({ type: 'crossfade' });

      const payload = useStoryStore.getState().getSavePayload();
      expect('nextTransition' in payload).toBe(false);
    });
  });

  describe('loadFromPayload()', () => {
    it('does NOT overwrite transitionConfig', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      const cfg: TransitionConfig = { type: 'fade', duration: 400 };
      useStoryStore.getState().setTransition(cfg);

      const payload = useStoryStore.getState().getSavePayload();
      useStoryStore.getState().loadFromPayload(payload);

      expect(useStoryStore.getState().transitionConfig).toEqual(cfg);
    });

    it('does NOT overwrite nextTransition', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      const next: TransitionConfig = { type: 'none' };
      useStoryStore.getState().setNextTransition(next);

      const payload = useStoryStore.getState().getSavePayload();
      useStoryStore.getState().loadFromPayload(payload);

      expect(useStoryStore.getState().nextTransition).toEqual(next);
    });
  });
});
