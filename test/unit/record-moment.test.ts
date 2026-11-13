// @vitest-environment happy-dom
/**
 * Story.recordMoment(): a change made on a passage becomes part of the
 * moment's recorded state without a navigation, so a page refresh (session
 * restore), a save made there and loaded, and moving through history
 * restore it instead of the state on entering the passage.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { initializeStory } from '../../src/story-init';
import { executeMutation } from '../../src/execute-mutation';
import { resetPRNG } from '../../src/prng';
import { on as emitterOn, resetEmitter } from '../../src/event-emitter';
import { connectTriggersToStore, resetTriggers } from '../../src/triggers';
import { registerClass, clearRegistry } from '../../src/class-registry';
import { encodePayload } from '../../src/saves/format';
import {
  decodeSavePayload,
  loadSession,
  saveWithHooks,
} from '../../src/saves/save-manager';
import type { EncodedPayload, SavePayload } from '../../src/saves/types';
import type { StoryData, Passage } from '../../src/parser';

const IFID = 'RECORD-MOMENT-IFID';

class Pack {
  items: string[] = [];
  constructor(data?: { items?: string[] }) {
    if (data) Object.assign(this, data);
  }
  add(item: string): void {
    this.items.push(item);
  }
}

function makePassage(pid: number, name: string, content = ''): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(storyInit?: string): StoryData {
  const passages = ['A', 'B', 'C', 'D'].map((n, i) => makePassage(i + 1, n));
  if (storyInit !== undefined) {
    passages.push(makePassage(5, 'StoryInit', storyInit));
  }
  return {
    name: 'Record Moment Test',
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
let Story: StoryAPI;
let disconnectTriggers: () => void;

const passages = () => store().history.map((m) => m.passage);

function historySnapshots(): Record<string, unknown>[] {
  return store().history.map((_, i) => ({ ...store().getHistoryVariables(i) }));
}

/** Simulate a page refresh: boot the story again and restore the session. */
function refresh(defaults: Record<string, unknown>, storyInit?: string): void {
  const payload = loadSession(IFID);
  expect(payload).toBeDefined();
  store().init(makeStoryData(storyInit), defaults);
  initializeStory(payload);
}

/** The game as a save stores it: encoded, through JSON. */
function stored(): EncodedPayload {
  return JSON.parse(JSON.stringify(encodePayload(store().getSavePayload())));
}

const load = (save: EncodedPayload): void =>
  store().loadFromPayload(decodeSavePayload(save));

describe('Story.recordMoment()', () => {
  beforeAll(() => {
    installStoryAPI();
    Story = window.Story;
    registerClass('Pack', Pack);
    disconnectTriggers = connectTriggersToStore();
  });

  afterAll(() => {
    disconnectTriggers();
    clearRegistry();
    useStoryStore.setState({ maxHistory: 40 });
  });

  beforeEach(() => {
    resetEmitter();
    resetTriggers();
    resetPRNG();
    _resetRuntimePhase();
    sessionStorage.clear();
    useStoryStore.setState({ maxHistory: 40 });
  });

  it('a refresh restores the change (and loses it when not recorded)', () => {
    store().init(makeStoryData(), { worn: 'none', gold: 0 });
    Story.goto('B');
    Story.set('worn', 'hat');
    refresh({ worn: 'none', gold: 0 });
    expect(store().currentPassage).toBe('B');
    // The state on entering the passage
    expect(Story.get('worn')).toBe('none');

    Story.set('worn', 'hat');
    Story.recordMoment();
    refresh({ worn: 'none', gold: 0 });
    expect(store().currentPassage).toBe('B');
    expect(Story.get('worn')).toBe('hat');
    expect(historySnapshots()).toEqual([
      { worn: 'none', gold: 0 },
      { worn: 'hat', gold: 0 },
    ]);
  });

  it('a refresh restores a change recorded on the start passage', () => {
    store().init(makeStoryData('{set $gold = 3}'), { worn: 'none', gold: 0 });
    initializeStory();
    Story.set('worn', 'hat');
    Story.recordMoment();
    refresh({ worn: 'none', gold: 0 }, '{set $gold = 3}');
    expect(store().currentPassage).toBe('A');
    expect({ ...store().variables }).toEqual({ worn: 'hat', gold: 3 });
  });

  it('a save made after it restores the change when loaded', () => {
    store().init(makeStoryData(), { worn: 'none' });
    Story.goto('B');
    Story.set('worn', 'hat');
    const unrecorded = stored();
    Story.recordMoment();
    const recorded = stored();

    Story.goto('C');
    Story.set('worn', 'scarf');
    load(unrecorded);
    expect(Story.get('worn')).toBe('none');
    load(recorded);
    expect(store().currentPassage).toBe('B');
    expect(Story.get('worn')).toBe('hat');
    expect(historySnapshots()).toEqual([{ worn: 'none' }, { worn: 'hat' }]);
  });

  it('back and forward return to the recorded state', () => {
    store().init(makeStoryData(), { worn: 'none' });
    Story.goto('B');
    Story.set('worn', 'hat');
    Story.recordMoment();

    Story.back();
    expect(Story.get('worn')).toBe('none');
    Story.forward();
    expect(store().currentPassage).toBe('B');
    expect(Story.get('worn')).toBe('hat');

    // Away and back
    Story.set('worn', 'scarf');
    Story.goto('C');
    expect(Story.get('worn')).toBe('scarf');
    Story.back();
    expect(store().currentPassage).toBe('B');
    expect(Story.get('worn')).toBe('hat');
    Story.forward();
    expect(Story.get('worn')).toBe('scarf');
  });

  it('drops the moments after the current one, as a navigation would', () => {
    store().init(makeStoryData(), { worn: 'none' });
    Story.goto('B');
    Story.goto('C');
    Story.goto('D');
    Story.back();
    Story.back();
    expect(passages()).toEqual(['A', 'B', 'C', 'D']);

    Story.set('worn', 'hat');
    Story.recordMoment();
    expect(passages()).toEqual(['A', 'B']);
    expect(store().historyIndex).toBe(1);
    expect(store().currentPassage).toBe('B');
    Story.forward();
    expect(store().currentPassage).toBe('B');
    expect(historySnapshots()).toEqual([{ worn: 'none' }, { worn: 'hat' }]);

    // The session holds the shortened history
    refresh({ worn: 'none' });
    expect(passages()).toEqual(['A', 'B']);
    expect(Story.get('worn')).toBe('hat');

    // History goes on from the recorded moment
    Story.goto('C');
    expect(passages()).toEqual(['A', 'B', 'C']);
    expect(historySnapshots()).toEqual([
      { worn: 'none' },
      { worn: 'hat' },
      { worn: 'hat' },
    ]);
  });

  it('does nothing when the variables are as recorded', () => {
    store().init(makeStoryData(), { worn: 'none', bag: ['key'] });
    Story.goto('B');
    Story.goto('C');
    Story.back();
    const key = `spindle.session.${IFID}`;
    const session = sessionStorage.getItem(key);
    expect(session).not.toBeNull();
    const history = store().history;

    Story.recordMoment();
    // Changed and changed back: still the recorded state
    Story.set('worn', 'hat');
    Story.set('worn', 'none');
    Story.set('bag', ['key']);
    Story.recordMoment();
    expect(store().history).toBe(history);
    expect(passages()).toEqual(['A', 'B', 'C']);
    expect(sessionStorage.getItem(key)).toBe(session);
    Story.forward();
    expect(store().currentPassage).toBe('C');

    // After a load the live variables are copies of the recorded ones
    load(stored());
    Story.back();
    Story.recordMoment();
    expect(passages()).toEqual(['A', 'B', 'C']);
  });

  it('the next navigation records its changes from the recorded state', () => {
    store().init(makeStoryData(), { worn: 'none', gold: 0 });
    Story.goto('B');
    Story.set({ worn: 'hat', found: 'ring' });
    Story.recordMoment();

    // Removed again after recording: gone from the next moment only
    executeMutation('delete $found; $gold = 5', {}, () => {});
    Story.goto('C');
    expect(historySnapshots()).toEqual([
      { worn: 'none', gold: 0 },
      { worn: 'hat', gold: 0, found: 'ring' },
      { worn: 'hat', gold: 5 },
    ]);
    Story.back();
    expect({ ...store().variables }).toEqual({
      worn: 'hat',
      gold: 0,
      found: 'ring',
    });
    Story.forward();
    expect({ ...store().variables }).toEqual({ worn: 'hat', gold: 5 });

    refresh({ worn: 'none', gold: 0 });
    expect(historySnapshots()).toEqual([
      { worn: 'none', gold: 0 },
      { worn: 'hat', gold: 0, found: 'ring' },
      { worn: 'hat', gold: 5 },
    ]);
  });

  it('records a variable deleted on the passage as deleted', () => {
    store().init(makeStoryData(), { worn: 'none', found: 'ring' });
    Story.goto('B');
    executeMutation('delete $found', {}, () => {});
    Story.recordMoment();
    Story.goto('C');
    Story.back();
    expect({ ...store().variables }).toEqual({ worn: 'none' });
    Story.back();
    expect({ ...store().variables }).toEqual({ worn: 'none', found: 'ring' });
  });

  it('records into history trimmed by maxHistory', () => {
    Story.config.maxHistory = 2;
    store().init(makeStoryData(), { n: 0, worn: 'none' });
    Story.set('n', 1);
    Story.goto('B');
    Story.set('n', 2);
    Story.goto('C');
    expect(passages()).toEqual(['B', 'C']);

    Story.set('worn', 'hat');
    Story.recordMoment();
    expect(historySnapshots()).toEqual([
      { n: 1, worn: 'none' },
      { n: 2, worn: 'hat' },
    ]);
    Story.back();
    expect({ ...store().variables }).toEqual({ n: 1, worn: 'none' });

    // The oldest moment kept (the base of the recorded history)
    Story.set('worn', 'scarf');
    Story.recordMoment();
    expect(passages()).toEqual(['B']);
    expect(historySnapshots()).toEqual([{ n: 1, worn: 'scarf' }]);

    // The following navigations trim it away as usual
    Story.set('n', 3);
    Story.goto('D');
    Story.set('n', 4);
    Story.goto('A');
    expect(passages()).toEqual(['D', 'A']);
    expect(historySnapshots()).toEqual([
      { n: 3, worn: 'scarf' },
      { n: 4, worn: 'scarf' },
    ]);
    refresh({ n: 0, worn: 'none' });
    expect(passages()).toEqual(['D', 'A']);
    expect({ ...store().variables }).toEqual({ n: 4, worn: 'scarf' });
  });

  it('records with a history of one moment, and through a lowered limit', () => {
    Story.config.maxHistory = 1;
    store().init(makeStoryData(), { worn: 'none' });
    Story.goto('B');
    Story.set('worn', 'hat');
    Story.recordMoment();
    expect(historySnapshots()).toEqual([{ worn: 'hat' }]);
    refresh({ worn: 'none' });
    expect(Story.get('worn')).toBe('hat');

    Story.config.maxHistory = 3;
    Story.goto('C');
    Story.goto('D');
    Story.set('worn', 'scarf');
    Story.recordMoment();
    Story.config.maxHistory = 2;
    expect(historySnapshots()).toEqual([{ worn: 'hat' }, { worn: 'scarf' }]);
    Story.back();
    expect(Story.get('worn')).toBe('hat');
    Story.forward();
    expect(Story.get('worn')).toBe('scarf');
  });

  it('records class instances, Maps and Sets, apart from the live values', () => {
    const defaults = { n: 0 };
    store().init(makeStoryData(), defaults);
    Story.set({
      pack: new Pack(),
      seen: new Map([['door', 1]]),
      tags: new Set(['wet']),
    });
    Story.goto('B');
    executeMutation(
      '$pack.add("rope"); $seen.set("key", 2); $tags.add("cold")',
      {},
      () => {},
    );
    Story.recordMoment();

    const expectRecorded = (vars: Record<string, unknown>) => {
      expect(vars.pack).toBeInstanceOf(Pack);
      expect((vars.pack as Pack).items).toEqual(['rope']);
      expect([...(vars.seen as Map<string, number>)]).toEqual([
        ['door', 1],
        ['key', 2],
      ]);
      expect([...(vars.tags as Set<string>)]).toEqual(['wet', 'cold']);
    };
    expectRecorded(store().getHistoryVariables(1));

    // Later changes are not in the recorded moment
    executeMutation(
      '$pack.add("lamp"); $seen.delete("door"); $tags.clear()',
      {},
      () => {},
    );
    expectRecorded(store().getHistoryVariables(1));
    expect({ ...store().getHistoryVariables(0) }).toEqual({ n: 0 });

    const save = stored();
    Story.goto('C');
    Story.back();
    expectRecorded(store().variables);
    Story.forward();
    expect((store().variables.pack as Pack).items).toEqual(['rope', 'lamp']);

    load(save);
    expectRecorded(store().variables);
    Story.set('n', 1);
    Story.recordMoment();
    refresh(defaults);
    expect(store().variables.n).toBe(1);
    expectRecorded(store().variables);
    // The restored instance works as one
    executeMutation('$pack.add("map")', {}, () => {});
    expect((store().variables.pack as Pack).items).toEqual(['rope', 'map']);
  });

  it('is not a navigation: no events, counts and temporaries stay', () => {
    store().init(makeStoryData(), { worn: 'none', hits: 0 });
    Story.goto('B');
    const events: string[] = [];
    emitterOn('beforenavigate', () => events.push('beforenavigate'));
    emitterOn('afternavigate', () => events.push('afternavigate'));
    Story.on('variableChanged', () => events.push('variableChanged'));
    Story.watch('$worn !== "none"', () => events.push('watch'));
    store().setTemporary('draft', 'x');
    Story.set('worn', 'hat');
    expect(events).toEqual(['watch', 'variableChanged']);
    const { navigationId, visitCounts, renderCounts, variables } = store();
    const timestamp = store().history[1]!.timestamp;

    Story.recordMoment();
    expect(events).toEqual(['watch', 'variableChanged']);
    expect(store().navigationId).toBe(navigationId);
    expect(store().visitCounts).toBe(visitCounts);
    expect(store().renderCounts).toBe(renderCounts);
    expect(store().variables).toBe(variables);
    expect(store().temporary.draft).toBe('x');
    expect(store().history[1]!.timestamp).toBe(timestamp);
    expect(Story.recordMoment()).toBeUndefined();
  });

  it('keeps the PRNG state the moment was entered with', () => {
    store().init(makeStoryData(), { roll: 0 });
    Story.prng.init('seed', false);
    Story.random();
    Story.goto('B');
    const entered = store().history[1]!.prng;
    const first = Story.random();
    const second = Story.random();
    Story.set('roll', second);
    Story.recordMoment();
    expect(store().history[1]!.prng).toEqual(entered);
    // Not taken back by recording
    expect(Story.prng.pull).toBe(entered!.pull + 2);

    // A restore replays the moment's rolls from its entry state
    refresh({ roll: 0 });
    expect(Story.get('roll')).toBe(second);
    expect(Story.random()).toBe(first);
    expect(Story.random()).toBe(second);
    Story.goto('C');
    Story.back();
    expect(Story.get('roll')).toBe(second);
    expect(Story.random()).toBe(first);
  });

  it('takes its place in program order inside running code', () => {
    store().init(makeStoryData(), { a: 0, b: 0 });
    Story.goto('B');
    executeMutation(
      '$a = 1; Story.recordMoment(); $b = Story.get("a") + 1',
      {},
      () => {},
    );
    // The code went on from the recorded state
    expect({ ...store().variables }).toEqual({ a: 1, b: 2 });
    expect(historySnapshots()).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 0 },
    ]);
    refresh({ a: 0, b: 0 });
    expect({ ...store().variables }).toEqual({ a: 1, b: 0 });
  });

  it('reports a value a save cannot hold as a navigation does', () => {
    store().init(makeStoryData(), { worn: 'none' });
    Story.goto('B');
    Story.set('worn', 'hat');
    Story.recordMoment();
    Story.set('onHit', () => {});
    expect(() => Story.recordMoment()).toThrow(
      'Cannot save a function (at $onHit)',
    );
    // Recorded all the same; the session keeps its last good copy
    expect(Object.keys(store().getHistoryVariables(1))).toEqual([
      'worn',
      'onHit',
    ]);
    expect(() => Story.goto('C')).toThrow('Cannot save a function');
    expect(() => Story.back()).toThrow('Cannot save a function');
    expect(typeof store().variables.onHit).toBe('function');
    const session = loadSession(IFID)!;
    expect(session.passage).toBe('B');
    expect(session.history[1]!.variables).toEqual({ worn: 'hat' });
  });

  /** Save through the `beforesave` hooks; the payload the save would store. */
  async function savedPayload(): Promise<SavePayload> {
    let payload: SavePayload | undefined;
    await saveWithHooks(undefined, undefined, store().beginSave, async (p) => {
      payload = p;
    });
    return payload!;
  }

  it('a save holds what its beforesave handler recorded once', async () => {
    store().init(makeStoryData(), { log: ['a'], n: 0 });
    Story.goto('B');
    emitterOn('beforesave', () => {
      executeMutation('$log.push("saved"); $n += 1', {}, () => {});
      Story.recordMoment();
      executeMutation('$log.push("after")', {}, () => {});
    });
    const payload = await savedPayload();
    expect(payload.history[1]!.variables).toEqual({
      log: ['a', 'saved', 'after'],
      n: 1,
    });
    // The live history has what was recorded, not the handler's later change
    expect(historySnapshots()[1]).toEqual({ log: ['a', 'saved'], n: 1 });
  });

  it('a save holds a change its handler made back to the recorded state once', async () => {
    store().init(makeStoryData(), { log: ['a', 'b'] });
    Story.goto('B');
    // Not recorded: the moment still has both
    executeMutation('$log.pop()', {}, () => {});
    emitterOn('beforesave', () => {
      executeMutation('$log.push("b")', {}, () => {});
      Story.recordMoment();
    });
    const payload = await savedPayload();
    expect(payload.history[1]!.variables).toEqual({ log: ['a', 'b'] });
  });

  it('leaves the start moment to StoryInit and the storyinit handlers', () => {
    const storyInit =
      '{do}$a = 1; Story.recordMoment(); $b = 2{/do}{set $c = 3}';
    const defaults = { a: 0, b: 0, c: 0, d: 0 };
    store().init(makeStoryData(storyInit), defaults);
    emitterOn('storyinit', () => {
      Story.set('d', 4);
      Story.recordMoment();
    });
    initializeStory();
    // No session of a half set up start: a refresh starts the game anew
    expect(loadSession(IFID)).toBeUndefined();
    expect(historySnapshots()).toEqual([{ a: 1, b: 2, c: 3, d: 4 }]);

    Story.restart();
    expect(loadSession(IFID)).toBeUndefined();
    expect(historySnapshots()).toEqual([{ a: 1, b: 2, c: 3, d: 4 }]);

    // With a session restored, the handlers change the restored moment
    Story.goto('B');
    Story.set('a', 9);
    Story.recordMoment();
    resetEmitter();
    emitterOn('storyinit', () => {
      Story.set('d', 5);
      Story.recordMoment();
    });
    refresh(defaults, storyInit);
    expect(historySnapshots()).toEqual([
      { a: 1, b: 2, c: 3, d: 4 },
      { a: 9, b: 2, c: 3, d: 5 },
    ]);
    expect(loadSession(IFID)!.history[1]!.variables).toEqual({
      a: 9,
      b: 2,
      c: 3,
      d: 5,
    });
  });

  it('leaves the moment a navigation enters to that navigation', () => {
    store().init(makeStoryData(), { steps: 0, seen: '' });
    Story.watch('visited("B") > 0', () => {
      Story.set('steps', 1);
      Story.recordMoment();
      Story.set('seen', 'B');
    });
    Story.goto('B');
    expect(historySnapshots()).toEqual([
      { steps: 0, seen: '' },
      { steps: 1, seen: 'B' },
    ]);
    refresh({ steps: 0, seen: '' });
    expect({ ...store().variables }).toEqual({ steps: 1, seen: 'B' });
  });

  it('records after a watcher threw while the passage was entered', () => {
    store().init(makeStoryData(), { worn: 'none' });
    Story.watch('visited("B") > 0', () => {
      throw new Error('boom');
    });
    expect(() => Story.goto('B')).toThrow('boom');
    expect(store().currentPassage).toBe('B');
    Story.set('worn', 'hat');
    Story.recordMoment();
    expect(historySnapshots()).toEqual([{ worn: 'none' }, { worn: 'hat' }]);
    refresh({ worn: 'none' });
    expect(store().currentPassage).toBe('B');
    expect(Story.get('worn')).toBe('hat');
  });

  it('cancels a forward move whose target it dropped', () => {
    store().init(makeStoryData(), { worn: 'none' });
    Story.goto('B');
    Story.goto('C');
    Story.back();
    emitterOn('beforenavigate', () => {
      Story.set('worn', 'hat');
      Story.recordMoment();
    });
    Story.forward();
    expect(store().currentPassage).toBe('B');
    expect(passages()).toEqual(['A', 'B']);
    expect(Story.get('worn')).toBe('hat');
  });

  it('leaves the history as it was when recording throws', () => {
    store().init(makeStoryData(), { worn: 'none', odd: null });
    Story.goto('B');
    Story.goto('C');
    Story.goto('D');
    Story.back();
    let armed = false;
    const odd = {};
    Object.defineProperty(odd, 'x', {
      enumerable: true,
      get() {
        if (armed) throw new Error('getter failed');
        return 1;
      },
    });
    Story.set('odd', odd);
    armed = true;
    expect(() => Story.recordMoment()).toThrow('getter failed');
    armed = false;
    expect(passages()).toEqual(['A', 'B', 'C', 'D']);
    Story.forward();
    expect(store().currentPassage).toBe('D');
    expect(historySnapshots()[3]).toEqual({ worn: 'none', odd: null });
  });

  it('does nothing before a story is loaded', () => {
    useStoryStore.setState({ storyData: null, history: [], historyIndex: -1 });
    expect(() => Story.recordMoment()).not.toThrow();
    expect(store().history).toEqual([]);
  });
});
