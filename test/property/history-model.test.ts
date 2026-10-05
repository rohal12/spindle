// @vitest-environment happy-dom
/**
 * Model-based test of story history: navigation, back/forward, the history
 * limit, restart (re-running StoryInit), session restore and in-memory
 * save/load, against a model that is a plain list of moments and an index.
 *
 * Each moment records the variables as they were on entering its passage
 * (navigate() snapshots the live variables at the time of the navigation).
 * Back/forward and loads restore that entry snapshot; edits made on a passage
 * after entering it are discarded (docs/saves.md, "What a Load Restores").
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { executeStoryInit } from '../../src/story-init';
import { executeMutation } from '../../src/execute-mutation';
import { resetEmitter } from '../../src/event-emitter';
import { resetTriggers } from '../../src/triggers';
import { clearRegistry, serialize } from '../../src/class-registry';
import { loadSession, deserializePayload } from '../../src/saves/save-manager';
import type { SavePayload } from '../../src/saves/types';
import { fcOptions } from './config';
import {
  PASSAGES,
  Pet,
  installPet,
  initVariables,
  makeStoryData,
  cloneVars,
  modelRuns,
  MODEL_TIMEOUT,
  type PassageName,
} from './story-fixtures';

type Vars = Record<string, unknown>;

interface Moment {
  passage: PassageName;
  vars: Vars;
  /**
   * The random numbers drawn on the moment since entering it (as far as
   * known): returning to it replays them from its entry PRNG state.
   */
  rolls: number[];
}

interface HistoryModel {
  moments: Moment[];
  index: number;
  /** Live variables (may hold edits made since entering the moment). */
  live: Vars;
  visitCounts: Record<string, number>;
  maxHistory: number;
  /** Variables right after StoryInit, for restart. */
  start: Vars;
  /** Draws made on the current moment since entering (or returning to) it. */
  cursor: number;
}

interface Real {
  ifid: string;
  defaults: Vars;
}

const store = () => useStoryStore.getState();
let Story: StoryAPI;

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

function assertMatches(m: HistoryModel): void {
  const s = store();
  const current = m.moments[m.index]!;
  expect(s.currentPassage).toBe(current.passage);
  expect(s.history.map((h) => h.passage)).toEqual(
    m.moments.map((x) => x.passage),
  );
  expect(s.historyIndex).toBe(m.index);
  expect(s.maxHistory).toBe(m.maxHistory);
  expect(s.variables).toStrictEqual(m.live);
  expect(s.visitCounts).toEqual(m.visitCounts);

  // Back/forward availability
  expect(s.historyIndex > 0).toBe(m.index > 0);
  expect(s.historyIndex < s.history.length - 1).toBe(
    m.index < m.moments.length - 1,
  );

  // Every moment restores exactly the variables recorded for it, however
  // the variables changed since (no aliasing between moments and live state)
  for (let i = 0; i < m.moments.length; i++) {
    const vars = s.getHistoryVariables(i);
    expect(vars).toStrictEqual(m.moments[i]!.vars);
    // The returned snapshot is a copy: changing it changes no moment
    if (vars.pet instanceof Pet) vars.pet.feed(1000);
    (vars.nested as { a: { b: number[] } } | undefined)?.a?.b?.push(1000);
    expect(s.getHistoryVariables(i)).toStrictEqual(m.moments[i]!.vars);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Cmd = fc.Command<HistoryModel, Real>;

/** Record entering `passage` from the live state, trimming to the limit. */
function modelNavigate(m: HistoryModel, passage: PassageName): void {
  m.moments = m.moments.slice(0, m.index + 1);
  m.moments.push({ passage, vars: cloneVars(m.live), rolls: [] });
  if (m.moments.length > m.maxHistory) {
    m.moments = m.moments.slice(m.moments.length - m.maxHistory);
  }
  m.index = m.moments.length - 1;
  m.cursor = 0;
  m.visitCounts[passage] = (m.visitCounts[passage] ?? 0) + 1;
}

/** Back at the start of a fresh game. */
function modelFresh(m: HistoryModel): void {
  m.moments = [{ passage: 'Start', vars: cloneVars(m.start), rolls: [] }];
  m.index = 0;
  m.cursor = 0;
  m.live = cloneVars(m.start);
  m.visitCounts = { Start: 1 };
}

/** Restored the current moment's entry state (variables and PRNG). */
function modelReenter(m: HistoryModel): void {
  m.live = cloneVars(m.moments[m.index]!.vars);
  m.cursor = 0;
}

class SetVar implements Cmd {
  constructor(
    readonly name: string,
    readonly value: unknown,
  ) {}
  check = () => true;
  run(m: HistoryModel): void {
    Story.set(this.name, cloneVars(this.value));
    m.live[this.name] = cloneVars(this.value);
    assertMatches(m);
  }
  toString = () => `Set(${this.name}=${JSON.stringify(this.value)})`;
}

/** Mutation code, as a {do} or a {button} would run it. */
class Mutate implements Cmd {
  constructor(
    readonly kind: 'feed' | 'push' | 'deep' | 'path',
    readonly n: number,
  ) {}
  check = () => true;
  run(m: HistoryModel): void {
    const code = {
      feed: `$pet.feed(${this.n})`,
      push: `$nested.a.b.push(${this.n})`,
      deep: `$nested.a.c = {v: ${this.n}}`,
      path: `Story.set("pet.hunger", ${this.n})`,
    }[this.kind];
    executeMutation(code, {}, () => {});
    const pet = m.live.pet as Pet;
    const nested = m.live.nested as { a: { b: number[]; c?: unknown } };
    if (this.kind === 'feed') pet.feed(this.n);
    else if (this.kind === 'push') nested.a.b.push(this.n);
    else if (this.kind === 'deep') nested.a.c = { v: this.n };
    else pet.hunger = this.n;
    assertMatches(m);
  }
  toString = () => `Mutate(${this.kind}, ${this.n})`;
}

/**
 * Change the history limit. History is trimmed to it on the next
 * navigation (several moments at once when it was lowered).
 */
class SetMaxHistory implements Cmd {
  constructor(readonly limit: number) {}
  check = () => true;
  run(m: HistoryModel): void {
    Story.config.maxHistory = this.limit;
    m.maxHistory = Math.max(1, Math.round(this.limit));
    assertMatches(m);
  }
  toString = () => `SetMaxHistory(${this.limit})`;
}

class Goto implements Cmd {
  constructor(readonly passage: PassageName) {}
  check = () => true;
  run(m: HistoryModel): void {
    Story.goto(this.passage);
    modelNavigate(m, this.passage);
    assertMatches(m);
  }
  toString = () => `Goto(${this.passage})`;
}

class Back implements Cmd {
  check = () => true;
  run(m: HistoryModel): void {
    Story.back();
    if (m.index > 0) {
      m.index--;
      modelReenter(m);
    }
    assertMatches(m);
  }
  toString = () => 'Back';
}

class Forward implements Cmd {
  check = () => true;
  run(m: HistoryModel): void {
    Story.forward();
    if (m.index < m.moments.length - 1) {
      m.index++;
      modelReenter(m);
    }
    assertMatches(m);
  }
  toString = () => 'Forward';
}

/** A random draw: replays the moment's earlier draws after returning to it. */
class Roll implements Cmd {
  check = () => true;
  run(m: HistoryModel): void {
    const value = Story.random();
    const rolls = m.moments[m.index]!.rolls;
    if (m.cursor < rolls.length) expect(value).toBe(rolls[m.cursor]);
    else rolls.push(value);
    m.cursor++;
    assertMatches(m);
  }
  toString = () => 'Roll';
}

/**
 * Navigation from running story code ({do}, a {button}): the code's writes
 * so far are committed first, the navigation records them, and the code
 * goes on from the state the navigation leaves.
 */
class ScriptNavigate implements Cmd {
  constructor(
    readonly kind: 'goto' | 'back' | 'forward' | 'restart',
    readonly v: number,
  ) {}
  check = () => true;
  run(m: HistoryModel): void {
    const call = {
      goto: 'Story.goto("A")',
      back: 'Story.back()',
      forward: 'Story.forward()',
      restart: 'Story.restart()',
    }[this.kind];
    executeMutation(`$x = ${this.v}; ${call}; $y = ${this.v}`, {}, () => {});
    m.live.x = this.v;
    if (this.kind === 'goto') modelNavigate(m, 'A');
    else if (this.kind === 'back' && m.index > 0) {
      m.index--;
      modelReenter(m);
    } else if (this.kind === 'forward' && m.index < m.moments.length - 1) {
      m.index++;
      modelReenter(m);
    } else if (this.kind === 'restart') modelFresh(m);
    m.live.y = this.v;
    assertMatches(m);
  }
  toString = () => `ScriptNavigate(${this.kind}, ${this.v})`;
}

class Restart implements Cmd {
  check = () => true;
  run(m: HistoryModel): void {
    Story.restart();
    modelFresh(m);
    assertMatches(m);
  }
  toString = () => 'Restart';
}

/** Page refresh: boot the story again and restore the session. */
class Refresh implements Cmd {
  check = () => true;
  run(m: HistoryModel, r: Real): void {
    const session = loadSession(r.ifid);
    boot(r);
    if (session) {
      store().loadFromPayload(session);
      // A load restores the current moment's entry snapshot
      modelReenter(m);
    } else {
      // Nothing navigated since (re)start: the session was cleared
      modelFresh(m);
    }
    assertMatches(m);
  }
  toString = () => 'Refresh';
}

/** In-memory save and load, through the stored (serialized) format. */
class SaveLoad implements Cmd {
  constructor(readonly between: Cmd[]) {}
  check = () => true;
  run(m: HistoryModel, r: Real): void {
    const live = store().getSavePayload();
    // As stored: serialized variables, through JSON
    const stored = JSON.parse(
      JSON.stringify({
        ...live,
        variables: serialize(live.variables),
        history: live.history.map((h) => ({
          ...h,
          variables: serialize(h.variables),
        })),
      }),
    ) as SavePayload;
    const saved = cloneVars({ ...m, start: undefined });
    for (const cmd of this.between) cmd.run(m, r);
    store().loadFromPayload(deserializePayload(stored));
    m.moments = saved.moments;
    m.index = saved.index;
    m.visitCounts = saved.visitCounts;
    modelReenter(m);
    assertMatches(m);
  }
  toString = () => `SaveLoad[${this.between.join(', ')}]`;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const valueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.string({ maxLength: 3 }),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.integer(), { maxLength: 3 }),
  fc.record({ k: fc.integer(), deep: fc.record({ v: fc.string() }) }),
);

const simpleCommands: fc.Arbitrary<Cmd>[] = [
  fc
    .tuple(fc.constantFrom('x', 'y', 'z'), valueArb)
    .map(([n, v]) => new SetVar(n, v)),
  fc
    .tuple(
      fc.constantFrom('feed', 'push', 'deep', 'path') as fc.Arbitrary<
        'feed' | 'push' | 'deep' | 'path'
      >,
      fc.integer({ min: -5, max: 5 }),
    )
    .map(([k, n]) => new Mutate(k, n)),
  fc.constantFrom(...PASSAGES).map((p) => new Goto(p)),
  fc.constant(new Back()),
  fc.constant(new Forward()),
  fc.constant(new Roll()),
  fc.double({ min: -1, max: 7, noNaN: true }).map((n) => new SetMaxHistory(n)),
];

const allCommands = fc.commands(
  [
    ...simpleCommands,
    fc.constant(new Restart()),
    fc.constant(new Refresh()),
    fc
      .tuple(
        fc.constantFrom('goto', 'back', 'forward', 'restart') as fc.Arbitrary<
          'goto' | 'back' | 'forward' | 'restart'
        >,
        fc.integer({ min: 0, max: 9 }),
      )
      .map(([k, v]) => new ScriptNavigate(k, v)),
    fc
      .array(fc.oneof(...simpleCommands, fc.constant(new Restart())), {
        maxLength: 4,
      })
      .map((between) => new SaveLoad(between)),
  ],
  { maxCommands: 40, size: '+1' },
);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ifidCounter = 0;

function boot(r: Real): void {
  resetEmitter();
  resetTriggers();
  _resetRuntimePhase();
  store().init(makeStoryData(r.ifid), r.defaults);
  executeStoryInit();
}

describe('history model', () => {
  beforeAll(() => {
    installPet();
    installStoryAPI();
    Story = window.Story;
  });

  afterAll(() => {
    clearRegistry();
    delete (globalThis as Record<string, unknown>).Pet;
    useStoryStore.setState({ maxHistory: 40 });
  });

  it(
    'matches a list-of-moments model',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 6 }),
          fc.record({ x: fc.integer({ min: 0, max: 9 }), y: valueArb }),
          allCommands,
          (maxHistory, defaults, cmds) => {
            sessionStorage.clear();
            useStoryStore.setState({ maxHistory });
            const real: Real = { ifid: `history-${++ifidCounter}`, defaults };
            boot(real);
            const start = initVariables(defaults);
            const model: HistoryModel = {
              moments: [],
              index: 0,
              live: {},
              visitCounts: {},
              maxHistory,
              start,
              cursor: 0,
            };
            modelFresh(model);
            assertMatches(model);
            fc.modelRun(() => ({ model, real }), cmds);
          },
        ),
        // Up to 40 commands per case, each checking every moment (see modelRuns)
        { ...fcOptions, numRuns: modelRuns(300) },
      );
    },
    MODEL_TIMEOUT,
  );
});
