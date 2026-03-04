import type { StoryState } from './store';
import { useStoryStore } from './store';

const fnCache = new Map<string, Function>();

/**
 * Transform expression: $var → variables["var"], _var → temporary["var"]
 * Only transforms when $ or _ appears as a word boundary (not inside strings naively,
 * but authors already have full JS access so this is acceptable).
 */
function transform(expr: string): string {
  return expr
    .replace(/\$(\w+)/g, 'variables["$1"]')
    .replace(/\b_(\w+)/g, 'temporary["$1"]');
}

const preamble =
  'const {visited,hasVisited,hasVisitedAny,hasVisitedAll,rendered,hasRendered,hasRenderedAny,hasRenderedAll}=__fns;';

function getOrCompile(key: string, body: string): Function {
  let fn = fnCache.get(key);
  if (!fn) {
    fn = new Function('variables', 'temporary', '__fns', preamble + body);
    fnCache.set(key, fn);
  }
  return fn;
}

export function buildExpressionFns() {
  const state = useStoryStore.getState();
  const { visitCounts, renderCounts } = state;

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

  return {
    visited,
    hasVisited,
    hasVisitedAny,
    hasVisitedAll,
    rendered,
    hasRendered,
    hasRenderedAny,
    hasRenderedAll,
  };
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
