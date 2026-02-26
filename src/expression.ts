import type { StoryState } from "./store";

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

function getOrCompile(key: string, body: string): Function {
  let fn = fnCache.get(key);
  if (!fn) {
    fn = new Function("variables", "temporary", body);
    fnCache.set(key, fn);
  }
  return fn;
}

/**
 * Evaluate an expression and return its value.
 * e.g. evaluate("$health + 10", variables, temporary) → number
 */
export function evaluate(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>
): unknown {
  const transformed = transform(expr);
  const body = `return (${transformed});`;
  const fn = getOrCompile(body, body);
  return fn(variables, temporary);
}

/**
 * Execute statements (no return value).
 * e.g. execute("$health = 100; $name = 'Hero'", variables, temporary)
 */
export function execute(
  code: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>
): void {
  const transformed = transform(code);
  const fn = getOrCompile("exec:" + transformed, transformed);
  fn(variables, temporary);
}

/**
 * Convenience: evaluate using store state directly.
 */
export function evaluateWithState(expr: string, state: StoryState): unknown {
  return evaluate(expr, state.variables, state.temporary);
}
