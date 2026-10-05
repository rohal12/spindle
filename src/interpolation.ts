import { evaluate } from './expression';
import { createScanMemo, scanBalancedBrace } from './markup/tokenizer';
import { checkVariableName, ownValue } from './utils/namespace';

/** Detects any {…} block that starts with a sigil ($, _, @, %). */
const INTERP_TEST = /\{[\$_@%]\w/;

export function hasInterpolation(s: string): boolean {
  return INTERP_TEST.test(s);
}

function resolveDotPath(root: unknown, parts: string[]): unknown {
  let value = root;
  for (let i = 1; i < parts.length; i++) {
    // Primitives box on access, so `{$name.length}` works too.
    if (value == null) return undefined;
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
  checkVariableName(root, prefix + root);

  // Own entries only, as the expression engine reads them
  let value: unknown;
  if (prefix === '$') {
    value = ownValue(variables, root);
  } else if (prefix === '_') {
    value = ownValue(temporary, root);
  } else if (prefix === '%') {
    value = ownValue(transient, root);
  } else {
    value = ownValue(locals, root);
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
  // Simple dot-path refs use the fast resolver; everything else falls back
  // to the full expression evaluator.
  let result = '';
  for (const part of splitTemplate(template)) {
    if ('text' in part) {
      result += part.text;
    } else if (/^[\$_@%][\w.]+$/.test(part.expr)) {
      result += resolveSimple(
        part.expr,
        variables,
        temporary,
        locals,
        transient,
      );
    } else {
      result += interpolateExpression(
        part.expr,
        variables,
        temporary,
        locals,
        transient,
      );
    }
  }
  return result;
}

/** Literal text, or the source of one `{…}` interpolation (without braces). */
export type TemplatePart = { text: string } | { expr: string };

/**
 * Split a template into literal text and its {…} blocks that start with a
 * sigil. Braces inside strings don't close a block; an unclosed block is
 * text.
 */
export function splitTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const memo = createScanMemo();
  let text = '';
  let i = 0;

  while (i < template.length) {
    if (template[i] !== '{') {
      // Accumulate plain text
      const nextBrace = template.indexOf('{', i);
      if (nextBrace === -1) {
        text += template.slice(i);
        break;
      }
      text += template.slice(i, nextBrace);
      i = nextBrace;
      continue;
    }

    // Found { — check if it starts a sigil expression
    i++; // skip {

    const sigil = template[i];
    if (sigil !== '$' && sigil !== '_' && sigil !== '@' && sigil !== '%') {
      // Not an interpolation — keep the { as text
      text += '{';
      continue;
    }

    // Scan for balanced closing }, ignoring braces inside strings
    const j = scanBalancedBrace(template, i, memo);

    if (j === -1) {
      // Unbalanced — keep as text
      text += '{';
      continue;
    }

    if (text) parts.push({ text });
    text = '';
    parts.push({ expr: template.slice(i, j) });
    i = j + 1; // skip past closing }
  }

  if (text) parts.push({ text });
  return parts;
}
