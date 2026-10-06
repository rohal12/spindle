/**
 * The macro argument layer: reads a macro's raw argument text into the
 * parameters its definition declares (see ParameterDef), so every macro
 * splits and unquotes its arguments the same way. defineMacro() passes the
 * result to the macro as `ctx.args`.
 *
 * Arguments are read in groups, split at `separator` parameters. A group's
 * `flag` parameters are taken off its start or end first. Its last
 * `expression` or `text` parameter (without one, its last parameter) reads
 * the text the others leave; each parameter before it reads one term from
 * the start, and each after it one term from the end. Terms are separated by
 * whitespace outside literals and brackets (see arg-utils.ts), and a term
 * that follows an operator belongs to the expression before it. A parameter
 * with nothing to read is unset (a flag or separator is false, options are
 * empty).
 */
import { parseDelay } from '../../utils/parse-delay';
import type { MacroArgs, ParameterDef } from '../../registry';
import {
  endsWithOperator,
  isWhitespace,
  readQuoted,
  readWholeQuoted,
  stripLooseQuotes,
  topLevelIndices,
} from './arg-utils';

type Span = [start: number, end: number];

/** The terms of `src`: the runs of text between its depth-0 whitespace. */
function terms(src: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const i of [...topLevelIndices(src, isWhitespace), src.length]) {
    if (i > start) spans.push([start, i]);
    start = i + 1;
  }
  return spans;
}

const slice = (src: string, [start, end]: Span) => src.slice(start, end);

/**
 * The value of a `text` argument: one quoted string, or the text with any
 * loose quotes stripped (`"Red` → `Red`).
 */
export function readText(src: string): string {
  return readWholeQuoted(src) ?? stripLooseQuotes(src);
}

function readValue(param: ParameterDef, src: string): unknown {
  switch (param.type) {
    case 'string':
      return readWholeQuoted(src) ?? undefined;
    case 'text':
      return readText(src);
    case 'names':
      return src.split(',').map((name) => name.trim());
    case 'delay':
      return parseDelay(src);
    case 'number':
      return Number(src);
    case 'options':
      return readOptions(param.parameters ?? [], src);
    default:
      return src;
  }
}

function unset(param: ParameterDef): unknown {
  if (param.type === 'flag' || param.type === 'separator') return false;
  return param.type === 'options' ? {} : undefined;
}

const WORD_RE = /\w+/y;
const DIGITS_RE = /\d+/y;

/** Match the sticky regex `re` at `pos`, returning the matched text. */
function matchAt(re: RegExp, src: string, pos: number): string | null {
  re.lastIndex = pos;
  return re.exec(src)?.[0] ?? null;
}

/**
 * Read keyword options (`goto "X" priority 5 once`). A keyword takes the
 * quoted string or digit run after it as its value; keywords that aren't
 * declared, and their values, are skipped.
 */
function readOptions(
  params: readonly ParameterDef[],
  src: string,
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  let i = 0;
  while (i < src.length) {
    const key = matchAt(WORD_RE, src, i);
    if (!key) {
      // Skip whitespace and stray characters, or a stray quoted string.
      i = readQuoted(src, i)?.end ?? i + 1;
      continue;
    }
    i += key.length;

    // A value is a quoted string or a digit run, after whitespace.
    let val: string | undefined;
    let j = i;
    while (j < src.length && isWhitespace(src[j]!)) j++;
    if (j > i) {
      const quoted = readQuoted(src, j);
      const digits = quoted ? null : matchAt(DIGITS_RE, src, j);
      if (quoted) {
        val = quoted.value;
        i = quoted.end;
      } else if (digits) {
        val = digits;
        i = j + digits.length;
      }
    }

    const param = params.find((p) => p.name === key);
    if (param?.type === 'flag') options[key] = true;
    else if (param?.type === 'number') options[key] = Number(val ?? 0);
    else if (param) options[key] = val;
  }
  return options;
}

/** `inline %name` reads a transient variable; `inline % 2` is modulo. */
const LEADING_OPERATOR_RE = /^(?:[-+*/&|^=<>?:,.]|%(?![A-Za-z_]))/;

/**
 * The rest of `src` without the flag `word` as its last or first term, or
 * `null` if it has no such flag. Next to a binary operator the word is an
 * operand (`"a" + inline`), not a flag; the closing `/` of a regex literal
 * is not one.
 */
function takeFlag(src: string, word: string): string | null {
  const spans = terms(src);
  if (spans.length < 2) return null;
  if (slice(src, spans[spans.length - 1]!) === word) {
    const rest = src.slice(0, spans[spans.length - 2]![1]);
    if (!endsWithOperator(rest)) return rest;
  }
  if (slice(src, spans[0]!) === word) {
    const rest = src.slice(spans[1]![0]);
    if (!LEADING_OPERATOR_RE.test(rest)) return rest;
  }
  return null;
}

/**
 * Where the separator `word` splits `src`, as the end of the text before it
 * and the start of the text after it, or `null` if it doesn't. A word is a
 * term with terms on both sides; `=` is an assignment at depth 0, not part
 * of `==` or `!=`.
 */
function findSeparator(src: string, word: string): Span | null {
  if (word === '=') {
    const indices = topLevelIndices(src, (ch) => ch === '=');
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k]!;
      if (src[i + 1] === '=') {
        k++;
        continue;
      }
      if (src[i - 1] !== '!') return [i, i + 1];
    }
    return null;
  }
  const spans = terms(src);
  for (let k = 1; k < spans.length - 1; k++) {
    if (slice(src, spans[k]!) === word) {
      return [spans[k - 1]![1], spans[k + 1]![0]];
    }
  }
  return null;
}

const takesRest = (param: ParameterDef) =>
  param.type === undefined ||
  param.type === 'expression' ||
  param.type === 'text';

/** Read the parameters of one group from `src` (`null`: no text) into `args`. */
function readGroup(
  params: readonly ParameterDef[],
  src: string | null,
  args: Record<string, unknown>,
): void {
  let text = src?.trim() ?? '';
  for (const flag of params.filter((p) => p.type === 'flag')) {
    const rest = src === null ? null : takeFlag(text, flag.name);
    args[flag.name] = rest !== null;
    text = rest ?? text;
  }
  const positional = params.filter((p) => p.type !== 'flag');
  if (positional.length === 0) return;

  // The last expression or text parameter, else the last one, reads the rest.
  const lastText = positional.findIndex(
    (p, i) => takesRest(p) && !positional.slice(i + 1).some(takesRest),
  );
  const restIndex = lastText < 0 ? positional.length - 1 : lastText;
  const read = (param: ParameterDef, value: string) =>
    value === '' ? unset(param) : readValue(param, value);

  // One parameter reads the whole text: no need to split it.
  if (positional.length === 1) {
    args[positional[0]!.name] = read(positional[0]!, text);
    return;
  }

  const spans = terms(text);
  let from = 0;
  let to = spans.length;
  for (const param of positional.slice(0, restIndex)) {
    args[param.name] =
      from < to ? read(param, slice(text, spans[from++]!)) : unset(param);
  }
  for (const param of positional.slice(restIndex + 1).reverse()) {
    const value =
      from < to && !endsWithOperator(text.slice(0, spans[to - 1]![0]))
        ? read(param, slice(text, spans[to - 1]!))
        : undefined;
    args[param.name] = value ?? unset(param);
    if (value !== undefined) to--;
  }
  const rest = positional[restIndex]!;
  args[rest.name] =
    from < to
      ? read(rest, text.slice(spans[from]![0], spans[to - 1]![1]))
      : unset(rest);
}

/** The duration a timing macro ({repeat}, {type}, {timed}/{next}) waits. */
export const DELAY_PARAMETER = {
  name: 'delay',
  type: 'delay',
  required: true,
} as const;

/** Read `rawArgs` into the declared `parameters` (see above). */
export function parseMacroArgs<const P extends readonly ParameterDef[]>(
  rawArgs: string,
  parameters: P,
): MacroArgs<P> {
  const args: Record<string, unknown> = {};
  // The text after the last separator read, null once one is missing
  let rest: string | null = rawArgs.trim();
  let groupStart = 0;
  parameters.forEach((separator, i) => {
    if (separator.type !== 'separator') return;
    const at = rest === null ? null : findSeparator(rest, separator.name);
    args[separator.name] = at !== null;
    const before = at ? rest!.slice(0, at[0]) : rest;
    readGroup(parameters.slice(groupStart, i), before, args);
    rest = at ? rest!.slice(at[1]) : null;
    groupStart = i + 1;
  });
  readGroup(parameters.slice(groupStart), rest, args);
  return args as MacroArgs<P>;
}

/**
 * The passage a passage-name argument names: the value of its expression
 * or, when that can't be evaluated (`{goto Bob's room}`), its text.
 */
export function evaluatePassageName(
  expr: string | undefined,
  evaluate: (expr: string) => unknown,
): string {
  try {
    return String(evaluate(expr ?? ''));
  } catch {
    return readText(expr ?? '');
  }
}

/**
 * The variable a `storeVar` macro binds: its first term, as written. Custom
 * macros may bind one without declaring parameters.
 */
export function readBoundVariable(rawArgs: string): string {
  const src = rawArgs.trim();
  const first = terms(src)[0];
  return first ? slice(src, first) : '';
}
