import type { StoryState } from './store';
import { useStoryStore } from './store';
import type { Passage } from './parser';
import { random, randomInt } from './prng';

interface ExpressionFns {
  currentPassage: () => Passage | undefined;
  previousPassage: () => Passage | undefined;
  visited: (name: string) => number;
  hasVisited: (name: string) => boolean;
  hasVisitedAny: (...names: string[]) => boolean;
  hasVisitedAll: (...names: string[]) => boolean;
  rendered: (name: string) => number;
  hasRendered: (name: string) => boolean;
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
) => unknown;

const FN_CACHE_MAX = 500;
const fnCache = new Map<string, CompiledExpression>();

/**
 * Transform expression: $var → variables["var"], _var → temporary["var"]
 * Only transforms when $ or _ appears as a word boundary (not inside strings naively,
 * but authors already have full JS access so this is acceptable).
 */
const VAR_RE = /\$(\w+)/g;
const TEMP_RE = /\b_(\w+)/g;
const LOCAL_RE = /@(\w+)/g;

function transformSegment(segment: string): string {
  return segment
    .replace(VAR_RE, 'variables["$1"]')
    .replace(TEMP_RE, 'temporary["$1"]')
    .replace(LOCAL_RE, 'locals["$1"]');
}

/**
 * String-aware expression transformer. Walks the expression character by
 * character so that variable sigils ($, _, @) inside string literals are
 * left untouched while code — including expressions inside template-literal
 * `${…}` interpolations — is transformed.
 */
function transform(expr: string): string {
  let result = '';
  let code = ''; // accumulates code characters to be transformed
  let i = 0;

  function flushCode() {
    if (code) {
      result += transformSegment(code);
      code = '';
    }
  }

  while (i < expr.length) {
    const ch = expr.charAt(i);

    // Single or double quoted string — skip entirely
    if (ch === '"' || ch === "'") {
      flushCode();
      const quote = ch;
      let str = quote;
      i++;
      while (i < expr.length) {
        const c = expr.charAt(i);
        if (c === '\\' && i + 1 < expr.length) {
          str += c + expr.charAt(i + 1);
          i += 2;
        } else if (c === quote) {
          str += quote;
          i++;
          break;
        } else {
          str += c;
          i++;
        }
      }
      result += str;
      continue;
    }

    // Template literal — preserve literal parts, transform interpolations
    if (ch === '`') {
      flushCode();
      result += '`';
      i++;
      while (i < expr.length) {
        const c = expr.charAt(i);
        if (c === '\\' && i + 1 < expr.length) {
          result += c + expr.charAt(i + 1);
          i += 2;
        } else if (c === '$' && expr.charAt(i + 1) === '{') {
          // Template interpolation — collect the inner expression and
          // recursively transform it
          result += '${';
          i += 2;
          let depth = 1;
          let inner = '';
          while (i < expr.length && depth > 0) {
            const ic = expr.charAt(i);
            if (ic === '{') {
              depth++;
              inner += ic;
            } else if (ic === '}') {
              depth--;
              if (depth === 0) break;
              inner += ic;
            } else if (ic === '\\' && i + 1 < expr.length) {
              inner += ic + expr.charAt(i + 1);
              i++;
            } else {
              inner += ic;
            }
            i++;
          }
          result += transform(inner); // recursive transform
          if (i < expr.length && expr.charAt(i) === '}') {
            result += '}';
            i++;
          }
        } else if (c === '`') {
          result += '`';
          i++;
          break;
        } else {
          result += c;
          i++;
        }
      }
      continue;
    }

    // Regular code character
    code += ch;
    i++;
  }
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

  const visited = (name: string): number => visitCounts[name] ?? 0;
  const hasVisited = (name: string): boolean => visited(name) > 0;
  const hasVisitedAny = (...names: string[]): boolean =>
    names.some((n) => visited(n) > 0);
  const hasVisitedAll = (...names: string[]): boolean =>
    names.every((n) => visited(n) > 0);

  const rendered = (name: string): number => renderCounts[name] ?? 0;
  const hasRendered = (name: string): boolean => rendered(name) > 0;
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
): unknown {
  const transformed = transform(expr);
  const body = `return (${transformed});`;
  const fn = getOrCompile(body, body);
  return fn(variables, temporary, locals, buildExpressionFns());
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
): void {
  const transformed = transform(code);
  const fn = getOrCompile('exec:' + transformed, transformed);
  fn(variables, temporary, locals, buildExpressionFns());
}

/**
 * Convenience: evaluate using store state directly.
 */
export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary, {});
}
