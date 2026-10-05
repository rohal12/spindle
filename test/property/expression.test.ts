/**
 * Property tests for the expression engine (`src/expression.ts`).
 *
 * Programs come from a JavaScript grammar (`arbitraries/js.ts`) that knows
 * where every literal and sigil reference is, so the exact output of
 * `transform` is known, and running the same program with plain identifiers
 * in place of the references is an independent oracle for `evaluate` and
 * `execute`.
 */
import { afterAll, describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { evaluate, execute, transform } from '../../src/expression';
import { fcOptions } from './config';
import {
  IDENTS,
  NAMES,
  NAMESPACE,
  bindIdentsExpr,
  bindIdentsStmts,
  compiles,
  jsArbitraries,
  nativeName,
  render,
  type Doc,
  type Ref,
  type Sigil,
} from './arbitraries/js';

const plain = jsArbitraries({ refs: false });
const sigils = jsArbitraries({ refs: true });

/** Programs the oracle accepts: the native rendering is valid JavaScript. */
const validExpr = (doc: Doc) =>
  compiles('return (\n' + render(doc, 'native') + '\n);');
const validStmts = (doc: Doc) => compiles(render(doc, 'native'));

const exprs = (arbs: typeof plain) =>
  fc
    .oneof(
      { weight: 3, arbitrary: arbs.sequence.map(bindIdentsExpr) },
      { weight: 1, arbitrary: arbs.sequence },
    )
    .filter(validExpr);
const programs = (arbs: typeof plain) =>
  fc
    .oneof(
      { weight: 3, arbitrary: arbs.program.map(bindIdentsStmts) },
      { weight: 1, arbitrary: arbs.program },
    )
    .filter(validStmts);

describe('transform', () => {
  test.prop([exprs(plain)], fcOptions)(
    'leaves sigil-free expressions unchanged',
    (doc) => {
      const src = render(doc, 'sigil');
      expect(transform(src)).toBe(src);
    },
  );

  test.prop([programs(plain)], fcOptions)(
    'leaves sigil-free statements unchanged',
    (doc) => {
      const src = render(doc, 'sigil');
      expect(transform(src, 'statements')).toBe(src);
    },
  );

  test.prop([exprs(sigils)], fcOptions)(
    'rewrites exactly the references in code in expressions',
    (doc) => {
      expect(transform(render(doc, 'sigil'))).toBe(render(doc, 'transformed'));
    },
  );

  test.prop([programs(sigils)], fcOptions)(
    'rewrites exactly the references in code in statements',
    (doc) => {
      expect(transform(render(doc, 'sigil'), 'statements')).toBe(
        render(doc, 'transformed'),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Differential evaluation
// ---------------------------------------------------------------------------

type Namespaces = Record<(typeof NAMESPACE)[Sigil], Record<string, unknown>>;

const ALL_REFS: Ref[] = (['$', '_', '@', '%'] as const).flatMap((ref) =>
  (ref === '%' ? NAMES : [...NAMES, '1', '2b']).map((name) => ({ ref, name })),
);

const value = fc.oneof(
  fc.integer({ min: -5, max: 5 }),
  fc.constantFrom('', 'x', '$y', '_z', '1'),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 3 }),
  fc.record({ k: fc.integer({ min: -3, max: 3 }), x: fc.string() }),
);

const namespace = (sigil: Sigil) =>
  fc.record(
    Object.fromEntries(
      ALL_REFS.filter((r) => r.ref === sigil).map((r) => [r.name, value]),
    ),
  );

const namespaces: fc.Arbitrary<Namespaces> = fc.record({
  variables: namespace('$'),
  temporary: namespace('_'),
  locals: namespace('@'),
  transient: namespace('%'),
});

interface Outcome {
  value?: unknown;
  error?: string;
  namespaces: unknown;
}

/** A comparable copy: functions by kind, regexes by source, no cycles. */
function normalize(v: unknown, path: unknown[] = []): unknown {
  if (typeof v === 'function') return '[function]';
  if (typeof v === 'bigint' || typeof v === 'symbol') return String(v);
  if (v === null || typeof v !== 'object') return v;
  if (path.includes(v)) return '[cycle]';
  const inner = [...path, v];
  if (v instanceof RegExp) return { regex: String(v), lastIndex: v.lastIndex };
  if (v instanceof Number || v instanceof String || v instanceof Boolean)
    return { boxed: v.valueOf() };
  if (Array.isArray(v)) return Array.from(v, (x) => normalize(x, inner));
  // Read data properties only: a getter would run code after the fact.
  const props = Object.entries(Object.getOwnPropertyDescriptors(v));
  return Object.fromEntries(
    props
      .filter(([, d]) => d.enumerable)
      .map(([k, d]) => [
        k,
        'value' in d ? normalize(d.value, inner) : '[accessor]',
      ]),
  );
}

const errorName = (e: unknown) =>
  e instanceof Error ? e.constructor.name : typeof e;

/**
 * Programs without the `bindIdents…` wrapper assign the plain identifiers as
 * globals (functions are sloppy mode): start each run without them.
 */
function clearIdentGlobals() {
  const g = globalThis as Record<string, unknown>;
  for (const id of IDENTS) delete g[id];
}

/**
 * Run `run` against the namespaces and record what happened.
 *
 * Function source text differs between the renderings (`transient["a"]`
 * against `R$a`) and can leak into values (`String(fn)`, a function as a
 * computed key), so functions all read as the same text meanwhile.
 */
function outcome(ns: Namespaces, run: (ns: Namespaces) => unknown): Outcome {
  clearIdentGlobals();
  const { toString } = Function.prototype;
  Function.prototype.toString = () => 'function () {}';
  try {
    const result = run(ns);
    return { value: normalize(result), namespaces: normalize(ns) };
  } catch (e) {
    return { error: errorName(e), namespaces: normalize(ns) };
  } finally {
    Function.prototype.toString = toString;
  }
}

/**
 * Run the native rendering with each reference bound to a `let` variable
 * holding the namespace value, and write the variables back afterwards.
 */
function runNative(src: string, kind: 'expr' | 'stmts', ns: Namespaces) {
  const slot = (r: Ref) =>
    `__ns.${NAMESPACE[r.ref]}[${JSON.stringify(r.name)}]`;
  const decls = ALL_REFS.map((r) => `let ${nativeName(r)} = ${slot(r)};`);
  const writeBack = ALL_REFS.map((r) => `${slot(r)} = ${nativeName(r)};`);
  const inner = kind === 'expr' ? `return (\n${src}\n);` : src;
  const body =
    decls.join('\n') +
    `\ntry { return (function () {\n${inner}\n})(); } finally {\n` +
    writeBack.join('\n') +
    '\n}';
  return new Function('__ns', body)(ns);
}

afterAll(clearIdentGlobals);

describe('evaluate', () => {
  test.prop([exprs(sigils), namespaces], fcOptions)(
    'agrees with the same expression on plain variables',
    (doc, ns) => {
      const actual = outcome(structuredClone(ns), (n) =>
        evaluate(
          render(doc, 'sigil'),
          n.variables,
          n.temporary,
          n.locals,
          n.transient,
        ),
      );
      const expected = outcome(structuredClone(ns), (n) =>
        runNative(render(doc, 'native'), 'expr', n),
      );
      expect(actual).toEqual(expected);
    },
  );
});

describe('execute', () => {
  test.prop([programs(sigils), namespaces], fcOptions)(
    'mutates the namespaces as the same statements on plain variables',
    (doc, ns) => {
      const actual = outcome(structuredClone(ns), (n) =>
        execute(
          render(doc, 'sigil'),
          n.variables,
          n.temporary,
          n.locals,
          n.transient,
        ),
      );
      const expected = outcome(structuredClone(ns), (n) => {
        runNative(render(doc, 'native'), 'stmts', n);
      });
      expect(actual).toEqual(expected);
    },
  );
});
