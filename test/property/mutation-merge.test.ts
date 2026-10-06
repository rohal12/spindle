// @vitest-environment happy-dom
/**
 * Model test of the mutation merge (execute-mutation.ts): mutation code
 * runs on working copies of the store namespaces and commits the paths it
 * changed with a three-way merge, while writes made elsewhere during the
 * run (Story.set, nested mutations, any other store update) are made in
 * the code's state and mirrored into the copies, and
 * Story.get/goto/back/forward/save act in program order.
 *
 * All of that must be indistinguishable from the simple reference model
 * here: one plain state that every write is applied to in program order.
 */
import { afterAll, beforeAll, describe, expect, vi } from 'vitest';
import { decodeSavePayload } from '../../src/saves/save-manager';
import { test, fc } from '@fast-check/vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { executeMutation } from '../../src/execute-mutation';
import { clearRegistry } from '../../src/class-registry';
import { deepClone } from '../../src/structural';
import { getBackend, resetBackend } from '../../src/saves/storage';
import { deleteByPath, setByPath } from '../../src/utils/object-path';
import { createNamespace } from '../../src/utils/namespace';
import { resetEmitter } from '../../src/event-emitter';
import {
  addTrigger,
  connectTriggersToStore,
  resetTriggers,
} from '../../src/triggers';
import type { Passage, StoryData } from '../../src/parser';
import { fcOptions } from './config';
import { Counter, propTimeout, registerTestClasses, structEq } from './values';

vi.setConfig({ testTimeout: propTimeout(10) });

type Rec = Record<string, unknown>;
const g = globalThis as Rec;

// --- Values written by the program ---

/** A value as a tree, so it can be both built and written as code. */
type Spec =
  | { k: 'prim'; v: number | string | boolean | null }
  | { k: 'obj'; entries: [string, Spec][] }
  | { k: 'arr'; items: Spec[] }
  | { k: 'counter'; n: number }
  | { k: 'map'; entries: [string, number][] };

/**
 * Property keys. `valueOf` is an Object.prototype member: an object holds
 * it only as an own property, like any other key.
 */
const KEYS = ['a', 'b', 'c', 'valueOf'];

/**
 * Names of new variables. Those of Object.prototype members are variables
 * like any other (the namespaces have no prototype).
 */
const NEW_ROOTS = ['q', 'r', 'constructor', 'toString', 'hasOwnProperty'];

const specArb: fc.Arbitrary<Spec> = fc.letrec<{ spec: Spec }>((tie) => ({
  spec: fc.oneof(
    { depthSize: 'small', maxDepth: 2 },
    fc
      .oneof(
        fc.integer({ min: -5, max: 5 }),
        fc.constantFrom('x', 'y'),
        fc.boolean(),
        fc.constant(null),
      )
      .map((v): Spec => ({ k: 'prim', v })),
    fc
      .array(fc.tuple(fc.constantFrom(...KEYS), tie('spec')), { maxLength: 3 })
      .map((entries): Spec => ({ k: 'obj', entries })),
    fc
      .array(tie('spec'), { maxLength: 2 })
      .map((items): Spec => ({ k: 'arr', items })),
    fc.integer({ min: 0, max: 3 }).map((n): Spec => ({ k: 'counter', n })),
    fc
      .array(fc.tuple(fc.constantFrom(...KEYS), fc.nat(3)), { maxLength: 2 })
      .map((entries): Spec => ({ k: 'map', entries })),
  ),
})).spec;

function build(spec: Spec): unknown {
  switch (spec.k) {
    case 'prim':
      return spec.v;
    case 'obj': {
      const o: Rec = {};
      for (const [key, s] of spec.entries) o[key] = build(s);
      return o;
    }
    case 'arr':
      return spec.items.map(build);
    case 'counter':
      return new Counter(spec.n);
    case 'map':
      return new Map(spec.entries);
  }
}

function code(spec: Spec): string {
  switch (spec.k) {
    case 'prim':
      return JSON.stringify(spec.v);
    case 'obj':
      return `{${spec.entries.map(([key, s]) => `${JSON.stringify(key)}: ${code(s)}`).join(', ')}}`;
    case 'arr':
      return `[${spec.items.map(code).join(', ')}]`;
    case 'counter':
      return `new Counter(${spec.n})`;
    case 'map':
      return `new Map(${JSON.stringify(spec.entries)})`;
  }
}

// --- Programs ---

/**
 * Abstract operations. Numbers are choices resolved against the model
 * state at the point the operation runs (see plan()).
 */
type Op =
  | { k: 'set'; ns: number; walk: number[]; last: number; v: Spec }
  | { k: 'del'; ns: number; walk: number[]; last: number }
  | { k: 'push'; pick: number; v: Spec }
  | { k: 'mapSet'; pick: number; key: string; n: number }
  | { k: 'bump'; pick: number }
  | {
      k: 'storySet';
      entries: { ns: number; walk: number[]; last: number; v: Spec }[];
    }
  | { k: 'get'; ns: number; walk: number[]; last: number }
  | {
      k: 'direct';
      ns: number;
      walk: number[];
      last: number;
      /** A value to write, or a delete. */
      v: Spec | null;
      /** Which store write path makes it (see plan()). */
      via: number;
    }
  | { k: 'nested'; ops: Op[] }
  | { k: 'watch'; ops: Op[] }
  | { k: 'goto' }
  | { k: 'back' }
  | { k: 'forward' }
  | { k: 'restart' }
  | { k: 'save' }
  | { k: 'gate'; pick: number; open: boolean };

/** Small choices, so that operations meet on the same objects often. */
const choice = fc.nat({ max: 11 });
const walkArb = fc.array(choice, { maxLength: 3 });

function opsArb(withSaves: boolean): fc.Arbitrary<Op[]> {
  return fc.letrec<{ ops: Op[]; op: Op }>((tie) => {
    const pathOp = { ns: choice, walk: walkArb, last: choice };
    const weighted: [number, fc.Arbitrary<Op>][] = [
      [6, fc.record({ k: fc.constant('set' as const), ...pathOp, v: specArb })],
      [2, fc.record({ k: fc.constant('del' as const), ...pathOp })],
      [
        2,
        fc.record({
          k: fc.constant('push' as const),
          pick: choice,
          v: specArb,
        }),
      ],
      [
        1,
        fc.record({
          k: fc.constant('mapSet' as const),
          pick: choice,
          key: fc.constantFrom(...KEYS),
          n: fc.nat(3),
        }),
      ],
      [2, fc.record({ k: fc.constant('bump' as const), pick: choice })],
      [
        6,
        fc.record({
          k: fc.constant('storySet' as const),
          entries: fc.array(fc.record({ ...pathOp, v: specArb }), {
            minLength: 1,
            maxLength: 2,
          }),
        }),
      ],
      [3, fc.record({ k: fc.constant('get' as const), ...pathOp })],
      [
        4,
        fc.record({
          k: fc.constant('direct' as const),
          ...pathOp,
          v: fc.option(specArb, { freq: 4, nil: null }),
          via: fc.nat(3),
        }),
      ],
      [
        3,
        fc.record({
          k: fc.constant('gate' as const),
          pick: choice,
          open: fc.boolean(),
        }),
      ],
      [3, fc.constant({ k: 'goto' as const })],
      [2, fc.constant({ k: 'back' as const })],
      [1, fc.constant({ k: 'forward' as const })],
      [1, fc.constant({ k: 'restart' as const })],
      ...(withSaves
        ? [
            [2, fc.constant({ k: 'save' as const })] as [
              number,
              fc.Arbitrary<Op>,
            ],
          ]
        : []),
      [2, tie('ops').map((ops): Op => ({ k: 'nested', ops: ops as Op[] }))],
      [4, tie('ops').map((ops): Op => ({ k: 'watch', ops: ops as Op[] }))],
    ];
    return {
      op: fc.oneof(
        { depthSize: 'small', maxDepth: 3 },
        ...weighted.map(([weight, arbitrary]) => ({ weight, arbitrary })),
      ),
      ops: fc.array(tie('op') as fc.Arbitrary<Op>, {
        minLength: 1,
        maxLength: 10,
      }),
    };
  }).ops;
}

// --- Reference model ---

interface Model {
  variables: Rec;
  temporary: Rec;
  transient: Rec;
  history: Rec[];
  index: number;
}

type NsName = 'variables' | 'temporary' | 'transient';
const PREFIX: Record<NsName, string> = {
  variables: '$',
  temporary: '_',
  transient: '%',
};

/** Watcher flags and gates: only the harness writes them (see 'watch'). */
const isProtectedRoot = (name: string) => /^[fg]\d+$/.test(name);

/** Watchers share these gates, which the code writes (see 'gate'). */
const GATES = 3;

const isWalkable = (v: unknown): v is Rec =>
  typeof v === 'object' &&
  v !== null &&
  !(
    v instanceof Map ||
    v instanceof Set ||
    v instanceof Date ||
    v instanceof RegExp
  );

const own = (o: object, key: string) =>
  Object.prototype.hasOwnProperty.call(o, key);

/**
 * Resolve choices into a path in `ns`: a root (existing or new), then down
 * through own objects, class instances and arrays, ending on an existing
 * or new key (an index for arrays).
 */
function resolvePath(ns: Rec, walk: number[], last: number): string[] {
  const roots = Object.keys(ns).filter((r) => !isProtectedRoot(r));
  const walkableRoots = roots.filter((r) => isWalkable(ns[r]));
  const path: string[] = [];
  let node: Rec | undefined;
  for (const choice of walk) {
    const children = node
      ? Object.keys(node).filter((k) => isWalkable(node![k]))
      : walkableRoots;
    if (children.length === 0 || choice % (children.length + 1) === 0) break;
    const key = children[(choice % (children.length + 1)) - 1]!;
    path.push(key);
    node = (node ?? ns)[key] as Rec;
  }
  let options: string[];
  if (!node) options = [...new Set([...roots, ...NEW_ROOTS])];
  else if (Array.isArray(node))
    options = Object.keys(node).concat(String(node.length));
  else options = [...new Set([...Object.keys(node), ...KEYS])];
  path.push(options[last % options.length]!);
  return path;
}

/** All objects of a kind reachable through walkable objects, with paths. */
function findAll(ns: Rec, test: (v: unknown) => boolean): string[][] {
  const out: string[][] = [];
  const visit = (v: unknown, path: string[]) => {
    if (path.length > 0 && test(v)) out.push(path);
    if (!isWalkable(v)) return;
    for (const key of Object.keys(v)) {
      if (path.length === 0 && isProtectedRoot(key)) continue;
      visit(v[key], [...path, key]);
    }
  };
  visit(ns, []);
  return out;
}

const getAt = (ns: Rec, path: string[]): unknown =>
  path.reduce<unknown>(
    (v, k) => (isWalkable(v) || v instanceof Map ? (v as Rec)[k] : undefined),
    ns,
  );

function setAt(ns: Rec, path: string[], value: unknown): void {
  (getAt(ns, path.slice(0, -1)) as Rec)[path[path.length - 1]!] = value;
}

const codeRef = (ns: NsName, path: string[]) =>
  `${PREFIX[ns]}${path[0]}${path
    .slice(1)
    .map((k) => `[${JSON.stringify(k)}]`)
    .join('')}`;

const nsOf = (n: number, withTemps: boolean): NsName =>
  withTemps
    ? (['variables', 'variables', 'transient', 'temporary'] as const)[n % 4]!
    : (['variables', 'variables', 'transient'] as const)[n % 3]!;

// --- Planning: run the model and write the program ---

/**
 * A watcher: `$<flag> == 1 && $<gate> !== 1`, once, running `ops` as its
 * run action. The flag is set by Story.set, the gate by plain assignments
 * in the code, which the store takes only when the code commits: the
 * watcher must act on the program-order state all the same.
 */
interface Watcher {
  flag: string;
  gate: string;
  ops: Op[];
  /** Its condition's value at the last check (see triggers.ts). */
  last: boolean;
  fired: boolean;
  /** Removed by a restart before it fired. */
  removed: boolean;
  /** The planned run action. */
  code: string;
}

interface Plan {
  /** Callbacks the program's ext(i) calls run. */
  ext: (() => void)[];
  /** Story.get results: expected (from the model) and actual. */
  gets: { expected: unknown; actual?: unknown }[];
  /** Saves: slot and expected variables. */
  saves: { slot: string; expected: Rec; promise?: Promise<void> }[];
  /** Watchers, in registration order. */
  watchers: Watcher[];
}

/**
 * The watcher engine, as the model sees it. Watcher checks do not nest: a
 * Story.set made by a run action while a check runs is picked up by that
 * check (later in its pass), after the action. Navigation checks watchers
 * itself, before it records the entered moment, and defers navigations its
 * watchers request until it has recorded it.
 */
interface Engine {
  checking: boolean;
  navigating: boolean;
  deferredGotos: number;
  /** The entered moment is still being recorded (see navigate). */
  entered: boolean;
  /** A restart removed every watcher (including ones set later). */
  restarted: boolean;
}

/** A watcher's condition in the model state. */
const holds = (model: Model, w: Watcher) =>
  model.variables[w.flag] === 1 && model.variables[w.gate] !== 1;

/** Plan a watcher check pass (triggers.ts runCheckLoop). */
function checkWatchers(model: Model, engine: Engine, p: Plan): void {
  for (let depth = 0; depth < 10; depth++) {
    let fired = false;
    for (let i = 0; i < p.watchers.length; i++) {
      const w = p.watchers[i]!;
      if (w.fired || w.removed) continue;
      const result = holds(model, w);
      const wasFalse = !w.last;
      w.last = result;
      if (result && wasFalse) {
        fired = true;
        w.fired = true;
        // The run action is mutation code started now
        w.code = plan(model, engine, w.ops, p);
      }
    }
    if (!fired) break;
  }
}

/** Plan Story.goto("Room") (store.ts navigate). */
function navigate(model: Model, engine: Engine, p: Plan): void {
  if (engine.navigating) {
    engine.deferredGotos++;
    return;
  }
  model.history = model.history.slice(0, model.index + 1);
  model.temporary = createNamespace();
  model.history.push(deepClone(model.variables));
  model.index = model.history.length - 1;

  // Watchers react to the entered moment and are part of it, up to when
  // one of them moves elsewhere in history
  const wasChecking = engine.checking;
  engine.checking = true;
  engine.navigating = true;
  engine.entered = true;
  checkWatchers(model, engine, p);
  engine.navigating = false;
  engine.checking = wasChecking;
  finishEntered(model, engine);

  const deferredGotos = engine.deferredGotos;
  engine.deferredGotos = 0;
  for (let i = 0; i < deferredGotos; i++) navigate(model, engine, p);
}

/** Record the entered moment as it is when its watchers are done or leave it. */
function finishEntered(model: Model, engine: Engine): void {
  if (!engine.entered) return;
  engine.entered = false;
  model.history[model.index] = deepClone(model.variables);
}

/** Plan Story.back()/Story.forward(). */
function traverse(model: Model, engine: Engine, p: Plan, step: number): void {
  const to = model.index + step;
  if (to < 0 || to >= model.history.length) return;
  finishEntered(model, engine);
  model.index = to;
  model.variables = deepClone(model.history[to]!);
  model.temporary = createNamespace();
  // Restored state is not a change watchers react to
  for (const w of p.watchers) {
    if (!w.fired) w.last = holds(model, w);
  }
}

/**
 * Plan `ops` as mutation code: apply each operation to the model in program
 * order and return the code that makes the same writes.
 */
function plan(model: Model, engine: Engine, ops: Op[], p: Plan): string {
  const lines: string[] = [];
  /**
   * The store takes the code's pending writes (as at every store update
   * the code sets off, and when it finishes) and watchers react to the
   * state, unless a check is in progress.
   */
  const sync = () => {
    if (engine.checking) return;
    engine.checking = true;
    checkWatchers(model, engine, p);
    engine.checking = false;
  };
  const extCall = (fn: () => void) => {
    p.ext.push(fn);
    lines.push(`ext(${p.ext.length - 1});`);
  };

  for (const op of ops) {
    switch (op.k) {
      case 'set': {
        const ns = nsOf(op.ns, true);
        const path = resolvePath(model[ns], op.walk, op.last);
        setAt(model[ns], path, build(op.v));
        lines.push(`${codeRef(ns, path)} = ${code(op.v)};`);
        break;
      }
      case 'del': {
        const ns = nsOf(op.ns, true);
        const path = resolvePath(model[ns], op.walk, op.last);
        delete (getAt(model[ns], path.slice(0, -1)) as Rec)[
          path[path.length - 1]!
        ];
        lines.push(`delete ${codeRef(ns, path)};`);
        break;
      }
      case 'push':
      case 'mapSet':
      case 'bump': {
        const test =
          op.k === 'push'
            ? Array.isArray
            : op.k === 'mapSet'
              ? (v: unknown) => v instanceof Map
              : (v: unknown) => v instanceof Counter;
        const found = (
          ['variables', 'temporary', 'transient'] as const
        ).flatMap((ns) =>
          findAll(model[ns], test).map((path) => [ns, path] as const),
        );
        if (found.length === 0) break;
        const [ns, path] = found[op.pick % found.length]!;
        const target = getAt(model[ns], path);
        if (op.k === 'push') {
          (target as unknown[]).push(build(op.v));
          lines.push(`${codeRef(ns, path)}.push(${code(op.v)});`);
        } else if (op.k === 'mapSet') {
          (target as Map<string, number>).set(op.key, op.n);
          lines.push(
            `${codeRef(ns, path)}.set(${JSON.stringify(op.key)}, ${op.n});`,
          );
        } else {
          (target as Counter).bump();
          lines.push(`${codeRef(ns, path)}.bump();`);
        }
        break;
      }
      case 'storySet': {
        sync();
        const entries: [string, Spec][] = [];
        for (const e of op.entries) {
          const ns = nsOf(e.ns, false);
          const path = resolvePath(model[ns], e.walk, e.last);
          setAt(model[ns], path, build(e.v));
          entries.push([(ns === 'transient' ? '%' : '') + path.join('.'), e.v]);
        }
        extCall(() => {
          const story = window.Story;
          if (entries.length === 1) {
            story.set(entries[0]![0], build(entries[0]![1]));
          } else {
            story.set(
              Object.fromEntries(entries.map(([n, s]) => [n, build(s)])),
            );
          }
        });
        if (!engine.checking) {
          engine.checking = true;
          checkWatchers(model, engine, p);
          engine.checking = false;
        }
        break;
      }
      case 'get': {
        const ns = nsOf(op.ns, false);
        const path = resolvePath(model[ns], op.walk, op.last);
        const holder = getAt(model[ns], path.slice(0, -1));
        const key = path[path.length - 1]!;
        const expected =
          isWalkable(holder) && own(holder, key)
            ? deepClone(holder[key])
            : undefined;
        const entry: Plan['gets'][number] = { expected };
        p.gets.push(entry);
        const name = (ns === 'transient' ? '%' : '$') + path.join('.');
        extCall(() => {
          entry.actual = window.Story.get(name);
        });
        break;
      }
      case 'direct': {
        // A store update other than Story.set (an input binding, {computed},
        // {unset}, a store action): made in program order like any write
        sync();
        const ns = nsOf(op.ns, true);
        // Store actions name a variable: a root
        const path = resolvePath(
          model[ns],
          op.via === 3 ? [] : op.walk,
          op.last,
        );
        const { v, via } = op;
        if (v === null) {
          delete (getAt(model[ns], path.slice(0, -1)) as Rec)[
            path[path.length - 1]!
          ];
        } else {
          setAt(model[ns], path, build(v));
        }
        const write = (draft: Rec) => {
          if (v === null) deleteByPath(draft, path);
          else setByPath(draft, path, build(v), { createMissing: via === 2 });
        };
        extCall(() => {
          const store = useStoryStore.getState();
          if (via === 0) {
            store.updateVariables((d) => write(d[ns]));
          } else if (via === 1 || via === 2) {
            // As input bindings write (with createMissing)
            useStoryStore.setState((s) => write(s[ns]));
          } else {
            const name = path[0]!;
            const value = v === null ? undefined : build(v);
            if (ns === 'variables') {
              if (v === null) store.deleteVariable(name);
              else store.setVariable(name, value);
            } else if (ns === 'temporary') {
              if (v === null) store.deleteTemporary(name);
              else store.setTemporary(name, value);
            } else if (v === null) store.deleteTransient(name);
            else store.setTransient(name, value);
          }
        });
        if (!engine.checking) {
          engine.checking = true;
          checkWatchers(model, engine, p);
          engine.checking = false;
        }
        break;
      }
      case 'nested': {
        // Mutation code started while this one runs (a variableChanged
        // handler, a widget): it continues from this code's pending state
        const sub = plan(model, engine, op.ops, p);
        extCall(() => executeMutation(sub, {}, () => {}));
        break;
      }
      case 'watch': {
        // A watcher whose flag a Story.set here sets
        sync();
        const flag = `f${p.watchers.length}`;
        p.watchers.push({
          flag,
          gate: `g${p.watchers.length % GATES}`,
          ops: op.ops,
          last: false,
          fired: false,
          removed: engine.restarted,
          code: '',
        });
        model.variables[flag] = 1;
        extCall(() => window.Story.set(flag, 1));
        if (!engine.checking) {
          engine.checking = true;
          checkWatchers(model, engine, p);
          engine.checking = false;
        }
        break;
      }
      case 'gate': {
        // A plain assignment: the store takes it when the code commits
        const gate = `g${op.pick % GATES}`;
        model.variables[gate] = op.open ? 0 : 1;
        lines.push(`$${gate} = ${op.open ? 0 : 1};`);
        break;
      }
      case 'goto':
        sync();
        lines.push('Story.goto("Room");');
        navigate(model, engine, p);
        break;
      case 'back':
      case 'forward':
        sync();
        lines.push(`Story.${op.k}();`);
        traverse(model, engine, p, op.k === 'back' ? -1 : 1);
        break;
      case 'restart':
        // Back to the defaults, with a new history; watchers are removed
        sync();
        lines.push('Story.restart();');
        model.variables = createNamespace(variableDefaults());
        model.transient = createNamespace(transientDefaults());
        model.temporary = createNamespace();
        model.history = [deepClone(model.variables)];
        model.index = 0;
        engine.entered = false;
        engine.restarted = true;
        for (const w of p.watchers) if (!w.fired) w.removed = true;
        break;
      case 'save': {
        sync();
        const slot = `s${p.saves.length}`;
        // Saved as plain data
        const entry: Plan['saves'][number] = {
          slot,
          expected: { ...deepClone(model.variables) },
        };
        p.saves.push(entry);
        extCall(() => {
          entry.promise = window.Story.save(slot);
        });
        break;
      }
    }
  }
  // The code's commit when it finishes
  sync();
  return lines.join('\n');
}

// --- Harness ---

function makeStoryData(): StoryData {
  const passages: Passage[] = [
    { pid: 1, name: 'Start', tags: [], metadata: {}, content: '' },
    { pid: 2, name: 'Room', tags: [], metadata: {}, content: '' },
  ];
  return {
    name: 'Mutation merge',
    startNode: 1,
    ifid: 'prop-mutation-merge',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((x) => [x.name, x])),
    passagesById: new Map(passages.map((x) => [x.pid, x])),
    userCSS: '',
    userScript: '',
  };
}

const variableDefaults = (): Rec => ({
  o: { a: { b: 1 }, c: [1, { a: 2 }] },
  p: Object.assign(new Counter(1), { a: { b: 2 }, c: [3] }),
  arr: [1, 2],
  m: new Map([['a', 1]]),
  n: 0,
});

const transientDefaults = (): Rec => ({
  t: { a: 1, b: { c: 2 } },
  tp: new Counter(5),
});

let Story: StoryAPI;

beforeAll(() => {
  registerTestClasses();
  g.Counter = Counter;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  clearRegistry();
  delete g.Counter;
  delete g.ext;
  delete g.unexpected;
  vi.restoreAllMocks();
});

async function setUp(withSaves: boolean): Promise<void> {
  if (withSaves) {
    resetBackend();
    await getBackend();
  }
  resetEmitter();
  resetTriggers();
  _resetRuntimePhase();
  useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
  useStoryStore
    .getState()
    .init(makeStoryData(), variableDefaults(), transientDefaults());
  if (withSaves) {
    await vi.waitFor(() =>
      expect(useStoryStore.getState().playthroughId).not.toBe(''),
    );
  }
  installStoryAPI();
  Story = window.Story;
}

async function check(ops: Op[], withSaves: boolean): Promise<void> {
  await setUp(withSaves);
  // The store's namespaces have no prototype: neither have the model's
  const model: Model = {
    variables: createNamespace(variableDefaults()),
    temporary: createNamespace(),
    transient: createNamespace(transientDefaults()),
    history: [],
    index: 0,
  };
  model.history.push(deepClone(model.variables));
  const p: Plan = { ext: [], gets: [], saves: [], watchers: [] };
  const engine: Engine = {
    checking: false,
    navigating: false,
    deferredGotos: 0,
    entered: false,
    restarted: false,
  };
  const program = plan(model, engine, ops, p);

  // A watcher the model never fires must not run either
  const unexpected: string[] = [];
  g.unexpected = (flag: string) => unexpected.push(flag);
  for (const w of p.watchers) {
    const run = w.fired ? w.code : `unexpected(${JSON.stringify(w.flag)})`;
    addTrigger(`$${w.flag} == 1 && $${w.gate} !== 1`, { run, once: true });
  }
  const errors: unknown[] = [];
  const errorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation((...args) => void errors.push(args));
  const disconnect = connectTriggersToStore();
  g.ext = (i: number) => p.ext[i]!();
  try {
    executeMutation(program, {}, () => {});
  } finally {
    disconnect();
    errorSpy.mockRestore();
  }
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);

  const state = useStoryStore.getState();
  const context = `program:\n${program}\nwatchers:\n${p.watchers
    .map((w) => `${w.flag}: ${w.fired ? w.code : '(not fired)'}`)
    .join('\n')}`;
  const same = (actual: unknown, expected: unknown, what: string) =>
    expect(
      structEq(actual, expected),
      `${context}\n${what}:\n  actual   ${fc.stringify(actual)}\n  expected ${fc.stringify(expected)}`,
    ).toBe(true);
  same(state.variables, model.variables, 'variables');
  same(state.transient, model.transient, 'transient');
  same(state.temporary, model.temporary, 'temporary');
  same(state.historyIndex, model.index, 'history index');
  same(state.history.length, model.history.length, 'history length');
  model.history.forEach((vars, i) => {
    same(state.getHistoryVariables(i), vars, `moment ${i}`);
  });
  p.gets.forEach(({ expected, actual }, i) => {
    same(actual, expected, `get ${i}`);
  });
  for (const save of p.saves) {
    await save.promise;
    const exported = await Story.exportSave(save.slot);
    const saved = decodeSavePayload(exported!.save.payload).variables;
    same(saved, save.expected, `save ${save.slot}`);
  }
}

describe('mutation code merged into the store', () => {
  test.prop([opsArb(false)], fcOptions)(
    'ends in the state of applying every write in program order',
    (ops) => check(ops, false),
  );

  test.prop([opsArb(true)], {
    ...fcOptions,
    numRuns: Math.ceil(fcOptions.numRuns / 5),
  })('saves the state of every write before Story.save', (ops) =>
    check(ops, true),
  );
});
