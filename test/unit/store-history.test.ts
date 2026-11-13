// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetPRNG } from '../../src/prng';
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';
import { decodeSavePayload, loadSession } from '../../src/saves/save-manager';
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
    resetPRNG();
    _resetRuntimePhase();
    sessionStorage.clear();
    useStoryStore.setState({ maxHistory: 40 });
  });

  describe('superseded normal navigation (#598)', () => {
    it('keeps a callback redirect and records only that visit', () => {
      store().init(makeStoryData(), { n: 0 });
      const after: string[] = [];
      emitterOn('afternavigate', (to) => after.push(to));
      emitterOn('beforenavigate', (to) => {
        if (to === 'B') {
          store().setVariable('n', 7);
          store().navigate('C');
        }
      });
      store().navigate('B');
      expect(store().currentPassage).toBe('C');
      expect(store().history.map((m) => m.passage)).toEqual(['A', 'C']);
      expect(historySnapshots()).toEqual([{ n: 0 }, { n: 7 }]);
      expect(store().visitCounts.B).toBeUndefined();
      expect(store().visitCounts.C).toBe(1);
      expect(after).toEqual(['C']);
    });

    it.each(['goBack', 'goForward'] as const)(
      'keeps a callback %s without adding a new moment',
      (action) => {
        store().init(makeStoryData(), { n: 0 });
        store().setVariable('n', 1);
        store().navigate('B');
        if (action === 'goForward') store().goBack();
        emitterOn('beforenavigate', (to) => {
          if (to === 'D') store()[action]();
        });
        store().navigate('D');
        const index = action === 'goBack' ? 0 : 1;
        expect(store().currentPassage).toBe(index === 0 ? 'A' : 'B');
        expect(store().historyIndex).toBe(index);
        expect(store().variables.n).toBe(index);
        expect(store().history.map((m) => m.passage)).toEqual(['A', 'B']);
        expect(store().visitCounts.D).toBeUndefined();
      },
    );

    it('allows variable-only callbacks to update the entered moment', () => {
      store().init(makeStoryData(), { n: 0 });
      emitterOn('beforenavigate', () => store().setVariable('n', 4));
      store().navigate('B');
      expect(store().currentPassage).toBe('B');
      expect(historySnapshots()).toEqual([{ n: 0 }, { n: 4 }]);
    });
  });

  it('does not expand snapshots that loading will discard (#628)', () => {
    store().init(makeStoryData(), { n: 0 });
    store().setMaxHistory(2);
    const payload = store().getSavePayload();
    const discarded = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('discarded variables were expanded');
        },
      },
    );
    payload.history = [
      { passage: 'A', timestamp: 0, variables: discarded },
      { passage: 'B', timestamp: 1, variables: { n: 1 } },
      { passage: 'C', timestamp: 2, variables: { n: 2 } },
    ];
    payload.historyIndex = 2;
    payload.passage = 'C';
    store().loadFromPayload(payload);
    expect(store().history.map((m) => m.passage)).toEqual(['B', 'C']);
    expect(historySnapshots()).toEqual([{ n: 1 }, { n: 2 }]);
    expect(store().historyIndex).toBe(1);
    store().goBack();
    expect(store().variables.n).toBe(1);
  });

  it('keeps repeated loaded namespaces shared in the session (#628)', () => {
    store().init(makeStoryData(), { n: 0 });
    const payload = store().getSavePayload();
    const shared = { n: 7, item: { name: 'shared' } };
    payload.history = Array.from({ length: 2000 }, (_, timestamp) => ({
      passage: 'A',
      timestamp,
      variables: shared,
    }));
    payload.historyIndex = 1999;
    store().loadFromPayload(payload);
    expect(store().history).toHaveLength(40);
    const session = loadSession(IFID)!;
    expect(session.history[0]!.variables).toBe(session.history[39]!.variables);
    expect(store().variables.n).toBe(7);
    store().setVariable('n', 8);
    store().goBack();
    expect(store().variables.n).toBe(7);
    expect(shared.n).toBe(7);
  });

  it.each([undefined, 'old-seed'])(
    'refreshes cached PRNG metadata after reseeding from %s (#702)',
    (seed) => {
      store().init(makeStoryData(), { n: 0 });
      installStoryAPI();
      const Story = window.Story;
      if (seed) Story.prng.init(seed, false);
      store().navigate('B');
      Story.prng.init('reseed', false);
      store().navigate('C');
      store().goBack();
      expect(Story.prng.seed).toBe('reseed');
      store().goForward();

      refresh({ n: 0 });
      store().goBack();
      expect(store().currentPassage).toBe('B');
      expect(Story.prng.isEnabled()).toBe(true);
      expect(Story.prng.seed).toBe('reseed');
    },
  );

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

  describe('lowering maxHistory', () => {
    const session = () =>
      decodeSavePayload(
        JSON.parse(sessionStorage.getItem(`spindle.session.${IFID}`)!),
      ) as unknown as {
        passage: string;
        history: { passage: string; variables: Record<string, unknown> }[];
        historyIndex: number;
      };

    function walk(): void {
      store().init(makeStoryData(), { x: 0 });
      for (const [i, p] of (['B', 'C', 'D', 'B'] as const).entries()) {
        store().setVariable('x', i + 1);
        store().navigate(p);
      }
      // History: A(x0) B(x1) C(x2) D(x3) B(x4), at the last moment
    }

    it.each([
      ['goBack', 2, 'D', 3, 0],
      ['goBack', 4, 'D', 3, 2],
      ['goForward', 3, 'C', 2, 1],
    ] as const)(
      'restores the retained target after a %s callback trims history (#732)',
      (action, limit, passage, x, index) => {
        walk();
        if (action === 'goForward') {
          store().goBack();
          store().goBack();
          store().goBack();
        }
        installStoryAPI();
        const after: string[] = [];
        emitterOn('afternavigate', (to) => after.push(to));
        const off = emitterOn('beforenavigate', () => {
          window.Story.config.maxHistory = limit;
        });

        store()[action]();
        off();

        expect(store().currentPassage).toBe(passage);
        expect(store().variables).toEqual({ x });
        expect(store().historyIndex).toBe(index);
        expect(after).toEqual([passage]);
        refresh({ x: 0 });
        expect(store().currentPassage).toBe(passage);
        expect(store().variables).toEqual({ x });
        expect(store().historyIndex).toBe(index);
      },
    );

    it.each(['goBack', 'goForward'] as const)(
      'cancels %s when its callback removes the target (#732)',
      (action) => {
        walk();
        if (action === 'goForward') {
          while (store().historyIndex > 0) store().goBack();
        }
        const passage = store().currentPassage;
        const navigation = store().navigationId;
        store().setVariable('x', 99);
        store().setTemporary('note', 'keep');
        installStoryAPI();
        const after: string[] = [];
        emitterOn('afternavigate', (to) => after.push(to));
        emitterOn('beforenavigate', () => {
          window.Story.config.maxHistory = 1;
        });

        expect(() => store()[action]()).not.toThrow();

        expect(store().history.map((m) => m.passage)).toEqual([passage]);
        expect(store().historyIndex).toBe(0);
        expect(store().currentPassage).toBe(passage);
        expect(store().variables).toEqual({ x: 99 });
        expect(store().temporary.note).toBe('keep');
        expect(store().navigationId).toBe(navigation);
        expect(after).toEqual([]);
        expect(session().passage).toBe(passage);
        expect(session().historyIndex).toBe(0);
      },
    );

    it('trims the oldest moments at once', () => {
      walk();
      useStoryStore.getState().setMaxHistory(2);

      expect(store().history.map((m) => m.passage)).toEqual(['D', 'B']);
      expect(store().historyIndex).toBe(1);
      expect(historySnapshots()).toEqual([{ x: 3 }, { x: 4 }]);
      store().goBack();
      expect(store().currentPassage).toBe('D');
      store().goBack();
      expect(store().currentPassage).toBe('D');
      expect(store().variables).toEqual({ x: 3 });

      // The session autosave holds the trimmed history
      expect(session().history.map((m) => m.passage)).toEqual(['D', 'B']);
      expect(session().historyIndex).toBe(0);
      expect(session().history.map((m) => m.variables)).toEqual([
        { x: 3 },
        { x: 4 },
      ]);
    });

    it('keeps the current moment when it is older than the newest ones', () => {
      walk();
      store().goBack();
      store().goBack();
      store().goBack();
      expect(store().currentPassage).toBe('B');
      store().setVariable('x', 99);

      useStoryStore.getState().setMaxHistory(2);

      // The newest moments that include the current one: B (current) and C
      expect(store().history.map((m) => m.passage)).toEqual(['B', 'C']);
      expect(store().historyIndex).toBe(0);
      expect(store().currentPassage).toBe('B');
      // Live changes since entering the moment are kept
      expect(store().variables).toEqual({ x: 99 });
      expect(historySnapshots()).toEqual([{ x: 1 }, { x: 2 }]);
      expect(session().history.map((m) => m.passage)).toEqual(['B', 'C']);
      expect(session().historyIndex).toBe(0);

      store().goForward();
      expect(store().currentPassage).toBe('C');
      store().goForward();
      expect(store().currentPassage).toBe('C');
      expect(store().variables).toEqual({ x: 2 });
    });

    it('also limits a loaded save made under a higher limit', () => {
      walk();
      const payload = store().getSavePayload();
      useStoryStore.getState().setMaxHistory(2);
      store().navigate('A');

      store().loadFromPayload(payload);
      expect(store().history.map((m) => m.passage)).toEqual(['D', 'B']);
      expect(store().historyIndex).toBe(1);
      expect(historySnapshots()).toEqual([{ x: 3 }, { x: 4 }]);
      expect(session().history.map((m) => m.passage)).toEqual(['D', 'B']);
    });

    it('leaves history alone when raised', () => {
      walk();
      useStoryStore.getState().setMaxHistory(3);
      useStoryStore.getState().setMaxHistory(10);

      expect(store().history.map((m) => m.passage)).toEqual(['C', 'D', 'B']);
      expect(historySnapshots()).toEqual([{ x: 2 }, { x: 3 }, { x: 4 }]);
    });
  });

  describe('serialized session after branching (#160)', () => {
    it('replaces the discarded forward moment at equal history length', () => {
      store().init(makeStoryData(), { x: 0 });
      store().navigate('B');
      store().navigate('C');
      store().setVariable('x', 3);
      store().goBack();
      store().setVariable('x', 4);
      store().navigate('D');

      const raw = decodeSavePayload(
        JSON.parse(sessionStorage.getItem(`spindle.session.${IFID}`)!),
      ) as any;
      expect(raw.passage).toBe('D');
      expect(raw.history.map((m: { passage: string }) => m.passage)).toEqual([
        'A',
        'B',
        'D',
      ]);
      expect(raw.history[2].variables).toEqual({ x: 4 });

      refresh({ x: 0 });
      expect(store().currentPassage).toBe('D');
      store().goBack();
      expect(store().currentPassage).toBe('B');
      store().goForward();
      expect(store().currentPassage).toBe('D');
      expect(store().variables).toEqual({ x: 4 });
    });

    it('drops discarded forward moments when the new history is shorter', () => {
      store().init(makeStoryData(), { x: 0 });
      store().navigate('B');
      store().navigate('C');
      store().navigate('B');
      store().navigate('C');
      store().goBack();
      store().goBack();
      store().goBack();
      expect(store().currentPassage).toBe('B');
      store().setVariable('x', 9);
      store().navigate('D');

      const raw = decodeSavePayload(
        JSON.parse(sessionStorage.getItem(`spindle.session.${IFID}`)!),
      ) as any;
      expect(raw.history.map((m: { passage: string }) => m.passage)).toEqual([
        'A',
        'B',
        'D',
      ]);

      refresh({ x: 0 });
      expect(store().history.map((m) => m.passage)).toEqual(['A', 'B', 'D']);
      store().goBack();
      store().goForward();
      expect(store().currentPassage).toBe('D');
      expect(store().variables).toEqual({ x: 9 });
      store().goForward();
      expect(store().currentPassage).toBe('D');
    });
  });

  describe('beforenavigate variable changes (#164)', () => {
    it('records primitive changes in the destination snapshot', () => {
      store().init(makeStoryData(), { x: 0 });
      const off = emitterOn('beforenavigate', () =>
        store().setVariable('x', 9),
      );
      store().navigate('B');
      off();

      expect(store().variables).toEqual({ x: 9 });
      expect(historySnapshots()).toEqual([{ x: 0 }, { x: 9 }]);
      expect(store().getSavePayload().history[1]!.variables).toEqual({ x: 9 });

      store().goBack();
      expect(store().variables).toEqual({ x: 0 });
      store().goForward();
      expect(store().variables).toEqual({ x: 9 });
    });

    it('records nested changes in the destination snapshot', () => {
      store().init(makeStoryData(), { player: { hp: 10, items: ['a'] } });
      const off = emitterOn('beforenavigate', () => {
        useStoryStore.setState((s) => {
          const player = s.variables.player as {
            hp: number;
            items: string[];
          };
          player.hp = 5;
          player.items.push('b');
        });
      });
      store().navigate('B');
      off();

      const before = { player: { hp: 10, items: ['a'] } };
      const after = { player: { hp: 5, items: ['a', 'b'] } };
      expect(historySnapshots()).toEqual([before, after]);

      store().navigate('C');
      expect(historySnapshots()).toEqual([before, after, after]);

      store().goBack();
      expect(store().variables).toEqual(after);
      store().goBack();
      expect(store().variables).toEqual(before);
      store().goForward();
      expect(store().variables).toEqual(after);
      store().goForward();
      expect(store().variables).toEqual(after);
    });
  });

  describe('how the story moved, and reading the history', () => {
    /** What `Story.history` reads now. */
    const read = () => {
      const { history } = window.Story;
      return {
        length: history.length,
        index: history.index,
        passage: history.passage(),
        variables: { ...history.variables() },
      };
    };

    /** A at x0, B at x1, C at x2, with the Story API installed. */
    function walk(): void {
      store().init(makeStoryData(), { x: 0 });
      installStoryAPI();
      store().setVariable('x', 1);
      window.Story.goto('B');
      store().setVariable('x', 2);
      window.Story.goto('C');
    }

    it('tells a new step from a move back or forward', () => {
      store().init(makeStoryData(), { x: 0 });
      installStoryAPI();
      const Story = window.Story;
      const events: unknown[][] = [];
      Story.on('beforenavigate', (...args) => events.push(['before', ...args]));
      Story.on('afternavigate', (...args) => events.push(['after', ...args]));

      Story.goto('B');
      Story.back();
      Story.forward();
      Story.back();
      Story.goto('C');

      expect(events).toEqual([
        ['before', 'B', 'navigate'],
        ['after', 'B', 'A', 'navigate'],
        ['before', 'A', 'back'],
        ['after', 'A', 'B', 'back'],
        ['before', 'B', 'forward'],
        ['after', 'B', 'A', 'forward'],
        ['before', 'A', 'back'],
        ['after', 'A', 'B', 'back'],
        ['before', 'C', 'navigate'],
        ['after', 'C', 'A', 'navigate'],
      ]);
    });

    it('reports a navigation its own handler started with that one’s kind', () => {
      walk();
      const Story = window.Story;
      const events: string[] = [];
      Story.on('afternavigate', (to, from, kind) =>
        events.push(`${from}>${to} ${kind}`),
      );
      let redirect = true;
      Story.on('beforenavigate', (to, kind) => {
        events.push(`before ${to} ${kind}`);
        if (redirect) {
          redirect = false;
          Story.back();
        }
      });

      // The handler's Back takes the place of the navigation to D
      Story.goto('D');

      expect(store().currentPassage).toBe('B');
      expect(events).toEqual([
        'before D navigate',
        'before B back',
        'C>B back',
      ]);
    });

    it('reads the moments kept and the current one', () => {
      walk();
      const { history } = window.Story;

      expect(history.length).toBe(3);
      expect(history.index).toBe(2);
      expect([0, 1, 2].map((i) => history.passage(i))).toEqual(['A', 'B', 'C']);
      expect([0, 1, 2].map((i) => history.variables(i))).toEqual([
        { x: 0 },
        { x: 1 },
        { x: 2 },
      ]);
      expect(history.passage()).toBe('C');
      expect(history.variables()).toEqual({ x: 2 });

      window.Story.back();
      expect(read()).toEqual({
        length: 3,
        index: 1,
        passage: 'B',
        variables: { x: 1 },
      });
    });

    it('reads the state on entering a moment, not later changes in it', () => {
      walk();
      store().setVariable('x', 50);

      expect(window.Story.get('x')).toBe(50);
      expect(window.Story.history.variables()).toEqual({ x: 2 });
      window.Story.back();
      window.Story.forward();
      expect(store().variables).toEqual(window.Story.history.variables());
    });

    it('reads the history before the move in beforenavigate and after it in afternavigate', () => {
      walk();
      const Story = window.Story;
      const seen: unknown[] = [];
      Story.on('beforenavigate', (to, kind) =>
        seen.push(['before', to, kind, read()]),
      );
      Story.on('afternavigate', (to, _from, kind) =>
        seen.push(['after', to, kind, read()]),
      );
      const at = (
        length: number,
        index: number,
        passage: string,
        x: number,
      ) => ({ length, index, passage, variables: { x } });

      Story.back();
      Story.back();
      Story.forward();
      // A new step from B drops the moment after it (C)
      store().setVariable('x', 7);
      Story.goto('D');

      expect(seen).toEqual([
        ['before', 'B', 'back', at(3, 2, 'C', 2)],
        ['after', 'B', 'back', at(3, 1, 'B', 1)],
        ['before', 'A', 'back', at(3, 1, 'B', 1)],
        ['after', 'A', 'back', at(3, 0, 'A', 0)],
        ['before', 'B', 'forward', at(3, 0, 'A', 0)],
        ['after', 'B', 'forward', at(3, 1, 'B', 1)],
        ['before', 'D', 'navigate', at(3, 1, 'B', 1)],
        ['after', 'D', 'navigate', at(3, 2, 'D', 7)],
      ]);
    });

    it('counts from the oldest moment kept once the history is trimmed', () => {
      walk();
      const Story = window.Story;
      Story.config.maxHistory = 2;

      expect(Story.history.length).toBe(2);
      expect(Story.history.index).toBe(1);
      expect(Story.history.passage(0)).toBe('B');
      expect(Story.history.variables(0)).toEqual({ x: 1 });
      expect(() => Story.history.passage(2)).toThrow(RangeError);

      // A navigation over the limit drops the oldest moment
      const lengths: number[] = [];
      Story.on('afternavigate', () => lengths.push(Story.history.length));
      store().setVariable('x', 3);
      Story.goto('D');
      expect(lengths).toEqual([2]);
      expect(read()).toEqual({
        length: 2,
        index: 1,
        passage: 'D',
        variables: { x: 3 },
      });
      expect(Story.history.passage(0)).toBe('C');
      expect(Story.history.variables(0)).toEqual({ x: 2 });
    });

    it('reads a loaded game', () => {
      walk();
      window.Story.back();
      const payload = store().getSavePayload();
      store().restart();
      expect(read()).toEqual({
        length: 1,
        index: 0,
        passage: 'A',
        variables: { x: 0 },
      });

      store().loadFromPayload(payload);

      const { history } = window.Story;
      expect(history.length).toBe(3);
      expect(history.index).toBe(1);
      expect([0, 1, 2].map((i) => history.passage(i))).toEqual(['A', 'B', 'C']);
      expect([0, 1, 2].map((i) => history.variables(i))).toEqual([
        { x: 0 },
        { x: 1 },
        { x: 2 },
      ]);
    });

    it('reads the trimmed history of a save made under a higher limit', () => {
      walk();
      const payload = store().getSavePayload();
      window.Story.config.maxHistory = 2;
      store().loadFromPayload(payload);

      const { history } = window.Story;
      expect(history.length).toBe(2);
      expect(history.index).toBe(1);
      expect(history.passage(0)).toBe('B');
      expect(history.variables(0)).toEqual({ x: 1 });
      expect(history.variables()).toEqual({ x: 2 });
    });

    it('reads the history restored after a page refresh', () => {
      walk();
      window.Story.back();

      refresh({ x: 0 });

      const { history } = window.Story;
      expect(history.length).toBe(3);
      expect(history.index).toBe(1);
      expect(history.passage()).toBe('B');
      expect([0, 1, 2].map((i) => history.variables(i))).toEqual([
        { x: 0 },
        { x: 1 },
        { x: 2 },
      ]);
    });

    it('hands out frozen copies', () => {
      store().init(makeStoryData(), { bag: { coins: 1 } });
      installStoryAPI();
      window.Story.goto('B');
      const { history } = window.Story;

      const first = history.variables(0);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.bag)).toBe(true);
      expect(() => {
        (first.bag as { coins: number }).coins = 99;
      }).toThrow(TypeError);
      expect(() => {
        first.added = true;
      }).toThrow(TypeError);
      expect(history.variables(0)).not.toBe(first);
      expect(history.variables(0)).toEqual({ bag: { coins: 1 } });
      window.Story.back();
      expect(store().variables).toEqual({ bag: { coins: 1 } });
    });

    it.each([-1, 3, 1.5, NaN])(
      'throws a RangeError naming the valid range for index %s',
      (index) => {
        walk();
        const { history } = window.Story;
        const message = `spindle: History index ${index} is out of range: the history holds moments 0 to 2.`;
        expect(() => history.passage(index)).toThrow(new RangeError(message));
        expect(() => history.variables(index)).toThrow(new RangeError(message));
      },
    );

    it('cannot be written to', () => {
      walk();
      const history = window.Story.history as { length: number; index: number };
      expect(() => {
        history.length = 0;
      }).toThrow(TypeError);
      expect(() => {
        history.index = 0;
      }).toThrow(TypeError);
      expect(read()).toMatchObject({ length: 3, index: 2 });
    });
  });
});
