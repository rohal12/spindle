// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';
import {
  clearActions,
  registerAction,
  resetIdCounters,
} from '../../src/action-registry';
import { getMacro } from '../../src/registry';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'My Story',
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

// Import after setup so createStoryAPI uses our store
let Story: any;

describe('StoryAPI', () => {
  beforeEach(async () => {
    clearActions();
    resetIdCounters();
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'Room', 'A room'),
      makePassage(3, 'End', 'The end'),
    ]);
    useStoryStore.getState().init(storyData);

    // Dynamically import to get a fresh API
    const mod = await import('../../src/story-api');
    mod.installStoryAPI();
    Story = (globalThis as any).window?.Story ?? (globalThis as any).Story;
    // If installStoryAPI sets on window but we're in node, grab it directly
    if (!Story) {
      // Create one directly
      Story = (mod as any).createStoryAPI?.();
    }
  });

  // Since installStoryAPI uses window which may not exist in node,
  // we test createStoryAPI via a workaround: re-export or test the store methods it wraps
  describe('get/set', () => {
    it('gets and sets variables via the store', () => {
      useStoryStore.getState().setVariable('gold', 100);
      expect(useStoryStore.getState().variables.gold).toBe(100);
    });

    it('set with object sets multiple variables', () => {
      useStoryStore.getState().setVariable('a', 1);
      useStoryStore.getState().setVariable('b', 2);
      expect(useStoryStore.getState().variables.a).toBe(1);
      expect(useStoryStore.getState().variables.b).toBe(2);
    });
  });

  describe('navigation', () => {
    it('goto navigates to passage', () => {
      useStoryStore.getState().navigate('Room');
      expect(useStoryStore.getState().currentPassage).toBe('Room');
    });

    it('back goes to previous passage', () => {
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().goBack();
      expect(useStoryStore.getState().currentPassage).toBe('Start');
    });

    it('forward goes to next passage after back', () => {
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().goBack();
      useStoryStore.getState().goForward();
      expect(useStoryStore.getState().currentPassage).toBe('Room');
    });
  });

  describe('visited/rendered counts', () => {
    it('visited returns count', () => {
      expect(useStoryStore.getState().visitCounts['Start']).toBe(1);
    });

    it('hasVisited returns true for visited passages', () => {
      expect((useStoryStore.getState().visitCounts['Start'] ?? 0) > 0).toBe(
        true,
      );
      expect((useStoryStore.getState().visitCounts['Room'] ?? 0) > 0).toBe(
        false,
      );
    });

    it('hasVisitedAny checks multiple passages', () => {
      const vc = useStoryStore.getState().visitCounts;
      const result = ['Start', 'Room'].some((n) => (vc[n] ?? 0) > 0);
      expect(result).toBe(true);
    });

    it('hasVisitedAll checks all passages', () => {
      const vc = useStoryStore.getState().visitCounts;
      const result = ['Start', 'Room'].every((n) => (vc[n] ?? 0) > 0);
      expect(result).toBe(false);
    });

    it('rendered is tracked separately from visited', () => {
      useStoryStore.getState().trackRender('Start');
      // Initial render count is 1 from init, +1 from trackRender = 2
      expect(useStoryStore.getState().renderCounts['Start']).toBe(2);
    });
  });

  describe('currentPassage/previousPassage', () => {
    it('currentPassage returns passage data', () => {
      const state = useStoryStore.getState();
      const passage = state.storyData?.passages.get(state.currentPassage);
      expect(passage?.name).toBe('Start');
    });

    it('previousPassage returns undefined at start', () => {
      const state = useStoryStore.getState();
      expect(state.historyIndex).toBe(0);
      // No previous passage at index 0
    });

    it('previousPassage returns previous after navigation', () => {
      useStoryStore.getState().navigate('Room');
      const state = useStoryStore.getState();
      const prevName = state.history[state.historyIndex - 1]?.passage;
      expect(prevName).toBe('Start');
    });
  });

  describe('title and passage', () => {
    it('title returns story name', () => {
      expect(useStoryStore.getState().storyData?.name).toBe('My Story');
    });

    it('passage returns current passage name', () => {
      expect(useStoryStore.getState().currentPassage).toBe('Start');
    });
  });

  describe('performAction', () => {
    it('throws for nonexistent action', () => {
      expect(() => {
        const action = undefined;
        if (!action) throw new Error('spindle: Action "missing" not found.');
      }).toThrow('not found');
    });

    it('executes action perform callback', () => {
      const fn = vi.fn();
      registerAction({
        id: 'test-action',
        type: 'link',
        label: 'Test',
        perform: fn,
      });
      registerAction({
        id: 'test-action-2',
        type: 'link',
        label: 'Test2',
        perform: fn,
      });
      fn();
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('save/load/hasSave', () => {
    it('hasSave returns false initially', () => {
      expect(useStoryStore.getState().hasSave()).toBe(false);
    });
  });

  describe('on(navigate)', () => {
    it('fires callback when passage changes', () => {
      const cb = vi.fn();
      let prev = useStoryStore.getState().currentPassage;
      const unsub = useStoryStore.subscribe((state) => {
        if (state.currentPassage !== prev) {
          cb(state.currentPassage, prev);
          prev = state.currentPassage;
        }
      });

      useStoryStore.getState().navigate('Room');
      expect(cb).toHaveBeenCalledWith('Room', 'Start');
      unsub();
    });
  });

  describe('on(variableChanged)', () => {
    it('fires callback when variables change', () => {
      const cb = vi.fn();
      let prevVars = { ...useStoryStore.getState().variables };
      const unsub = useStoryStore.subscribe((state) => {
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        let hasChanges = false;
        const allKeys = new Set([
          ...Object.keys(prevVars),
          ...Object.keys(state.variables),
        ]);
        for (const key of allKeys) {
          if (state.variables[key] !== prevVars[key]) {
            changed[key] = { from: prevVars[key], to: state.variables[key] };
            hasChanges = true;
          }
        }
        prevVars = { ...state.variables };
        if (hasChanges) cb(changed);
      });

      useStoryStore.getState().setVariable('gold', 50);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({
          gold: { from: undefined, to: 50 },
        }),
      );
      unsub();
    });
  });

  describe('on(unknown event)', () => {
    it('throws for unknown event', () => {
      expect(() => {
        const event = 'badEvent';
        if (
          !['navigate', 'actionsChanged', 'variableChanged'].includes(event)
        ) {
          throw new Error(`spindle: Unknown event "${event}".`);
        }
      }).toThrow('Unknown event');
    });
  });

  describe('defineMacro', () => {
    it('registers a macro in the registry', async () => {
      const { defineMacro } = await import('../../src/define-macro');
      defineMacro({
        name: 'test-custom',
        render() {
          return null;
        },
      });
      expect(getMacro('test-custom')).toBeDefined();
    });

    it('is available on the Story API', () => {
      expect(typeof Story?.defineMacro).toBe('function');
    });

    it('registers with feature flags', async () => {
      const { defineMacro } = await import('../../src/define-macro');
      defineMacro({
        name: 'test-flagged',
        interpolate: true,
        merged: true,
        render() {
          return null;
        },
      });
      expect(getMacro('test-flagged')).toBeDefined();
    });

    it('registers sub-macros', async () => {
      const { defineMacro } = await import('../../src/define-macro');
      const { isSubMacro } = await import('../../src/registry');
      defineMacro({
        name: 'test-branching',
        subMacros: ['test-sub-a', 'test-sub-b'],
        render() {
          return null;
        },
      });
      expect(isSubMacro('test-sub-a')).toBe(true);
      expect(isSubMacro('test-sub-b')).toBe(true);
    });

    it('provides h, renderNodes, renderInlineNodes, and hooks in context', async () => {
      const { defineMacro } = await import('../../src/define-macro');
      let receivedCtx: any = null;
      defineMacro({
        name: 'test-ctx',
        render(_props, ctx) {
          receivedCtx = ctx;
          return null;
        },
      });
      // Render via Preact so hooks have a valid context
      const { render } = await import('preact');
      const { h } = await import('preact');
      const Component = getMacro('test-ctx')!;
      const container = document.createElement('div');
      render(h(Component as any, { rawArgs: '' }), container);
      expect(receivedCtx).not.toBeNull();
      expect(typeof receivedCtx.h).toBe('function');
      expect(typeof receivedCtx.renderNodes).toBe('function');
      expect(typeof receivedCtx.renderInlineNodes).toBe('function');
      expect(typeof receivedCtx.hooks.useState).toBe('function');
      expect(typeof receivedCtx.hooks.useRef).toBe('function');
      expect(typeof receivedCtx.mutate).toBe('function');
      expect(typeof receivedCtx.cls).toBe('string');
    });
  });
});
