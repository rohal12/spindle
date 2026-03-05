import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
import { executeStoryInit } from '../../src/story-init';
import type { StoryData, Passage } from '../../src/parser';
import { registerClass, clearRegistry } from '../../src/class-registry';
import {
  initPRNG,
  resetPRNG,
  random,
  isPRNGEnabled,
  getPRNGPull,
} from '../../src/prng';

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

  describe('class instance support', () => {
    class Player {
      name: string;
      hp: number;

      constructor(data: { name?: string; hp?: number } = {}) {
        this.name = data.name ?? 'Hero';
        this.hp = data.hp ?? 100;
      }

      damage(amount: number) {
        this.hp = Math.max(0, this.hp - amount);
      }

      get isDead(): boolean {
        return this.hp <= 0;
      }
    }

    beforeEach(() => {
      clearRegistry();
      registerClass('Player', Player);
    });

    it('class instances survive navigate (history snapshot is independent)', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);

      const player = new Player({ name: 'Hero', hp: 80 });
      useStoryStore.getState().setVariable('player', player);
      useStoryStore.getState().navigate('Room');

      // Current variable should be a deep clone
      const current = useStoryStore.getState().variables.player as Player;
      expect(current instanceof Player).toBe(true);
      expect(current.hp).toBe(80);
      current.damage(30);
      expect(current.hp).toBe(50);

      // History snapshot should be independent
      const historyPlayer = useStoryStore.getState().history[1].variables
        .player as Player;
      expect(historyPlayer instanceof Player).toBe(true);
      expect(historyPlayer.hp).toBe(80); // unaffected by current mutation
    });

    it('class instances survive goBack', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
        makePassage(3, 'Hall'),
      ]);
      useStoryStore.getState().init(story);

      const player = new Player({ name: 'Hero', hp: 80 });
      useStoryStore.getState().setVariable('player', player);
      useStoryStore.getState().navigate('Room');
      // Now history[1] has player with hp=80
      useStoryStore
        .getState()
        .setVariable('player', new Player({ name: 'Hero', hp: 50 }));
      useStoryStore.getState().navigate('Hall');
      // Now history[2] has player with hp=50

      useStoryStore.getState().goBack();
      // Restores from history[1] which has player with hp=80

      const restored = useStoryStore.getState().variables.player as Player;
      expect(restored instanceof Player).toBe(true);
      expect(restored.hp).toBe(80);
      restored.damage(10);
      expect(restored.hp).toBe(70);
    });

    it('class instances survive goForward', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);

      const player = new Player({ name: 'Hero', hp: 80 });
      useStoryStore.getState().setVariable('player', player);
      useStoryStore.getState().navigate('Room');

      useStoryStore.getState().goBack();
      useStoryStore.getState().goForward();

      const restored = useStoryStore.getState().variables.player as Player;
      expect(restored instanceof Player).toBe(true);
      expect(restored.hp).toBe(80);
    });

    it('class instances survive getSavePayload → loadFromPayload round-trip', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);

      const player = new Player({ name: 'Hero', hp: 65 });
      useStoryStore.getState().setVariable('player', player);
      useStoryStore.getState().navigate('Room');

      const payload = useStoryStore.getState().getSavePayload();

      // Reset
      useStoryStore.getState().restart();

      // Load
      useStoryStore.getState().loadFromPayload(payload);

      const restored = useStoryStore.getState().variables.player as Player;
      expect(restored instanceof Player).toBe(true);
      expect(restored.name).toBe('Hero');
      expect(restored.hp).toBe(65);
      expect(restored.isDead).toBe(false);
      restored.damage(65);
      expect(restored.isDead).toBe(true);
    });

    it('methods work after all operations', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
        makePassage(3, 'Hall'),
      ]);
      useStoryStore.getState().init(story);

      useStoryStore
        .getState()
        .setVariable('player', new Player({ name: 'Hero', hp: 100 }));
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().navigate('Hall');
      useStoryStore.getState().goBack();
      useStoryStore.getState().goForward();

      const payload = useStoryStore.getState().getSavePayload();
      useStoryStore.getState().loadFromPayload(payload);

      const p = useStoryStore.getState().variables.player as Player;
      expect(p instanceof Player).toBe(true);
      p.damage(40);
      expect(p.hp).toBe(60);
      expect(p.isDead).toBe(false);
    });
  });

  describe('PRNG integration', () => {
    beforeEach(() => {
      resetPRNG();
    });

    it('navigate() captures PRNG snapshot in history moment', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      initPRNG('nav-test', false);
      random(); // pull = 1

      useStoryStore.getState().navigate('Room');

      const moment = useStoryStore.getState().history[1];
      expect(moment.prng).toEqual({ seed: 'nav-test', pull: 1 });
    });

    it('goBack() restores PRNG state', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
        makePassage(3, 'Hall'),
      ]);
      useStoryStore.getState().init(story);
      initPRNG('back-test', false);
      random();
      random(); // pull = 2

      useStoryStore.getState().navigate('Room');
      // moment[1] has prng with pull=2

      random();
      random();
      random(); // pull = 5

      useStoryStore.getState().navigate('Hall');
      // moment[2] has prng with pull=5

      random(); // pull = 6

      // Go back to Room (moment[1], pull=2)
      useStoryStore.getState().goBack();
      expect(getPRNGPull()).toBe(2);

      // Verify the sequence from pull=2 is reproducible
      const seq1 = Array.from({ length: 3 }, () => random());

      // Restore to pull=2 again via goForward then goBack
      useStoryStore.getState().goForward();
      useStoryStore.getState().goBack();
      const seq2 = Array.from({ length: 3 }, () => random());

      expect(seq1).toEqual(seq2);
    });

    it('goForward() restores PRNG state', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      initPRNG('fwd-test', false);
      random(); // pull = 1

      useStoryStore.getState().navigate('Room');
      // moment[1] has pull=1

      useStoryStore.getState().goBack();
      useStoryStore.getState().goForward();

      expect(getPRNGPull()).toBe(1);
    });

    it('restart() resets PRNG', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      initPRNG('restart-test', false);
      random();

      useStoryStore.getState().restart();

      expect(isPRNGEnabled()).toBe(false);
    });

    it('getSavePayload() includes PRNG snapshot', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      initPRNG('save-test', false);
      random();
      random();

      const payload = useStoryStore.getState().getSavePayload();
      expect(payload.prng).toEqual({ seed: 'save-test', pull: 2 });
    });

    it('loadFromPayload() restores PRNG state', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      initPRNG('load-test', false);
      random();
      random();
      random(); // pull = 3

      const seqAfter = Array.from({ length: 5 }, () => random());

      const payload = useStoryStore.getState().getSavePayload();
      // payload.prng has pull=8 now, but we want to test with pull=3
      payload.prng = { seed: 'load-test', pull: 3 };

      resetPRNG();
      useStoryStore.getState().loadFromPayload(payload);

      expect(isPRNGEnabled()).toBe(true);
      expect(getPRNGPull()).toBe(3);
      const restored = Array.from({ length: 5 }, () => random());
      expect(restored).toEqual(seqAfter);
    });

    it('loadFromPayload() handles missing prng field (backward compat)', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      initPRNG('compat-test', false);

      const payload = {
        passage: 'Start',
        variables: {},
        history: [{ passage: 'Start', variables: {}, timestamp: Date.now() }],
        historyIndex: 0,
      };
      useStoryStore.getState().loadFromPayload(payload);

      expect(isPRNGEnabled()).toBe(false);
    });

    it('save then load resumes the same random sequence', () => {
      const story = makeStoryData([makePassage(1, 'Start')]);
      useStoryStore.getState().init(story);
      initPRNG('save-load-seq', false);

      random(); // pull = 1
      const payload = useStoryStore.getState().getSavePayload();

      const valueBeforeLoad = random(); // pull = 2

      // Load restores to pull = 1, so next random() should equal valueBeforeLoad
      useStoryStore.getState().loadFromPayload(payload);
      expect(random()).toBe(valueBeforeLoad);
    });

    it('history moments without prng field reset PRNG on goBack', () => {
      const story = makeStoryData([
        makePassage(1, 'Start'),
        makePassage(2, 'Room'),
      ]);
      useStoryStore.getState().init(story);
      // Navigate without PRNG enabled — moment has no prng field
      useStoryStore.getState().navigate('Room');

      // Enable PRNG after navigating
      initPRNG('late-init', false);

      useStoryStore.getState().goBack();
      // Should reset since moment[0] has no prng
      expect(isPRNGEnabled()).toBe(false);
    });
  });
});
