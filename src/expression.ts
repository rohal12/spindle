import type { StoryState } from './store';
import { useStoryStore } from './store';
import type { Passage } from './parser';
import { random, randomInt } from './prng';
import { lexJs, type JsGoal, type Sigil } from './js-lexer';

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
 * or a block. Exported for tests.
 */
export function transform(expr: string, goal: JsGoal = 'expression'): string {
  let result = '';
  lexJs(
    expr,
    {
      code(ch) {
        result += ch;
      },
      literal(text) {
        result += text;
      },
      variable(sigil, name) {
        // `typeof%x` needs a space once `%x` turns into an identifier.
        if (IDENT_END_RE.test(result.slice(-2))) result += ' ';
        result += `${NAMESPACES[sigil]}["${name}"]`;
      },
    },
    goal,
  );
  return result;
}

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

let cachedFns: ExpressionFns | null = null;
let cachedVisitCounts: Record<string, number> | null = null;
let cachedRenderCounts: Record<string, number> | null = null;

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

  const visited = (name?: string): number =>
    visitCounts[name ?? useStoryStore.getState().currentPassage] ?? 0;
  const hasVisited = (name?: string): boolean => visited(name) > 0;
  const hasVisitedAny = (...names: string[]): boolean =>
    names.some((n) => visited(n) > 0);
  const hasVisitedAll = (...names: string[]): boolean =>
    names.every((n) => visited(n) > 0);

  const rendered = (name?: string): number =>
    renderCounts[name ?? useStoryStore.getState().currentPassage] ?? 0;
  const hasRendered = (name?: string): boolean => rendered(name) > 0;
  const hasRenderedAny = (...names: string[]): boolean =>
    names.some((n) => rendered(n) > 0);
  const hasRenderedAll = (...names: string[]): boolean =>
    names.every((n) => rendered(n) > 0);

  const currentPassage = (): Passage | undefined => {
    const s = useStoryStore.getState();
    return s.storyData?.passages.get(s.currentPassage);
  };
  const previousPassage = (): Passage | undefined => {
    const s = useStoryStore.getState();
    if (s.historyIndex <= 0) return undefined;
    const prevName = s.history[s.historyIndex - 1]?.passage;
    return prevName ? s.storyData?.passages.get(prevName) : undefined;
  };

  cachedFns = {
    currentPassage,
    previousPassage,
    visited,
    hasVisited,
    hasVisitedAny,
    hasVisitedAll,
    rendered,
    hasRendered,
    hasRenderedAny,
    hasRenderedAll,
    random,
    randomInt,
  };
  cachedVisitCounts = visitCounts;
  cachedRenderCounts = renderCounts;

  return cachedFns;
}

/**
 * Evaluate an expression and return its value.
 * e.g. evaluate("$health + 10", variables, temporary) → number
 */
export function evaluate(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown> = {},
  transient: Record<string, unknown> = {},
): unknown {
  const transformed = transform(expr);
  // The line break keeps a trailing `// comment` from swallowing the `)`.
  const body = `return (${transformed}\n);`;
  const fn = getOrCompile(body, body);
  return fn(variables, temporary, locals, buildExpressionFns(), transient);
}

/**
 * Execute statements (no return value).
 * e.g. execute("$health = 100; $name = 'Hero'", variables, temporary)
 */
export function execute(
  code: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown> = {},
  transient: Record<string, unknown> = {},
): void {
  const transformed = transform(code, 'statements');
  const fn = getOrCompile('exec:' + transformed, transformed);
  fn(variables, temporary, locals, buildExpressionFns(), transient);
}

/**
 * Convenience: evaluate using store state directly.
 */
/** Clear the compiled expression cache. Useful for testing and HMR. */
export function clearExpressionCache(): void {
  fnCache.clear();
  cachedFns = null;
  cachedVisitCounts = null;
  cachedRenderCounts = null;
}

export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary, {}, state.transient);
}
