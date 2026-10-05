// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';
import { loadSession } from '../../src/saves/save-manager';
import type { StoryData, Passage } from '../../src/parser';

const IFID = 'HISTORY-TEST-IFID';

function makePassage(pid: number, name: string): Passage {
  return { pid, name, tags: [], metadata: {}, content: '' };
}

function makeStoryData(): StoryData {
  const passages = ['A', 'B', 'C', 'D'].map((n, i) => makePassage(i + 1, n));
  return {
    name: 'History Test',
    startNode: 1,
    ifid: IFID,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

const store = () => useStoryStore.getState();

function historySnapshots(): Record<string, unknown>[] {
  return store().history.map((_, i) => store().getHistoryVariables(i));
}

/** Simulate a page refresh: re-init the story and restore the session. */
function refresh(defaults: Record<string, unknown>): void {
  store().init(makeStoryData(), defaults);
  const payload = loadSession(IFID);
  expect(payload).toBeDefined();
  store().loadFromPayload(payload!);
}

describe('history navigation', () => {
  beforeEach(() => {
    resetEmitter();
    _resetRuntimePhase();
    sessionStorage.clear();
    useStoryStore.setState({ maxHistory: 40 });
  });

  describe('back/forward restore recorded snapshots (#159)', () => {
    it('discards changes to variables untouched by the transition', () => {
      store().init(makeStoryData(), { y: 0 });
      store().navigate('B');
      store().setVariable('y', 7);

      store().goBack();
      expect(store().currentPassage).toBe('A');
      expect(store().variables).toEqual({ y: 0 });
    });

    it('discards changed, added and deleted variables on back', () => {
      store().init(makeStoryData(), { a: 1, b: 2 });
      store().navigate('B');
      store().setVariable('a', 10);
      store().setVariable('c', 3);
      store().deleteVariable('b');

      store().goBack();
      expect(store().variables).toEqual({ a: 1, b: 2 });
    });

    it('discards changed, added and deleted variables on forward', () => {
      store().init(makeStoryData(), { a: 1, b: 2 });
      store().setVariable('a', 5);
      store().navigate('B');
      store().goBack();

      store().setVariable('a', 10);
      store().setVariable('c', 3);
      store().deleteVariable('b');

      store().goForward();
      expect(store().currentPassage).toBe('B');
      expect(store().variables).toEqual({ a: 5, b: 2 });
    });

    it('back then forward round-trips to the recorded snapshots', () => {
      store().init(makeStoryData(), { n: 0 });
      store().setVariable('n', 1);
      store().navigate('B');
      store().setVariable('n', 2);
      store().navigate('C');
      store().setVariable('n', 99);
      store().setVariable('extra', true);

      store().goBack();
      expect(store().variables).toEqual({ n: 1 });
      store().setVariable('n', 50);
      store().goBack();
      expect(store().variables).toEqual({ n: 0 });
      store().deleteVariable('n');
      store().goForward();
      expect(store().variables).toEqual({ n: 1 });
      store().goForward();
      expect(store().variables).toEqual({ n: 2 });
      expect(historySnapshots()).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
    });

    it('discards nested edits on back', () => {
      store().init(makeStoryData(), { player: { hp: 10, items: ['a'] } });
      store().navigate('B');
      useStoryStore.setState((s) => {
        const player = s.variables.player as { hp: number; items: string[] };
        player.hp = 1;
        player.items.push('b');
      });

      store().goBack();
      expect(store().variables).toEqual({ player: { hp: 10, items: ['a'] } });
    });
  });
});
