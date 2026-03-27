import { evaluate } from './expression';

/** Detects any {…} block that starts with a sigil ($, _, @, %). */
const INTERP_TEST = /\{[\$_@%]\w/;

export function hasInterpolation(s: string): boolean {
  return INTERP_TEST.test(s);
}

function resolveDotPath(root: unknown, parts: string[]): unknown {
  let value = root;
  for (let i = 1; i < parts.length; i++) {
    if (value == null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[parts[i]!];
  }
  return value;
}

/**
 * Evaluate an expression string and return its stringified result.
 * Uses the full expression evaluator from expression.ts.
 */
export function interpolateExpression(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown> = {},
): string {
  const value = evaluate(expr, variables, temporary, locals, transient);
  return value == null ? '' : String(value);
}

function resolveSimple(
  ref: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown>,
): string {
  const prefix = ref[0]!;
  const path = ref.slice(1);
  const parts = path.split('.');
  const root = parts[0]!;

  let value: unknown;
  if (prefix === '$') {
    value = variables[root];
  } else if (prefix === '_') {
    value = temporary[root];
  } else if (prefix === '%') {
    value = transient[root];
  } else {
    value = locals[root];
  }

  if (parts.length > 1) {
    value = resolveDotPath(value, parts);
  }

  return value == null ? '' : String(value);
}

export function interpolate(
  template: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown> = {},
): string {
  // Manual scan: process {…} blocks containing sigils.
  // Simple dot-path refs use the fast resolver; everything else falls back
  // to the full expression evaluator.
  let result = '';
  let i = 0;

  while (i < template.length) {
    if (template[i] !== '{') {
      // Accumulate plain text
      const nextBrace = template.indexOf('{', i);
      if (nextBrace === -1) {
        result += template.slice(i);
        break;
      }
      result += template.slice(i, nextBrace);
      i = nextBrace;
      continue;
    }

    // Found { — check if it starts a sigil expression
    i++; // skip {

    const sigil = template[i];
    if (sigil !== '$' && sigil !== '_' && sigil !== '@' && sigil !== '%') {
      // Not an interpolation — emit the { as text
      result += '{';
      continue;
    }

    // Scan for balanced closing }
    let depth = 1;
    let j = i;
    while (j < template.length && depth > 0) {
      j++;
      if (template[j] === '{') depth++;
      else if (template[j] === '}') depth--;
    }

    if (depth !== 0) {
      // Unbalanced — emit as text
      result += '{';
      continue;
    }

    const inner = template.slice(i, j);
    i = j + 1; // skip past closing }

    // Try simple dot-path match first
    if (/^[\$_@%][\w.]+$/.test(inner)) {
      result += resolveSimple(inner, variables, temporary, locals, transient);
    } else {
      result += interpolateExpression(
        inner,
        variables,
        temporary,
        locals,
        transient,
      );
    }
  }

  return result;
}
