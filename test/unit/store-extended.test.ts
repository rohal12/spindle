import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore } from '../../src/store';
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

describe('store extended coverage', () => {
  beforeEach(() => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'Room', 'A room'),
      makePassage(3, 'End', 'The end'),
    ]);
    useStoryStore.getState().init(storyData);
  });

  describe('save/load/hasSave', () => {
    it('hasSave returns false initially', () => {
      expect(useStoryStore.getState().hasSave()).toBe(false);
    });

    it('save sets saveError to null before saving', () => {
      // Set a prior error
      useStoryStore.setState({ saveError: 'old error' });
      useStoryStore.getState().save();
      // save clears error synchronously
      expect(useStoryStore.getState().saveError).toBeNull();
    });

    it('load sets loadError to null before loading', () => {
      useStoryStore.setState({ loadError: 'old error' });
      useStoryStore.getState().load();
      expect(useStoryStore.getState().loadError).toBeNull();
    });

    it('save does nothing when storyData is null', () => {
      useStoryStore.setState({ storyData: null });
      useStoryStore.getState().save(); // should not throw
    });

    it('load does nothing when storyData is null', () => {
      useStoryStore.setState({ storyData: null });
      useStoryStore.getState().load(); // should not throw
    });

    it('hasSave returns false when storyData is null', () => {
      useStoryStore.setState({ storyData: null });
      expect(useStoryStore.getState().hasSave()).toBe(false);
    });

    it('hasSave returns true when saveVersion > 0', () => {
      useStoryStore.setState({ saveVersion: 1 });
      expect(useStoryStore.getState().hasSave()).toBe(true);
    });
  });

  describe('restart', () => {
    it('resets to start passage', () => {
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().setVariable('gold', 100);
      useStoryStore.getState().restart();
      expect(useStoryStore.getState().currentPassage).toBe('Start');
      expect(useStoryStore.getState().variables.gold).toBeUndefined();
    });

    it('resets history', () => {
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().navigate('End');
      useStoryStore.getState().restart();
      expect(useStoryStore.getState().history).toHaveLength(1);
      expect(useStoryStore.getState().historyIndex).toBe(0);
    });

    it('resets visit and render counts', () => {
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().restart();
      expect(useStoryStore.getState().visitCounts).toEqual({ Start: 1 });
      expect(useStoryStore.getState().renderCounts).toEqual({ Start: 1 });
    });

    it('clears temporaries', () => {
      useStoryStore.getState().setTemporary('temp', 'value');
      useStoryStore.getState().restart();
      expect(useStoryStore.getState().temporary).toEqual({});
    });

    it('does nothing when storyData is null', () => {
      useStoryStore.setState({ storyData: null });
      useStoryStore.getState().restart(); // should not throw
    });

    it('restores variable defaults on restart', () => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Hello'),
        makePassage(2, 'Room', 'Room'),
      ]);
      useStoryStore.getState().init(storyData, { health: 100 });
      useStoryStore.getState().setVariable('health', 50);
      useStoryStore.getState().restart();
      expect(useStoryStore.getState().variables.health).toBe(100);
    });
  });

  describe('navigate edge cases', () => {
    it('does nothing when storyData is null', () => {
      useStoryStore.setState({ storyData: null });
      useStoryStore.getState().navigate('Room'); // should not throw
    });

    it('truncates forward history on new navigation after goBack', () => {
      useStoryStore.getState().navigate('Room');
      useStoryStore.getState().navigate('End');
      useStoryStore.getState().goBack();
      useStoryStore.getState().goBack();
      // Now navigate to a new passage, should truncate forward history
      useStoryStore.getState().navigate('Room');
      expect(useStoryStore.getState().history).toHaveLength(2);
    });
  });

  describe('init', () => {
    it('throws when start passage not found', () => {
      const storyData = makeStoryData(
        [makePassage(2, 'NotStart', 'X')],
        1, // pid 1 doesn't exist
      );
      expect(() => useStoryStore.getState().init(storyData)).toThrow(
        'Start passage',
      );
    });

    it('initializes with variable defaults', () => {
      const storyData = makeStoryData([makePassage(1, 'Start', 'Hi')]);
      useStoryStore.getState().init(storyData, { hp: 100, name: 'Hero' });
      const vars = useStoryStore.getState().variables;
      expect(vars.hp).toBe(100);
      expect(vars.name).toBe('Hero');
    });

    it('sets up initial history moment', () => {
      const storyData = makeStoryData([makePassage(1, 'Start', 'Hi')]);
      useStoryStore.getState().init(storyData);
      expect(useStoryStore.getState().history).toHaveLength(1);
      expect(useStoryStore.getState().history[0]!.passage).toBe('Start');
      expect(useStoryStore.getState().historyIndex).toBe(0);
    });
  });

  describe('getSavePayload', () => {
    it('returns current state as payload', () => {
      useStoryStore.getState().setVariable('x', 42);
      useStoryStore.getState().navigate('Room');
      const payload = useStoryStore.getState().getSavePayload();
      expect(payload.passage).toBe('Room');
      expect(payload.variables.x).toBe(42);
      expect(payload.history).toHaveLength(2);
      expect(payload.historyIndex).toBe(1);
      expect(payload.visitCounts['Room']).toBe(1);
    });

    it('returns a deep copy (mutations do not affect store)', () => {
      useStoryStore.getState().setVariable('x', 1);
      const payload = useStoryStore.getState().getSavePayload();
      payload.variables.x = 999;
      expect(useStoryStore.getState().variables.x).toBe(1);
    });
  });

  describe('loadFromPayload', () => {
    it('restores state from payload', () => {
      useStoryStore.getState().setVariable('x', 42);
      useStoryStore.getState().navigate('Room');
      const payload = useStoryStore.getState().getSavePayload();

      // Change state
      useStoryStore.getState().navigate('End');
      useStoryStore.getState().setVariable('x', 0);

      // Restore
      useStoryStore.getState().loadFromPayload(payload);
      expect(useStoryStore.getState().currentPassage).toBe('Room');
      expect(useStoryStore.getState().variables.x).toBe(42);
    });

    it('clears temporaries on load', () => {
      useStoryStore.getState().setTemporary('t', 'val');
      const payload = useStoryStore.getState().getSavePayload();
      useStoryStore.getState().loadFromPayload(payload);
      expect(useStoryStore.getState().temporary).toEqual({});
    });

    it('handles payload without visitCounts/renderCounts', () => {
      const payload = useStoryStore.getState().getSavePayload();
      // Simulate old save without these fields
      delete (payload as any).visitCounts;
      delete (payload as any).renderCounts;
      useStoryStore.getState().loadFromPayload(payload);
      expect(useStoryStore.getState().visitCounts).toEqual({});
      expect(useStoryStore.getState().renderCounts).toEqual({});
    });
  });

  describe('trackRender', () => {
    it('increments render count for passage', () => {
      const initial = useStoryStore.getState().renderCounts['Start'] ?? 0;
      useStoryStore.getState().trackRender('Start');
      expect(useStoryStore.getState().renderCounts['Start']).toBe(initial + 1);
    });

    it('initializes render count for new passage', () => {
      useStoryStore.getState().trackRender('NewPassage');
      expect(useStoryStore.getState().renderCounts['NewPassage']).toBe(1);
    });
  });

  describe('deleteVariable / deleteTemporary', () => {
    it('deleteVariable removes the key', () => {
      useStoryStore.getState().setVariable('x', 1);
      useStoryStore.getState().deleteVariable('x');
      expect(useStoryStore.getState().variables.x).toBeUndefined();
    });

    it('deleteTemporary removes the key', () => {
      useStoryStore.getState().setTemporary('t', 1);
      useStoryStore.getState().deleteTemporary('t');
      expect(useStoryStore.getState().temporary.t).toBeUndefined();
    });
  });
});
