import type { StoryState } from './store';
import { useStoryStore } from './store';

interface ExpressionFns {
  visited: (name: string) => number;
  hasVisited: (name: string) => boolean;
  hasVisitedAny: (...names: string[]) => boolean;
  hasVisitedAll: (...names: string[]) => boolean;
  rendered: (name: string) => number;
  hasRendered: (name: string) => boolean;
  hasRenderedAny: (...names: string[]) => boolean;
  hasRenderedAll: (...names: string[]) => boolean;
}

type CompiledExpression = (
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
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

function transform(expr: string): string {
  return expr
    .replace(VAR_RE, 'variables["$1"]')
    .replace(TEMP_RE, 'temporary["$1"]');
}

const preamble =
  'const {visited,hasVisited,hasVisitedAny,hasVisitedAll,rendered,hasRendered,hasRenderedAny,hasRenderedAll}=__fns;';

function getOrCompile(key: string, body: string): CompiledExpression {
  const cached = fnCache.get(key);
  if (cached) {
    // Move to end for LRU ordering (Map preserves insertion order)
    fnCache.delete(key);
    fnCache.set(key, cached);
    return cached;
  }
  const fn = new Function('variables', 'temporary', '__fns', preamble + body) as CompiledExpression;
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

  cachedFns = {
    visited,
    hasVisited,
    hasVisitedAny,
    hasVisitedAll,
    rendered,
    hasRendered,
    hasRenderedAny,
    hasRenderedAll,
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
): unknown {
  const transformed = transform(expr);
  const body = `return (${transformed});`;
  const fn = getOrCompile(body, body);
  return fn(variables, temporary, buildExpressionFns());
}

/**
 * Execute statements (no return value).
 * e.g. execute("$health = 100; $name = 'Hero'", variables, temporary)
 */
export function execute(
  code: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
): void {
  const transformed = transform(code);
  const fn = getOrCompile('exec:' + transformed, transformed);
  fn(variables, temporary, buildExpressionFns());
}

/**
 * Convenience: evaluate using store state directly.
 */
export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary);
}
