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
import type { Span as SourceSpan } from '../../markup/tokens';
import type { MacroArgs, ParameterDef } from '../../registry';
import type { StoryState } from '../../store';
import { noPassageError } from '../../runtime-errors';
import {
  parseMemberIdentifier,
  parseReferencePath,
  stringLiteralValue,
} from '../../js-lexer';
import { RESERVED_NAME } from '../../utils/namespace';
import {
  endsWithOperator,
  isWhitespace,
  readQuoted,
  readWholeQuoted,
  stripLooseQuotes,
  topLevelIndices,
} from './arg-utils';

type Span = [start: number, end: number];

/**
 * Where parseMacroArgs read each argument it set from text (not flags or
 * separators), by parameter, options too: the start and end of its text in
 * the raw arguments, quotes included.
 */
export type ArgSpans = Map<ParameterDef, Span>;

/** Where a group's text is in the raw arguments, and the spans read so far. */
interface Place {
  /** The index in the raw arguments of the text being read. */
  at: number;
  spans: ArgSpans | undefined;
  /** Full parameter spans for tolerant editor input, including keywords. */
  toolingSpans?: ArgSpans;
}

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

/**
 * An argument that doesn't have its parameter's form: a `string` parameter
 * given anything but one quoted string.
 */
export class MacroArgumentError extends Error {
  constructor(param: ParameterDef, src: string) {
    super(
      `The ${param.name} must be a quoted string ("…" or '…'), ${src ? `not ${src}` : 'but it has no value'}`,
    );
    this.name = 'MacroArgumentError';
  }
}

/** Read `src`, at `place`, as `param` says. */
function readValue(param: ParameterDef, src: string, place: Place): unknown {
  const span: Span = [place.at, place.at + src.length];
  place.spans?.set(param, span);
  place.toolingSpans?.set(param, span);
  switch (param.type) {
    case 'string': {
      const value = readWholeQuoted(src);
      if (value === null) {
        if (place.toolingSpans && (src[0] === '"' || src[0] === "'")) {
          return readText(src);
        }
        throw new MacroArgumentError(param, src);
      }
      return value;
    }
    case 'text':
      return readText(src);
    case 'names':
      return src.split(',').map((name) => name.trim());
    case 'delay':
      return parseDelay(src);
    case 'number':
      return Number(src);
    case 'options':
      return readOptions(param.parameters ?? [], src, place);
    default:
      return src;
  }
}

function unset(param: ParameterDef): unknown {
  if (param.type === 'flag' || param.type === 'separator') return false;
  return param.type === 'options' ? {} : undefined;
}

const WORD_RE = /\w+/y;
const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)/y;
const WORD_OR_PUNCT_RE = /\S+/y;

/** Match the sticky regex `re` at `pos`, returning the matched text. */
function matchAt(re: RegExp, src: string, pos: number): string | null {
  re.lastIndex = pos;
  return re.exec(src)?.[0] ?? null;
}

/**
 * Read keyword options (`goto "X" priority 5 once`). A keyword takes the
 * quoted string (with or without whitespace before it) or number (signed,
 * fractional) after
 * it as its value; keywords that aren't declared, and their values, are
 * skipped. A keyword of a `string` parameter must be followed by a quoted
 * string.
 */
function readOptions(
  params: readonly ParameterDef[],
  src: string,
  { at, spans, toolingSpans }: Place,
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  let i = 0;
  while (i < src.length) {
    const key = matchAt(WORD_RE, src, i);
    if (!key) {
      // Skip whitespace and stray characters, or a stray quoted string.
      i = readQuoted(src, i, !!toolingSpans)?.end ?? i + 1;
      continue;
    }
    const keyAt = i;
    i += key.length;

    // A value is a quoted string, which may follow the keyword directly
    // (`goto"Hall"`: a quote can't be part of one), or a number after
    // whitespace.
    let val: string | undefined;
    let j = i;
    while (j < src.length && isWhitespace(src[j]!)) j++;
    const quoted = readQuoted(src, j, !!toolingSpans);
    const digits = quoted || j === i ? null : matchAt(NUMBER_RE, src, j);
    if (quoted) {
      val = quoted.value;
      i = quoted.end;
    } else if (digits) {
      val = digits;
      i = j + digits.length;
    }

    const param = params.find((p) => p.name === key);
    if (param && param.type !== 'flag' && val !== undefined) {
      spans?.set(param, [at + j, at + i]);
    }
    if (param) toolingSpans?.set(param, [at + keyAt, at + i]);
    // A keyword that takes a string was given anything else, or nothing
    if (param?.type === 'string' && !quoted && !toolingSpans) {
      throw new MacroArgumentError(
        param,
        matchAt(WORD_OR_PUNCT_RE, src, j) ?? '',
      );
    }
    if (param?.type === 'flag') options[key] = true;
    else if (param?.type === 'number') options[key] = Number(val ?? 0);
    else if (param) options[key] = val;
  }
  return options;
}

/** `inline %name` reads a transient variable; `inline % 2` is modulo. */
const LEADING_OPERATOR_RE = /^(?:[-+*/&|^=<>?:,]|\.(?!\d)|%(?![A-Za-z_]))/;

/**
 * Where the rest of `src` is without the flag `word` as its last or first
 * term, or `null` if it has no such flag. Next to a binary operator the
 * word is an operand (`"a" + inline`), not a flag; the closing `/` of a
 * regex literal is not one. A word with nothing else beside it is the flag
 * only when `alone` says no argument is waiting for it (#499).
 */
function takeFlag(src: string, word: string, alone: boolean): Span | null {
  const spans = terms(src);
  if (spans.length === 1) {
    return alone && slice(src, spans[0]!) === word
      ? [src.length, src.length]
      : null;
  }
  if (spans.length < 2) return null;
  if (slice(src, spans[spans.length - 1]!) === word) {
    const rest: Span = [0, spans[spans.length - 2]![1]];
    if (!endsWithOperator(slice(src, rest))) return rest;
  }
  if (slice(src, spans[0]!) === word) {
    const rest: Span = [spans[1]![0], src.length];
    if (!LEADING_OPERATOR_RE.test(slice(src, rest))) return rest;
  }
  return null;
}

/**
 * Where the separator `word` splits `src`, as the end of the text before it
 * and the start of the text after it, or `null` if it doesn't. A word is a
 * term with terms on both sides; `=` is an assignment at depth 0, not part
 * of `==` or `!=`.
 */
function findSeparator(
  src: string,
  word: string,
  tolerant = false,
): Span | null {
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
  for (let k = 1; k < spans.length - (tolerant ? 0 : 1); k++) {
    if (slice(src, spans[k]!) === word) {
      return [spans[k - 1]![1], spans[k + 1]?.[0] ?? src.length];
    }
  }
  return null;
}

const takesRest = (param: ParameterDef) =>
  param.type === 'expression' ||
  param.type === 'statements' ||
  param.type === 'passage' ||
  param.type === 'text';

/** The text of `src` without the whitespace around it, and where it is. */
function trimmed(src: string, at: number): [text: string, at: number] {
  const text = src.trim();
  return [text, text ? at + src.indexOf(text) : at];
}

/**
 * Read the parameters of one group from `src` (`null`: no text), which is
 * at `at` in the raw arguments, into `args`.
 */
function readGroup(
  params: readonly ParameterDef[],
  src: string | null,
  args: Record<string, unknown>,
  { at: srcAt, spans, toolingSpans }: Place,
): void {
  let [text, at] = trimmed(src ?? '', srcAt);
  // A lone word is the passage of {include inline}, not its flag
  const alone = !params.some((p) => p.type !== 'flag' && p.required);
  for (const flag of params.filter((p) => p.type === 'flag')) {
    const rest = src === null ? null : takeFlag(text, flag.name, alone);
    args[flag.name] = rest !== null;
    if (rest) {
      const flagSpan: Span =
        rest[0] > 0
          ? [0, text.indexOf(flag.name) + flag.name.length]
          : [text.lastIndexOf(flag.name), text.length];
      toolingSpans?.set(flag, [at + flagSpan[0], at + flagSpan[1]]);
      [text, at] = trimmed(slice(text, rest), at + rest[0]);
    }
  }
  const positional = params.filter((p) => p.type !== 'flag');
  if (positional.length === 0) return;

  // The last expression or text parameter, else the last one, reads the rest.
  const lastText = positional.findIndex(
    (p, i) => takesRest(p) && !positional.slice(i + 1).some(takesRest),
  );
  const restIndex = lastText < 0 ? positional.length - 1 : lastText;
  /** Read `param` from the text from `start` to `end`. */
  const read = (param: ParameterDef, [start, end]: Span, tolerant = true) => {
    if (start === end) return unset(param);
    try {
      return readValue(param, text.slice(start, end), {
        at: at + start,
        spans,
        toolingSpans,
      });
    } catch (error) {
      if (toolingSpans && tolerant && error instanceof MacroArgumentError) {
        return undefined;
      }
      throw error;
    }
  };

  // One parameter reads the whole text: no need to split it.
  if (positional.length === 1) {
    args[positional[0]!.name] = read(positional[0]!, [0, text.length]);
    return;
  }

  const parts = terms(text);
  let from = 0;
  let to = parts.length;
  for (const param of positional.slice(0, restIndex)) {
    args[param.name] = from < to ? read(param, parts[from++]!) : unset(param);
  }
  // Optional ones at the end: a term that doesn't have their form (a
  // `string` that isn't quoted) belongs to the rest, as in {meter $hp 100}
  const readTrailing = (param: ParameterDef, span: Span) => {
    try {
      return read(param, span, false);
    } catch (error) {
      if (error instanceof MacroArgumentError) return undefined;
      throw error;
    }
  };
  for (const param of positional.slice(restIndex + 1).reverse()) {
    const value =
      from < to && !endsWithOperator(text.slice(0, parts[to - 1]![0]))
        ? readTrailing(param, parts[to - 1]!)
        : undefined;
    args[param.name] = value ?? unset(param);
    if (value !== undefined) to--;
    // A term it didn't take
    else {
      spans?.delete(param);
      toolingSpans?.delete(param);
    }
  }
  const rest = positional[restIndex]!;
  args[rest.name] =
    from < to ? read(rest, [parts[from]![0], parts[to - 1]![1]]) : unset(rest);
}

/** The duration a timing macro ({repeat}, {type}, {timed}/{next}) waits. */
export const DELAY_PARAMETER = {
  name: 'delay',
  type: 'delay',
  required: true,
} as const;

/**
 * Read `rawArgs` into the declared `parameters` (see above). With `spans`,
 * note there where each argument set was read.
 */
export function parseMacroArgs<const P extends readonly ParameterDef[]>(
  rawArgs: string,
  parameters: P,
  spans?: ArgSpans,
  toolingSpans?: ArgSpans,
): MacroArgs<P> {
  const args: Record<string, unknown> = {};
  // The text after the last separator read, null once one is missing
  let [rest, restAt]: [string | null, number] = trimmed(rawArgs, 0);
  let groupStart = 0;
  parameters.forEach((separator, i) => {
    if (separator.type !== 'separator') return;
    const at =
      rest === null
        ? null
        : findSeparator(rest, separator.name, !!toolingSpans);
    args[separator.name] = at !== null;
    if (at && toolingSpans) {
      const start =
        restAt + at[0] + rest!.slice(at[0], at[1]).indexOf(separator.name);
      toolingSpans.set(separator, [start, start + separator.name.length]);
    }
    const before = at ? rest!.slice(0, at[0]) : rest;
    readGroup(parameters.slice(groupStart, i), before, args, {
      at: restAt,
      spans,
      toolingSpans,
    });
    rest = at ? rest!.slice(at[1]) : null;
    if (at) restAt += at[1];
    groupStart = i + 1;
  });
  readGroup(parameters.slice(groupStart), rest, args, {
    at: restAt,
    spans,
    toolingSpans,
  });
  return args as MacroArgs<P>;
}

/** What a `passage` argument is: a quoted name, or an expression. */
export type PassageTarget =
  { kind: 'name'; name: string } | { kind: 'expression'; expression: string };

/**
 * Read a `passage` argument as written (`{goto "Hall"}`, `{goto $room}`): a
 * string literal is the name JavaScript reads from it (`"\u0048all"` is
 * `Hall`), anything else (a literal that is not well-formed too) an
 * expression, whose value is the name when it
 * runs (see evaluatePassageName).
 */
export function passageTarget(arg: string): PassageTarget {
  const expression = arg.trim();
  const name = stringLiteralValue(expression);
  return name === null
    ? { kind: 'expression', expression }
    : { kind: 'name', name };
}

/**
 * The passage a `passage` argument names (`{goto "Hall"}`, `{goto $room}`):
 * the value of its expression. Throws what evaluating it throws, and if no
 * passage of the story `state` holds has that name, an error naming it and
 * the current passage.
 */
export function evaluatePassageName(
  expr: string | undefined,
  evaluate: (expr: string) => unknown,
  {
    storyData,
    currentPassage,
  }: Pick<StoryState, 'storyData' | 'currentPassage'>,
): string {
  const name = String(evaluate(expr ?? ''));
  if (storyData && !storyData.passages.has(name)) {
    throw noPassageError(name, currentPassage);
  }
  return name;
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

/** A runtime input binding, with UTF-16 spans into the raw arguments. */
export interface BoundVariable extends SourceSpan {
  /** Decoded story-variable root and dot members. */
  name: string;
  path: string[];
  /** Whether the author wrote the optional literal `$` sigil. */
  explicitSigil: boolean;
  /** Editable root spelling, excluding quotes, sigil and dot members. */
  nameStart: number;
  nameEnd: number;
}

/**
 * Read the first term as the runtime's story-variable binding. Quotes are
 * stripped, but this is an identifier path, not a JavaScript string literal:
 * only identifier escapes are decoded. Returns null for a missing binding;
 * throws for rejected namespaces, invalid escapes and reserved path names.
 * The full span excludes quotes and includes the sigil when written.
 */
export function parseBoundVariable(rawArgs: string): BoundVariable | null {
  const term = readBoundVariable(rawArgs);
  if (!term) return null;
  const lead = rawArgs.length - rawArgs.trimStart().length;
  const offsets: number[] = [];
  for (let i = 0; i < term.length; i++) {
    if (term[i] !== '"' && term[i] !== "'") offsets.push(lead + i);
  }
  const firstToken = term.replace(/["']/g, '');
  const unbindable: Record<string, string> = {
    '%': 'transient variables',
    _: 'temporary variables',
    '@': 'locals',
  };
  const kind = unbindable[firstToken.charAt(0)];
  if (kind) {
    throw new Error(`${kind} (${firstToken}) cannot be bound to input macros`);
  }
  const explicitSigil = firstToken.startsWith('$');
  if (!explicitSigil && firstToken.split('.')[0]!.includes('\\')) {
    throw new Error(
      'Escaped binding identifiers require a literal $ story-variable sigil',
    );
  }
  const segments = firstToken
    .replace(/^\$/, '')
    .split('.')
    .map((segment, index) => {
      if (!segment.includes('\\')) return segment;
      if (index > 0) {
        const name = parseMemberIdentifier(segment);
        if (name === null) throw new Error('Invalid bound identifier');
        return name;
      }
      const reference = parseReferencePath(`$${segment}`);
      if (!reference || reference.nested)
        throw new Error('Invalid bound identifier');
      return reference.name;
    });
  if (segments.includes(RESERVED_NAME)) {
    throw new Error(
      `"$${segments.join('.')}" cannot be bound: ${RESERVED_NAME} is reserved`,
    );
  }
  const rootStart = explicitSigil ? 1 : 0;
  const rootEnd = firstToken.indexOf('.', rootStart);
  const nameEnd = rootEnd < 0 ? firstToken.length : rootEnd;
  return {
    name: segments[0]!,
    path: segments.slice(1),
    explicitSigil,
    start: offsets[0] ?? lead,
    end: offsets.length ? offsets[offsets.length - 1]! + 1 : lead,
    nameStart: offsets[rootStart] ?? lead + rootStart,
    nameEnd:
      offsets[nameEnd - 1] === undefined ? lead : offsets[nameEnd - 1]! + 1,
  };
}

/** A consumed argument and its declared parameter, with UTF-16 source offsets. */
export interface MacroArgumentSpan extends SourceSpan {
  /** The original parameter object, including for nested keyword options. */
  parameter: ParameterDef;
  /** Index of the top-level parameter, for signature help. */
  parameterIndex: number;
  /** Indices through nested options, starting at parameterIndex. */
  parameterPath: number[];
}

/**
 * The runtime's argument grouping, tolerant of missing or unclosed strings.
 * Includes quotes, flags, separators and option keywords; offsets are into
 * rawArgs. Absent arguments have no span. Options also have their enclosing
 * parameter span, so consumers can choose the most specific overlapping span.
 * No expressions are evaluated. Parameter identities are preserved.
 */
export function macroArgumentSpans(
  rawArgs: string,
  parameters: readonly ParameterDef[],
): MacroArgumentSpan[] {
  const spans: ArgSpans = new Map();
  parseMacroArgs(rawArgs, parameters, undefined, spans);
  const result: MacroArgumentSpan[] = [];
  const add = (params: readonly ParameterDef[], path: number[]) => {
    params.forEach((parameter, index) => {
      const parameterPath = [...path, index];
      const span = spans.get(parameter);
      if (span)
        result.push({
          parameter,
          parameterIndex: parameterPath[0]!,
          parameterPath,
          start: span[0],
          end: span[1],
        });
      if (parameter.parameters) add(parameter.parameters, parameterPath);
    });
  };
  add(parameters, []);
  return result.sort((a, b) => a.start - b.start || b.end - a.end);
}
