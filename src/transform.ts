/**
 * The sigil transform: the story's code with its variable references
 * (`$var`, `_var`, `@var`, `%var`) turned into the namespace lookups the
 * expression engine runs. Pure string-to-string, so tooling can use it
 * (see src/tooling.ts).
 */
import { parseCode, type JsGoal, type Sigil } from './js-lexer';
import { variableNameError } from './utils/namespace';

const TRANSFORM_CACHE_MAX = 500;

/**
 * The identifiers generated code reads the namespaces through, and the
 * compiled function takes them under (see src/expression.ts). Authored
 * JavaScript may declare identifiers of its own (`const variables = {}` in
 * a helper), so these are ones it cannot: an identifier that starts with
 * `_` or `$` and has more word characters after it is a sigil reference,
 * and the lexer refuses to declare one (`__variables` is the temporary
 * variable `_variables`, rewritten like any other). No declaration or
 * parameter of the author's can then capture a reference or clash with the
 * generated bindings.
 */
export const BINDINGS: Record<Sigil, string> = {
  $: '__variables',
  _: '__temporary',
  '@': '__locals',
  '%': '__transient',
};

/** The identifier the functions that compiled code may call come under. */
export const FNS_BINDING = '__fns';

/** Ends with an identifier character. */
const IDENT_END_RE = /[\p{ID_Continue}$\u200c\u200d]$/u;

/**
 * Transform expression: $var → variables["var"], _var → temporary["var"],
 * @var → locals["var"], %var → transient["var"], where `variables` and the
 * others stand for the generated names in BINDINGS.
 * The lexer (`lexJs`) finds the references: only in code (string, template
 * and regex literal text and comments are left untouched), only where an
 * identifier starts (not in `a$b`, nor as the property name in `obj._x`),
 * and `%var` only where an operand is expected, since `%` is also the
 * modulo operator. `goal` tells whether `expr` is an expression or a list of
 * statements, as that decides whether a leading `{` opens an object literal
 * or a block. A reference to a variable named `__proto__` throws a
 * SyntaxError: no namespace can hold one (see utils/namespace.ts).
 *  */
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
    result += `${BINDINGS[ref.sigil]}["${ref.name}"]`;
    at = ref.end;
  }
  result += expr.slice(at);
  if (transformCache.size >= TRANSFORM_CACHE_MAX) {
    transformCache.delete(transformCache.keys().next().value!);
  }
  transformCache.set(key, result);
  return result;
}

/** Transformed code by goal and source. */
const transformCache = new Map<string, string>();

/** Clear the transformed code. Useful for testing and HMR. */
export function clearTransformCache(): void {
  transformCache.clear();
}
