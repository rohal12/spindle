// @vitest-environment happy-dom
// What a save holds, through Story.save / Story.load and the session: cycles
// (also through class instances) and shared references survive; values a
// save cannot hold (functions, unregistered classes, unique symbols, symbol
// keys) make the save, and a navigation's session write, throw.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import {
  clearRegistry,
  registerClass,
  serialize,
} from '../../src/class-registry';
import { decodeSavePayload, loadSession } from '../../src/saves/save-manager';
import type { StoryData, Passage } from '../../src/parser';

class Hero {
  name: string;
  friend: Hero | null = null;
  bag = new Map<string, unknown>();
  constructor(name: string) {
    this.name = name;
  }
  greet() {
    return `I am ${this.name}`;
  }
}

class Unknown {
  v = 1;
}

const passage = (pid: number, name: string): Passage => ({
  pid,
  name,
  tags: [],
  metadata: {},
  content: name,
});

let ifidCounter = 0;
let ifid = '';

function storyData(): StoryData {
  ifid = `save-values-${++ifidCounter}`;
  const ps = [passage(1, 'Start'), passage(2, 'Room'), passage(3, 'Hall')];
  return {
    name: 'Save values',
    startNode: 1,
    ifid,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(ps.map((p) => [p.name, p])),
    passagesById: new Map(ps.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

/** A hero in a 2-cycle with a friend, holding itself in its own Map. */
function party() {
  const a = new Hero('Ada');
  const b = new Hero('Bo');
  a.friend = b;
  b.friend = a;
  a.bag.set('me', a);
  return { a, b, list: [a, b, a] };
}

/** Shared references within one variable, and a plain cycle. */
function world() {
  const shared = { gold: 3 };
  const cycle: Record<string, unknown> = { name: 'loop' };
  cycle.self = cycle;
  return {
    left: shared,
    right: shared,
    both: [shared, shared],
    when: new Map([['x', shared]]),
    cycle,
  };
}

function expectParty(p: any) {
  expect(p.a).toBeInstanceOf(Hero);
  expect(p.a.greet()).toBe('I am Ada');
  expect(p.a.friend).toBe(p.b);
  expect(p.b.friend).toBe(p.a);
  expect(p.a.bag.get('me')).toBe(p.a);
  expect(p.list[0]).toBe(p.a);
  expect(p.list[2]).toBe(p.a);
  expect(p.list[1]).toBe(p.b);
}

function expectWorld(w: any) {
  expect(w.left).toEqual({ gold: 3 });
  expect(w.right).toBe(w.left);
  expect(w.both[0]).toBe(w.left);
  expect(w.both[1]).toBe(w.left);
  expect(w.when.get('x')).toBe(w.left);
  expect(w.cycle.self).toBe(w.cycle);
}

describe('values in saves', () => {
  let Story: StoryAPI;

  beforeEach(async () => {
    resetBackend();
    await getBackend();
    resetEmitter();
    _resetRuntimePhase();
    sessionStorage.clear();
    clearRegistry();
    registerClass('Hero', Hero);
    useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
    useStoryStore.getState().init(storyData(), { hp: 100 });
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
    installStoryAPI();
    Story = window.Story;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetBackend();
    clearRegistry();
  });

  describe('cycles and shared references survive Story.save / Story.load', () => {
    it('in the loaded moment and in the history before it', async () => {
      Story.set('party', party());
      Story.set('world', world());
      // A load restores the state on entering the saved passage
      Story.goto('Room');
      Story.set('hp', 5);
      Story.goto('Hall');
      await Story.save('s');

      Story.set('party', null);
      Story.set('world', null);
      await Story.load('s');

      expect(Story.passage).toBe('Hall');
      expectParty(Story.get('party'));
      expectWorld(Story.get('world'));
      Story.back();
      expect(Story.passage).toBe('Room');
      expect(Story.get('hp')).toBe(100);
      expectParty(Story.get('party'));
      expectWorld(Story.get('world'));
    });

    it('between a reused and a new part of a variable (#269)', async () => {
      Story.set('graph', { a: { child: { x: 1 } }, b: { x: 2 } });
      const shared = { x: 1 };
      Story.set('graph', { a: { child: shared }, b: shared });
      Story.goto('Room');
      await Story.waitForActions();
      let graph = Story.get('graph') as any;
      expect(graph.a.child).toBe(graph.b);
      await Story.save('graph');
      await Story.load('graph');
      await Story.waitForActions();
      graph = Story.get('graph') as any;
      expect(graph.a.child).toBe(graph.b);
    });

    it('between variables, back and forward (#270)', async () => {
      Story.set({ left: { x: 0 }, right: { x: 0 } });
      Story.goto('Room');
      await Story.waitForActions();
      const shared = { x: 1 };
      Story.set({ left: shared, right: shared });
      Story.goto('Hall');
      await Story.waitForActions();
      expect(Story.get('left')).toBe(Story.get('right'));
      Story.back();
      await Story.waitForActions();
      Story.forward();
      await Story.waitForActions();
      expect(Story.get('left')).toBe(Story.get('right'));
      await Story.save('s');
      Story.set({ left: null, right: null });
      await Story.load('s');
      await Story.waitForActions();
      expect(Story.get('left')).toBe(Story.get('right'));
    });

    it('between a changed and an unchanged variable (#270)', async () => {
      const shared = { x: 0 };
      Story.set({ kept: { inner: shared }, moved: 1 });
      Story.goto('Room');
      await Story.waitForActions();
      Story.set('moved', shared);
      Story.goto('Hall');
      await Story.waitForActions();
      Story.back();
      await Story.waitForActions();
      Story.forward();
      await Story.waitForActions();
      expect(Story.get('moved')).toBe((Story.get('kept') as any).inner);
    });

    it('in an exported and imported save, through JSON text', async () => {
      Story.set('party', party());
      Story.goto('Room');
      await Story.save('s');
      const file = JSON.stringify(await Story.exportSave('s'));

      await Story.importSave(JSON.parse(file), 't');
      Story.set('party', null);
      await Story.load('t');
      expectParty(Story.get('party'));
    });

    it('in the session a reload restores', () => {
      Story.set('party', party());
      Story.set('world', world());
      Story.goto('Room');

      const session = loadSession(ifid)!;
      expectParty(session.history[1]!.variables.party);
      expectWorld(session.history[1]!.variables.world);
    });

    it('stores a value the history moments share once', async () => {
      const big = Array.from({ length: 200 }, (_, i) => ({ i }));
      Story.set('big', big);
      for (let i = 0; i < 5; i++) Story.goto(i % 2 ? 'Room' : 'Hall');
      await Story.save('s');
      const exported = (await Story.exportSave('s'))!;
      const stored = decodeSavePayload(exported.save.payload);
      expect(stored.history).toHaveLength(6);
      // Set after entering Start: the moments from Hall on hold it
      const first = stored.history[1]!.variables.big;
      expect(first).toEqual(big);
      for (const m of stored.history.slice(1)) {
        expect(m.variables.big).toBe(first);
      }
      // 200 items once, not six times
      expect(exported.save.payload.data.length).toBeLessThan(
        serialize(big).length * 2,
      );
    });
  });

  describe('values a save cannot hold', () => {
    it.each([
      ['a function', () => () => 1, /Cannot save a function \(at \$value\)/],
      [
        'a function nested in a Map',
        () => new Map([['cb', () => 1]]),
        /Cannot save a function \(at \$value\.get\("cb"\)\)/,
      ],
      [
        'an instance of an unregistered class',
        () => ({ u: new Unknown() }),
        /Cannot save an instance of class "Unknown", which is not registered .*\(at \$value\.u\)/,
      ],
      [
        'a unique symbol',
        () => [Symbol('x')],
        /Cannot save a unique symbol .*\(at \$value\[0\]\)/,
      ],
      [
        'an object with symbol keys',
        () => ({ [Symbol('k')]: 1 }),
        /Cannot save an object with symbol keys \(at \$value\)/,
      ],
    ])('Story.save() rejects %s, naming it', async (_, make, message) => {
      Story.set('value', make());
      await expect(Story.save('s')).rejects.toThrow(message);
      expect(Story.hasSave('s')).toBe(false);
    });

    it('names a value only an earlier history moment holds', async () => {
      Story.set('value', () => 1);
      expect(() => Story.goto('Room')).toThrow();
      Story.set('value', 0);
      expect(() => Story.goto('Hall')).toThrow(
        /Cannot save a function \(at \$value in history moment 1\)/,
      );
      await expect(Story.save('s')).rejects.toThrow(
        /\(at \$value in history moment 1\)/,
      );
    });

    it('saves Symbol.for symbols', async () => {
      Story.set('key', Symbol.for('spindle.key'));
      Story.goto('Room');
      await Story.save('s');
      Story.set('key', null);
      await Story.load('s');
      expect(Story.get('key')).toBe(Symbol.for('spindle.key'));
    });

    it('a navigation completes, then throws the session write error', () => {
      const after = vi.fn();
      Story.on('afternavigate', after);
      Story.goto('Room');
      const before = sessionStorage.getItem(`spindle.session.${ifid}`);
      expect(before).not.toBeNull();

      Story.set('cb', () => 1);
      expect(() => Story.goto('Hall')).toThrow(
        /spindle: Cannot save a function \(at \$cb\)/,
      );
      // The navigation itself happened, with its events
      expect(Story.passage).toBe('Hall');
      expect(after).toHaveBeenLastCalledWith('Hall', 'Room');
      // The session keeps its last good copy
      expect(sessionStorage.getItem(`spindle.session.${ifid}`)).toBe(before);

      // Back and forward write the session too
      expect(() => Story.back()).toThrow(/Cannot save a function/);
      expect(Story.passage).toBe('Room');
    });

    it('Story.load() rejects a save naming a class that is not registered', async () => {
      Story.set('party', party());
      Story.goto('Room');
      await Story.save('s');
      clearRegistry();
      await expect(Story.load('s')).rejects.toThrow(
        /class "Hero", which is not registered/,
      );
      expect(Story.passage).toBe('Room');
    });
  });
});
