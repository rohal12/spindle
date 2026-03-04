import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import { executeStoryInit } from '../../src/story-init';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content = ''): Passage {
  return { pid, name, tags: [], content };
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

describe('useStoryStore', () => {
  beforeEach(() => {
    // Reset the store to initial state before each test
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
    });
  });

  describe('init()', () => {
    it('sets currentPassage to start passage and creates first history moment', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'End'),
      ]);

      useStoryStore.getState().init(story);

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Start');
      expect(state.storyData).toBe(story);
      expect(state.history).toHaveLength(1);
      expect(state.history[0].passage).toBe('Start');
      expect(state.historyIndex).toBe(0);
    });

    it('applies variableDefaults when provided', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      const defaults = { health: 100, name: 'Hero' };

      useStoryStore.getState().init(story, defaults);

      const state = useStoryStore.getState();
      expect(state.variables).toEqual({ health: 100, name: 'Hero' });
      expect(state.variableDefaults).toBe(defaults);
      expect(state.history[0].variables).toEqual({ health: 100, name: 'Hero' });
    });

    it("throws if start passage pid doesn't exist", () => {
      const story = makeStoryData(
        [makePassage(2, 'NotStart')],
        1, // pid 1 doesn't exist
      );

      expect(() => useStoryStore.getState().init(story)).toThrow(
        /Start passage.*not found/,
      );
    });
  });

  describe('navigate()', () => {
    it('changes currentPassage, pushes history moment, clears temporaries', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().setTemporary('temp1', 'value');

      useStoryStore.getState().navigate('Room');

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Room');
      expect(state.history).toHaveLength(2);
      expect(state.history[1].passage).toBe('Room');
      expect(state.historyIndex).toBe(1);
      expect(state.temporary).toEqual({});
    });

    it("logs error for nonexistent passage, doesn't change state", () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      const prevState = useStoryStore.getState();
      useStoryStore.getState().navigate('Nonexistent');

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe(prevState.currentPassage);
      expect(state.history).toHaveLength(prevState.history.length);
    });

    it('truncates forward history when navigating after goBack', () => {
      const story = makeStoryData([
        makePassage(1, 'A'),
        makePassage(2, 'B'),
        makePassage(3, 'C'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('B');
      useStoryStore.getState().navigate('C');

      // Go back to B, then navigate to a new path
      useStoryStore.getState().goBack();
      expect(useStoryStore.getState().currentPassage).toBe('B');

      useStoryStore.getState().navigate('A');

      const state = useStoryStore.getState();
      expect(state.history).toHaveLength(3); // A, B, A (C was truncated)
      expect(state.history[2].passage).toBe('A');
      expect(state.historyIndex).toBe(2);
    });
  });

  describe('goBack()', () => {
    it('restores previous passage and variables from history', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().setVariable('score', 10);
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().setVariable('score', 20);

      useStoryStore.getState().goBack();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Start');
      // History moment at index 0 was captured with variables: {}
      expect(state.variables).toEqual({});
      expect(state.historyIndex).toBe(0);
    });

    it('is a no-op when at history start', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().goBack();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Start');
      expect(state.historyIndex).toBe(0);
    });
  });

  describe('goForward()', () => {
    it('restores next passage from history', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().goBack();

      useStoryStore.getState().goForward();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Room');
      expect(state.historyIndex).toBe(1);
    });

    it('is a no-op when at history end', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('Room');

      useStoryStore.getState().goForward();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Room');
      expect(state.historyIndex).toBe(1);
    });
  });

  describe('setVariable() / setTemporary()', () => {
    it('setVariable updates the variables map', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().setVariable('name', 'Alice');
      useStoryStore.getState().setVariable('score', 42);

      const state = useStoryStore.getState();
      expect(state.variables).toEqual({ name: 'Alice', score: 42 });
    });

    it('setTemporary updates the temporary map', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().setTemporary('choice', 'left');

      expect(useStoryStore.getState().temporary).toEqual({ choice: 'left' });
    });
  });

  describe('deleteVariable() / deleteTemporary()', () => {
    it('deleteVariable removes a variable from the map', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().setVariable('health', 100);
      useStoryStore.getState().setVariable('gold', 50);
      useStoryStore.getState().deleteVariable('health');

      const state = useStoryStore.getState();
      expect(state.variables).toEqual({ gold: 50 });
      expect('health' in state.variables).toBe(false);
    });

    it('deleteTemporary removes a temporary variable from the map', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().setTemporary('choice', 'left');
      useStoryStore.getState().setTemporary('flag', true);
      useStoryStore.getState().deleteTemporary('choice');

      const state = useStoryStore.getState();
      expect(state.temporary).toEqual({ flag: true });
      expect('choice' in state.temporary).toBe(false);
    });

    it('deleteVariable is a no-op for nonexistent key', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().setVariable('existing', 'value');
      useStoryStore.getState().deleteVariable('nonexistent');

      expect(useStoryStore.getState().variables).toEqual({
        existing: 'value',
      });
    });

    it('deleteTemporary is a no-op for nonexistent key', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      useStoryStore.getState().setTemporary('existing', 'value');
      useStoryStore.getState().deleteTemporary('nonexistent');

      expect(useStoryStore.getState().temporary).toEqual({
        existing: 'value',
      });
    });
  });

  describe('restart()', () => {
    it('re-executes StoryInit to restore initial variables', () => {
      const story = makeStoryData([
        makePassage(1, 'Start', 'Welcome!'),
        makePassage(2, 'Room', 'A room.'),
        makePassage(3, 'StoryInit', '{set $health = 100}{set $gold = 50}'),
      ]);
      useStoryStore.getState().init(story);

      // Simulate what boot does: run StoryInit
      executeStoryInit();

      expect(useStoryStore.getState().variables).toEqual({
        health: 100,
        gold: 50,
      });

      // Mutate variables as gameplay would
      useStoryStore.getState().setVariable('health', 30);
      useStoryStore.getState().navigate('Room');

      // Restart should re-run StoryInit and restore initial values
      useStoryStore.getState().restart();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Start');
      expect(state.variables).toEqual({ health: 100, gold: 50 });
      expect(state.historyIndex).toBe(0);
      expect(state.history).toHaveLength(1);
    });

    it('resets to variableDefaults on restart', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      const defaults = { health: 100, name: 'Hero' };
      useStoryStore.getState().init(story, defaults);

      // Mutate variables
      useStoryStore.getState().setVariable('health', 30);
      useStoryStore.getState().setVariable('extra', 'value');
      useStoryStore.getState().navigate('Room');

      useStoryStore.getState().restart();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Start');
      expect(state.variables).toEqual({ health: 100, name: 'Hero' });
    });

    it('works when no StoryInit passage exists and no defaults', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().setVariable('foo', 'bar');
      useStoryStore.getState().navigate('Room');

      useStoryStore.getState().restart();

      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe('Start');
      expect(state.variables).toEqual({});
    });
  });

  describe('visited/rendered tracking', () => {
    it('init() records start passage as visited=1 and rendered=1', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      const state = useStoryStore.getState();
      expect(state.visitCounts).toEqual({ Start: 1 });
      expect(state.renderCounts).toEqual({ Start: 1 });
    });

    it('navigate() increments both visitCounts and renderCounts', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('Room');

      const state = useStoryStore.getState();
      expect(state.visitCounts).toEqual({ Start: 1, Room: 1 });
      expect(state.renderCounts).toEqual({ Start: 1, Room: 1 });

      // Navigate to Room again
      useStoryStore.getState().navigate('Room');

      const state2 = useStoryStore.getState();
      expect(state2.visitCounts).toEqual({ Start: 1, Room: 2 });
      expect(state2.renderCounts).toEqual({ Start: 1, Room: 2 });
    });

    it('trackRender() increments only renderCounts', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Sidebar'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().trackRender('Sidebar');

      const state = useStoryStore.getState();
      expect(state.visitCounts).toEqual({ Start: 1 });
      expect(state.renderCounts).toEqual({ Start: 1, Sidebar: 1 });

      useStoryStore.getState().trackRender('Sidebar');
      const state2 = useStoryStore.getState();
      expect(state2.renderCounts.Sidebar).toBe(2);
    });

    it('goBack()/goForward() do not change counts', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('Room');

      const countsAfterNav = {
        visitCounts: { ...useStoryStore.getState().visitCounts },
        renderCounts: { ...useStoryStore.getState().renderCounts },
      };

      useStoryStore.getState().goBack();
      expect(useStoryStore.getState().visitCounts).toEqual(
        countsAfterNav.visitCounts,
      );
      expect(useStoryStore.getState().renderCounts).toEqual(
        countsAfterNav.renderCounts,
      );

      useStoryStore.getState().goForward();
      expect(useStoryStore.getState().visitCounts).toEqual(
        countsAfterNav.visitCounts,
      );
      expect(useStoryStore.getState().renderCounts).toEqual(
        countsAfterNav.renderCounts,
      );
    });

    it('restart() resets counts and records start passage', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().navigate('Room');

      useStoryStore.getState().restart();

      const state = useStoryStore.getState();
      expect(state.visitCounts).toEqual({ Start: 1 });
      expect(state.renderCounts).toEqual({ Start: 1 });
    });

    it('save/load round-trips the counts', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().trackRender('Start');

      const payload = useStoryStore.getState().getSavePayload();
      expect(payload.visitCounts).toEqual({ Start: 1, Room: 1 });
      expect(payload.renderCounts).toEqual({ Start: 2, Room: 1 });

      // Reset then load
      useStoryStore.getState().restart();
      useStoryStore.getState().loadFromPayload(payload);

      const state = useStoryStore.getState();
      expect(state.visitCounts).toEqual({ Start: 1, Room: 1 });
      expect(state.renderCounts).toEqual({ Start: 2, Room: 1 });
    });

    it('loadFromPayload handles missing counts for backward compat', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);

      const payload = {
        passage: 'Start',
        variables: {},
        history: [{ passage: 'Start', variables: {}, timestamp: Date.now() }],
        historyIndex: 0,
      };
      useStoryStore.getState().loadFromPayload(payload);

      const state = useStoryStore.getState();
      expect(state.visitCounts).toEqual({});
      expect(state.renderCounts).toEqual({});
    });
  });

  describe('history snapshots', () => {
    it("are independent - mutating current variables doesn't affect history", () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      useStoryStore.getState().setVariable('score', 10);
      useStoryStore.getState().navigate('Room');

      // History moment for "Room" should have captured score=10
      const historyVars = useStoryStore.getState().history[1].variables;
      expect(historyVars).toEqual({ score: 10 });

      // Mutating current variables should not affect the history snapshot
      useStoryStore.getState().setVariable('score', 999);

      expect(useStoryStore.getState().history[1].variables).toEqual({
        score: 10,
      });
    });
  });
});
