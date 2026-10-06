import type { StoryState } from './store';
import { useStoryStore } from './store';
import type { Passage } from './parser';
import { random, randomInt } from './prng';
import { parseCode, type JsGoal, type Sigil } from './js-lexer';
import {
  EMPTY_NAMESPACE,
  asNamespace,
  countOf,
  isNamespace,
  variableNameError,
  type Counts,
  type Namespace,
} from './utils/namespace';

interface ExpressionFns {
  currentPassage: () => Passage | undefined;
  previousPassage: () => Passage | undefined;
  visited: (name?: string) => number;
  hasVisited: (name?: string) => boolean;
  hasVisitedAny: (...names: string[]) => boolean;
  hasVisitedAll: (...names: string[]) => boolean;
  rendered: (name?: string) => number;
  hasRendered: (name?: string) => boolean;
  hasRenderedAny: (...names: string[]) => boolean;
  hasRenderedAll: (...names: string[]) => boolean;
  random: () => number;
  randomInt: (min: number, max: number) => number;
}

type CompiledExpression = (
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  __fns: ExpressionFns,
  transient: Record<string, unknown>,
) => unknown;

const FN_CACHE_MAX = 500;
const fnCache = new Map<string, CompiledExpression>();

const NAMESPACES: Record<Sigil, string> = {
  $: 'variables',
  _: 'temporary',
  '@': 'locals',
  '%': 'transient',
};

/** Ends with an identifier character. */
const IDENT_END_RE = /[\p{ID_Continue}$\u200c\u200d]$/u;

/**
 * Transform expression: $var → variables["var"], _var → temporary["var"],
 * @var → locals["var"], %var → transient["var"].
 * The lexer (`lexJs`) finds the references: only in code (string, template
 * and regex literal text and comments are left untouched), only where an
 * identifier starts (not in `a$b`, nor as the property name in `obj._x`),
 * and `%var` only where an operand is expected, since `%` is also the
 * modulo operator. `goal` tells whether `expr` is an expression or a list of
 * statements, as that decides whether a leading `{` opens an object literal
 * or a block. A reference to a variable named `__proto__` throws a
 * SyntaxError: no namespace can hold one (see utils/namespace.ts).
 * Exported for tests.
 */
export function transform(expr: string, goal: JsGoal = 'expression'): string {
  const key = goal === 'statements' ? 's' + expr : 'e' + expr;
  const cached = transformCache.get(key);
  if (cached !== undefined) return cached;
  const { refs } = parseCode(expr, goal);
  let result = '';
  let at = 0;
  for (const ref of refs) {
    const error = variableNameError(ref.name, ref.sigil + ref.name);
    if (error) throw new SyntaxError(`spindle: ${error}`);
    result += expr.slice(at, ref.start);
    if (ref.shorthand) result += `${ref.name}: `;
    // `typeof%x` needs a space once `%x` turns into an identifier.
    else if (IDENT_END_RE.test(result.slice(-2))) result += ' ';
    result += `${NAMESPACES[ref.sigil]}["${ref.name}"]`;
    at = ref.end;
  }
  result += expr.slice(at);
  if (transformCache.size >= FN_CACHE_MAX) {
    transformCache.delete(transformCache.keys().next().value!);
  }
  transformCache.set(key, result);
  return result;
}

/** Transformed code by goal and source. */
const transformCache = new Map<string, string>();

const preamble =
  'const {currentPassage,previousPassage,visited,hasVisited,hasVisitedAny,hasVisitedAll,rendered,hasRendered,hasRenderedAny,hasRenderedAll,random,randomInt}=__fns;';

function getOrCompile(key: string, body: string): CompiledExpression {
  const cached = fnCache.get(key);
  if (cached) {
    // Move to end for LRU ordering (Map preserves insertion order)
    fnCache.delete(key);
    fnCache.set(key, cached);
    return cached;
  }
  const fn = new Function(
    'variables',
    'temporary',
    'locals',
    '__fns',
    'transient',
    preamble + body,
  ) as CompiledExpression;
  fnCache.set(key, fn);
  if (fnCache.size > FN_CACHE_MAX) {
    // Evict oldest entry
    const oldest = fnCache.keys().next().value;
    if (oldest !== undefined) fnCache.delete(oldest);
  }
  return fn;
}

/** The passage being shown. */
export function currentPassage(): Passage | undefined {
  const s = useStoryStore.getState();
  return s.storyData?.passages.get(s.currentPassage);
}

/** The passage shown before the current one in history. */
export function previousPassage(): Passage | undefined {
  const s = useStoryStore.getState();
  if (s.historyIndex <= 0) return undefined;
  const prevName = s.history[s.historyIndex - 1]?.passage;
  return prevName ? s.storyData?.passages.get(prevName) : undefined;
}

/**
 * visited()/rendered() and their has-forms, counting in the counters
 * `counts()` returns. A missing name means the current passage.
 */
function countQueries(counts: () => Counts) {
  const count = (name?: string): number =>
    countOf(counts(), name ?? useStoryStore.getState().currentPassage);
  return {
    count,
    has: (name?: string): boolean => count(name) > 0,
    any: (...names: string[]): boolean => names.some((n) => count(n) > 0),
    all: (...names: string[]): boolean => names.every((n) => count(n) > 0),
  };
}

/**
 * The history functions of passage code and the story API: the current and
 * previous passage, and visited()/rendered() with their has-forms, counting
 * in the counters `visitCounts()` and `renderCounts()` return.
 */
export function historyQueries(
  visitCounts: () => Counts,
  renderCounts: () => Counts,
) {
  const visits = countQueries(visitCounts);
  const renders = countQueries(renderCounts);
  return {
    currentPassage,
    previousPassage,
    visited: visits.count,
    hasVisited: visits.has,
    hasVisitedAny: visits.any,
    hasVisitedAll: visits.all,
    rendered: renders.count,
    hasRendered: renders.has,
    hasRenderedAny: renders.any,
    hasRenderedAll: renders.all,
  };
}

let cachedFns: ExpressionFns | null = null;
let cachedVisitCounts: Counts | null = null;
let cachedRenderCounts: Counts | null = null;

export function buildExpressionFns() {
  const state = useStoryStore.getState();
  const { visitCounts, renderCounts } = state;

  if (
    cachedFns &&
    cachedVisitCounts === visitCounts &&
    cachedRenderCounts === renderCounts
  ) {
    return cachedFns;
  }

  cachedFns = {
    ...historyQueries(
      () => visitCounts,
      () => renderCounts,
    ),
    random,
    randomInt,
  };
  cachedVisitCounts = visitCounts;
  cachedRenderCounts = renderCounts;

  return cachedFns;
}

/**
 * The namespaces compiled code reads and writes are records without a
 * prototype (story state keeps them that way, see utils/namespace.ts), so
 * `$toString` is the variable, not the method. One that has a prototype
 * loses it, in place so that writes still reach it; one that cannot change
 * is passed as a copy (writes to it are lost either way).
 */
function namespaceArg(ns: Namespace): Namespace {
  if (isNamespace(ns)) return ns;
  if (!Object.isExtensible(ns)) return asNamespace(ns);
  Object.setPrototypeOf(ns, null);
  return ns;
}

/** The namespaces code runs in, as evaluate() and execute() take them. */
type Namespaces = [
  variables: Namespace,
  temporary: Namespace,
  locals?: Namespace,
  transient?: Namespace,
];

/** Run compiled code in `namespaces`. */
function run(
  fn: CompiledExpression,
  ...[
    variables,
    temporary,
    locals = EMPTY_NAMESPACE,
    transient = EMPTY_NAMESPACE,
  ]: Namespaces
): unknown {
  return fn(
    namespaceArg(variables),
    namespaceArg(temporary),
    namespaceArg(locals),
    buildExpressionFns(),
    namespaceArg(transient),
  );
}

/**
 * Evaluate an expression and return its value.
 * e.g. evaluate("$health + 10", variables, temporary) → number
 */
export function evaluate(expr: string, ...namespaces: Namespaces): unknown {
  const transformed = transform(expr);
  // The line break keeps a trailing `// comment` from swallowing the `)`.
  const body = `return (${transformed}\n);`;
  return run(getOrCompile(body, body), ...namespaces);
}

/**
 * Execute statements (no return value).
 * e.g. execute("$health = 100; $name = 'Hero'", variables, temporary)
 */
export function execute(code: string, ...namespaces: Namespaces): void {
  const transformed = transform(code, 'statements');
  run(getOrCompile('exec:' + transformed, transformed), ...namespaces);
}

/**
 * Convenience: evaluate using store state directly.
 */
/** Clear the compiled expression cache. Useful for testing and HMR. */
export function clearExpressionCache(): void {
  fnCache.clear();
  transformCache.clear();
  cachedFns = null;
  cachedVisitCounts = null;
  cachedRenderCounts = null;
}

export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary, {}, state.transient);
}
