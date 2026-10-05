import type { StoryState } from './store';
import { useStoryStore } from './store';
import type { Passage } from './parser';
import { random, randomInt } from './prng';
import { lexJs } from './js-lexer';

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

/**
 * Transform expression: $var → variables["var"], _var → temporary["var"],
 * @var → locals["var"], %var → transient["var"].
 * Only transforms when sigils appear as a word boundary, and only in code:
 * string, template and regex literal text and comments are left untouched.
 * `%var` is recognised by the lexer (`lexJs`), because `%` is also the modulo
 * operator and only an operand position makes it a sigil.
 */
const VAR_RE = /\$(\w+)/g;
const TEMP_RE = /(?<![.\w])_(\w+)/g;
const LOCAL_RE = /@(\w+)/g;

function transformSegment(segment: string): string {
  return segment
    .replace(VAR_RE, 'variables["$1"]')
    .replace(TEMP_RE, 'temporary["$1"]')
    .replace(LOCAL_RE, 'locals["$1"]');
}

/**
 * Rewrite sigil references in `expr`. The lexer passes literal text and
 * comments through untouched; each run of code between them (including the
 * code of template-literal `${…}` interpolations) is transformed as a whole.
 */
function transform(expr: string): string {
  let result = '';
  let code = ''; // accumulates code characters to be transformed

  function flushCode() {
    if (code) {
      result += transformSegment(code);
      code = '';
    }
  }

  lexJs(expr, {
    code(ch) {
      code += ch;
    },
    literal(text) {
      flushCode();
      result += text;
    },
    transient(name) {
      flushCode();
      result += `transient["${name}"]`;
    },
  });
  flushCode();
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
  const transformed = transform(code);
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
