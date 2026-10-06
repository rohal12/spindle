// @vitest-environment happy-dom
/**
 * Visit and render counters of passages named like Object.prototype members
 * (`constructor`, `toString`, `hasOwnProperty`, ...) or `__proto__` (#235):
 * a passage that was never visited counts 0, every visit counts 1 more, and
 * the counts survive restart, saves, exports and session restores. Counts
 * the store did not record itself (an inherited property, a value that is
 * not a count) read as 0.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encodePayload } from '../../src/saves/format';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { evaluate } from '../../src/expression';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import { decodeSavePayload, loadSession } from '../../src/saves/save-manager';
import type { StoryData, Passage } from '../../src/parser';

const INHERITED = [
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  '__proto__',
];

function makePassage(pid: number, name: string): Passage {
  return { pid, name, tags: [], metadata: {}, content: '' };
}

let ifidCounter = 0;

function makeStoryData(start = 'Start'): StoryData {
  const names = [
    start,
    ...['Start', 'Room', ...INHERITED].filter((n) => n !== start),
  ];
  const passages = names.map((name, i) => makePassage(i + 1, name));
  return {
    name: 'Passage counters',
    startNode: 1,
    ifid: `passage-counters-${++ifidCounter}`,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

const state = () => useStoryStore.getState();
let Story: StoryAPI;

/** Every way a story reads the counters of `name`. */
function counters(name: string) {
  const arg = JSON.stringify(name);
  return {
    visited: Story.visited(name),
    rendered: Story.rendered(name),
    hasVisited: Story.hasVisited(name),
    hasRendered: Story.hasRendered(name),
    hasVisitedAny: Story.hasVisitedAny(name),
    hasVisitedAll: Story.hasVisitedAll(name),
    hasRenderedAny: Story.hasRenderedAny(name),
    hasRenderedAll: Story.hasRenderedAll(name),
    expr: evaluate(
      `[visited(${arg}), rendered(${arg}), hasVisited(${arg}), ` +
        `hasRendered(${arg}), hasVisitedAny(${arg}), ` +
        `hasVisitedAll(${arg}), hasRenderedAny(${arg}), ` +
        `hasRenderedAll(${arg})]`,
      {},
      {},
    ),
  };
}

function expectCounts(name: string, visits: number, renders = visits) {
  expect(counters(name)).toEqual({
    visited: visits,
    rendered: renders,
    hasVisited: visits > 0,
    hasRendered: renders > 0,
    hasVisitedAny: visits > 0,
    hasVisitedAll: visits > 0,
    hasRenderedAny: renders > 0,
    hasRenderedAll: renders > 0,
    expr: [
      visits,
      renders,
      visits > 0,
      renders > 0,
      visits > 0,
      visits > 0,
      renders > 0,
      renders > 0,
    ],
  });
}

beforeEach(async () => {
  resetBackend();
  await getBackend();
  resetEmitter();
  _resetRuntimePhase();
  sessionStorage.clear();
  useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
  state().init(makeStoryData());
  await vi.waitFor(() => expect(state().playthroughId).not.toBe(''));
  installStoryAPI();
  Story = window.Story;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetBackend();
});

describe('passages named like Object.prototype members', () => {
  it.each(INHERITED)('count 0 for %s before it is visited', (name) => {
    expectCounts(name, 0);
    expectCounts('Start', 1);
  });

  it.each(INHERITED)('count visits and renders of %s', (name) => {
    state().navigate(name);
    expectCounts(name, 1);
    expect(Story.visited()).toBe(1);
    expect(Story.rendered()).toBe(1);
    expect(evaluate('[visited(), rendered(), hasVisited()]', {}, {})).toEqual([
      1,
      1,
      true,
    ]);

    state().navigate('Room');
    state().navigate(name);
    state().trackRender(name);
    expectCounts(name, 2, 3);
    expectCounts('Start', 1);
    expectCounts('Room', 1);
  });

  it('store a __proto__ count as an entry, leaving the prototype alone', () => {
    const proto = Object.getPrototypeOf(state().visitCounts) as unknown;
    state().navigate('__proto__');
    state().trackRender('__proto__');
    for (const counts of [state().visitCounts, state().renderCounts]) {
      expect(Object.getPrototypeOf(counts)).toBe(proto);
      expect(Object.keys(counts)).toContain('__proto__');
    }
    expect(
      Object.getOwnPropertyDescriptor(state().renderCounts, '__proto__'),
    ).toMatchObject({ value: 2 });
  });

  it.each(INHERITED)('count 1 for %s as the start passage', (name) => {
    state().init(makeStoryData(name));
    expect(state().currentPassage).toBe(name);
    expectCounts(name, 1);
    expect(Story.visited()).toBe(1);
    state().navigate('Room');
    state().restart();
    expectCounts(name, 1);
    expectCounts('Room', 0);
  });

  it.each(INHERITED)('reset the count of %s on restart', (name) => {
    state().navigate(name);
    state().restart();
    expectCounts(name, 0);
    expectCounts('Start', 1);
    state().navigate(name);
    expectCounts(name, 1);
  });

  it('keep their counts through back and forward', () => {
    state().navigate('constructor');
    state().navigate('__proto__');
    state().goBack();
    state().goBack();
    expectCounts('constructor', 1);
    expectCounts('__proto__', 1);
    state().goForward();
    expectCounts('__proto__', 1);
  });
});

describe('counters in saves', () => {
  function visitAll(): void {
    for (const name of INHERITED) state().navigate(name);
    state().navigate('constructor');
    state().trackRender('__proto__');
    state().navigate('Room');
  }

  function expectVisitedAll(): void {
    expectCounts('constructor', 2);
    expectCounts('__proto__', 1, 2);
    for (const name of ['toString', 'hasOwnProperty', 'valueOf']) {
      expectCounts(name, 1);
    }
    expectCounts('Room', 1);
  }

  it('hold every passage as an own entry of the payload', () => {
    visitAll();
    const { visitCounts, renderCounts } = state().getSavePayload();
    for (const name of INHERITED) {
      expect(Object.prototype.hasOwnProperty.call(visitCounts, name)).toBe(
        true,
      );
    }
    expect(JSON.parse(JSON.stringify(renderCounts))).toMatchObject({
      __proto__: 2,
      constructor: 2,
    });
  });

  it('survive a JSON round trip of the payload', () => {
    visitAll();
    // Saves serialize the variables only; the counters are plain data
    const live = state().getSavePayload();
    const payload = decodeSavePayload(
      JSON.parse(JSON.stringify(encodePayload(live))),
    );
    state().restart();
    expectCounts('constructor', 0);
    state().loadFromPayload(payload);
    expectVisitedAll();
    // Counting goes on from the loaded counts
    state().navigate('__proto__');
    expectCounts('__proto__', 2, 3);
  });

  it('survive save and load', async () => {
    visitAll();
    await Story.save('slot');
    state().restart();
    expectCounts('constructor', 0);
    await Story.load('slot');
    expectVisitedAll();
  });

  it('survive export and import', async () => {
    visitAll();
    await Story.save('slot');
    const exported = JSON.parse(
      JSON.stringify(await Story.exportSave('slot')),
    ) as unknown;
    state().restart();
    await Story.importSave(exported, 'copy');
    await Story.load('copy');
    expectVisitedAll();
  });

  it('survive a session restore', () => {
    visitAll();
    const { storyData } = state();
    state().init(storyData!);
    expectCounts('constructor', 0);
    const payload = loadSession(storyData!.ifid);
    expect(payload).toBeDefined();
    state().loadFromPayload(payload!);
    expectVisitedAll();
  });

  it('read only own numeric entries of a loaded payload', () => {
    const payload = state().getSavePayload();
    const visitCounts = Object.create({ Room: 5, toString: 6 }) as Record<
      string,
      unknown
    >;
    Object.defineProperty(visitCounts, '__proto__', {
      value: 3,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    visitCounts['constructor'] = 'x';
    visitCounts['valueOf'] = null;
    payload.visitCounts = visitCounts as Record<string, number>;
    payload.renderCounts = JSON.parse(
      '{"Start": 1, "hasOwnProperty": {}, "__proto__": 4}',
    ) as Record<string, number>;
    state().loadFromPayload(payload);
    expect(Story.visited('__proto__')).toBe(3);
    expect(Story.rendered('__proto__')).toBe(4);
    for (const name of ['Room', 'toString', 'constructor', 'valueOf']) {
      expect(Story.visited(name)).toBe(0);
    }
    expect(Story.rendered('hasOwnProperty')).toBe(0);
    expect(Story.rendered('Start')).toBe(1);
    state().navigate('constructor');
    expectCounts('constructor', 1);
  });

  it('read a payload without counters as no visits', () => {
    const payload = state().getSavePayload();
    delete payload.visitCounts;
    delete payload.renderCounts;
    state().loadFromPayload(payload);
    expectCounts('Start', 0);
    expectCounts('constructor', 0);
    state().navigate('constructor');
    expectCounts('constructor', 1);
  });
});
