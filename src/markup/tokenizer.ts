import {
  createJsScanCache,
  findCodeEnd,
  type JsScanCache,
  type Sigil,
} from '../js-lexer';
import { isCodeAttribute } from './code-attributes';

/** The namespace a variable reference reads. */
export type VariableScope = 'variable' | 'temporary' | 'local' | 'transient';

/** Variable sigils: story ($), temporary (_), local (@), transient (%). */
export const SIGIL_SCOPES: Readonly<Record<Sigil, VariableScope>> = {
  $: 'variable',
  _: 'temporary',
  '@': 'local',
  '%': 'transient',
};

/** The sigil of each variable scope. */
export const SCOPE_SIGILS = Object.fromEntries(
  Object.entries(SIGIL_SCOPES).map(([sigil, scope]) => [scope, sigil]),
) as Readonly<Record<VariableScope, Sigil>>;

const SIGIL_CHARS: ReadonlySet<string> = new Set(Object.keys(SIGIL_SCOPES));

/** Whether `c` is a variable sigil. */
export function isSigil(c: string | undefined): c is Sigil {
  return c !== undefined && SIGIL_CHARS.has(c);
}

/** The `.class#id` selectors written before a link, variable or macro. */
export interface Selectors {
  className?: string;
  id?: string;
}

/** Copy the selectors set in `from` onto `target`, and return it. */
export function withSelectors<T extends Selectors>(
  target: T,
  from: Selectors,
): T {
  if (from.className) target.className = from.className;
  if (from.id) target.id = from.id;
  return target;
}

/** Where a token is in the input: from `start` up to `end`. */
interface Span {
  start: number;
  end: number;
}

export interface TextToken extends Span {
  type: 'text';
  value: string;
}

export interface LinkToken extends Span, Selectors {
  type: 'link';
  display: string;
  target: string;
}

export interface MacroToken extends Span, Selectors {
  type: 'macro';
  name: string;
  rawArgs: string;
  isClose: boolean;
}

export interface VariableToken extends Span, Selectors {
  type: 'variable';
  name: string;
  scope: VariableScope;
}

export interface ExpressionToken extends Span, Selectors {
  type: 'expression';
  expression: string;
}

export interface HtmlToken extends Span {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  isClose: boolean;
  isSelfClose: boolean;
}

export type Token =
  | TextToken
  | LinkToken
  | MacroToken
  | VariableToken
  | ExpressionToken
  | HtmlToken;

/** Tag name must start with a letter (covers standard and custom elements). */
const VALID_TAG_START = /[a-zA-Z]/;

/** HTML void elements: never have children or a closing tag. */
const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Characters other than a sigil that open an expression after `{`:
 * `{(Math.max($a, 0))}`, `{!$done}`. Other characters that can start an
 * expression (quotes, digits, `[`, `-`) are left out, because braces around
 * them are common as literal text (JSON, regex quantifiers, `{[[link]]}`).
 */
const EXPRESSION_START = new Set(['(', '!']);

/** Macros whose body is JavaScript source, kept verbatim instead of tokenized. */
const RAW_BODY_MACROS = new Set(['do']);

/**
 * Link separators, in the order they are tried, and whether the target
 * comes first: display|target, display->target, target<-display.
 */
const LINK_SEPARATORS: readonly (readonly [string, boolean])[] = [
  ['|', false],
  ['->', false],
  ['<-', true],
];

/**
 * Parse a Twine link interior into display and target.
 * Supports: display|target, display->target, target<-display, plain
 */
function parseLink(inner: string): { display: string; target: string } {
  for (const [separator, targetFirst] of LINK_SEPARATORS) {
    const idx = inner.indexOf(separator);
    if (idx === -1) continue;
    const before = inner.slice(0, idx).trim();
    const after = inner.slice(idx + separator.length).trim();
    return targetFirst
      ? { display: after, target: before }
      : { display: before, target: after };
  }

  // Plain: [[passage]]
  const trimmed = inner.trim();
  return { display: trimmed, target: trimmed };
}

/**
 * Parse a macro opening: extract name and rawArgs.
 * e.g. "set $x = 5" → { name: "set", rawArgs: "$x = 5" }
 * e.g. "/if" → { name: "if", rawArgs: "", isClose: true }
 * e.g. "elseif $x > 3" → { name: "elseif", rawArgs: "$x > 3" }
 */
function parseMacroContent(content: string): {
  name: string;
  rawArgs: string;
  isClose: boolean;
} {
  const trimmed = content.trim();
  const isClose = trimmed.startsWith('/');
  const rest = isClose ? trimmed.slice(1) : trimmed;

  const spaceIdx = rest.search(/\s/);
  if (spaceIdx === -1) {
    return { name: rest, rawArgs: '', isClose };
  }

  return {
    name: rest.slice(0, spaceIdx),
    rawArgs: rest.slice(spaceIdx + 1).trim(),
    isClose,
  };
}

/**
 * Parse CSS selectors: .foo.bar#baz → { className: "foo bar", id: "baz" }
 * Scans .[a-zA-Z0-9_-]+ and #[a-zA-Z0-9_-]+ segments in any order, and one
 * space after them. Returns space-joined class string, last id wins (each
 * left out if empty), and the position after them: `startIdx` if there are
 * none.
 */
function parseSelectors(
  input: string,
  startIdx: number,
): { selectors: Selectors; end: number } {
  const classes: string[] = [];
  let id = '';
  let i = startIdx;

  while (i < input.length && (input[i] === '.' || input[i] === '#')) {
    const prefix = input[i]!;
    i++; // skip the . or #
    let name = '';
    while (i < input.length) {
      if (/[a-zA-Z0-9_-]/.test(input[i]!)) {
        name += input[i];
        i++;
      } else if (input[i] === '{' && isSigil(input[i + 1])) {
        // Consume interpolation: {$var}, {_var}, {@var}, {%var} (with optional dot paths)
        const braceStart = i;
        i += 2; // skip { and prefix
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        if (i < input.length && input[i] === '}') {
          i++; // skip }
          name += input.slice(braceStart, i);
        } else {
          // Not a valid interpolation — stop
          i = braceStart;
          break;
        }
      } else {
        break;
      }
    }
    if (name) {
      if (prefix === '.') {
        classes.push(name);
      } else {
        id = name;
      }
    }
  }

  // Consume the space after the selectors
  if (i > startIdx && input[i] === ' ') i++;
  return {
    selectors: withSelectors<Selectors>(
      {},
      { className: classes.join(' '), id },
    ),
    end: i,
  };
}

/**
 * Parse HTML attributes from a string starting at position j.
 * Returns the attributes and the position after the last attribute.
 */
function parseHtmlAttributes(
  input: string,
  j: number,
  memo: ScanMemo,
): { attributes: Record<string, string>; endIdx: number } {
  const attributes: Record<string, string> = {};
  // As in HTML, the first of attributes with the same (case-insensitive)
  // name wins. Defined as own properties so `__proto__` is kept too.
  const seen = new Set<string>();
  const endIdx = scanAttributes(input, j, memo, (name, value) => {
    const lower = name.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    Object.defineProperty(attributes, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  return { attributes, endIdx };
}

/**
 * Index just past the attributes of a tag that start at `j` (after its
 * name), where its `>` or `/>` goes. Pass the same memo to repeated scans of
 * one input to share their work.
 */
export function scanTagAttributes(
  input: string,
  j: number,
  memo: ScanMemo = createScanMemo(),
): number {
  return scanAttributes(input, j, memo);
}

/**
 * Scan the attributes of a tag from position j, handing each to `add` when
 * given. Returns the position after the last attribute.
 *
 * Where the attributes end depends only on where an attribute starts, so
 * without `add` the result is recorded for every attribute start passed (in
 * `memo.tag`) and a recorded one is used instead of scanning on. An unquoted
 * value takes in a `<`, so in `<a x=<a x=<a x=…` each opener's scan would
 * otherwise run over all the openers after it, taking quadratic time. A tag
 * whose attributes end in its `>` is consumed, so collecting the attributes
 * of those (with `add`, unrecorded) reads each character once.
 */
function scanAttributes(
  input: string,
  j: number,
  memo: ScanMemo,
  add?: (name: string, value: string) => void,
): number {
  const passed: number[] = [];
  while (j < input.length) {
    // Skip whitespace
    while (j < input.length && /\s/.test(input[j]!)) j++;
    if (!add) {
      const known = memo.tag.get(j);
      if (known !== undefined) {
        j = known;
        break;
      }
      passed.push(j);
    }
    // End of tag?
    if (
      j >= input.length ||
      input[j] === '>' ||
      (input[j] === '/' && input[j + 1] === '>')
    )
      break;

    // Read attribute name
    const attrStart = j;
    while (j < input.length && /[a-zA-Z0-9_\-:@]/.test(input[j]!)) j++;
    const attrName = input.slice(attrStart, j);
    if (!attrName) break;

    // Check for = value. HTML allows whitespace on either side of the =
    // (`id = "x"`); whitespace not followed by = ends a boolean attribute.
    let eqIdx = j;
    while (eqIdx < input.length && /\s/.test(input[eqIdx]!)) eqIdx++;
    if (input[eqIdx] === '=') {
      j = eqIdx + 1; // skip =
      while (j < input.length && /\s/.test(input[j]!)) j++;
      if (input[j] === '"' || input[j] === "'") {
        const quote = input[j]!;
        j++; // skip opening quote
        const valStart = j;
        j = scanQuotedValue(input, j, quote, isCodeAttribute(attrName), memo);
        add?.(attrName, input.slice(valStart, j));
        if (j < input.length) j++; // skip closing quote
      } else {
        // Unquoted value, up to whitespace or `>`. It takes in a `<`, so in
        // `<a:=<a:=<a:=…` it holds every tag after it: the last run of such
        // characters found is kept, as each tag's value ends where it does.
        const valStart = j;
        const run = memo.unquoted;
        if (j < run.from || j > run.to) {
          run.from = j;
          while (j < input.length && /[^\s>]/.test(input[j]!)) j++;
          run.to = j;
        }
        j = run.to;
        add?.(attrName, input.slice(valStart, j));
      }
    } else {
      // Boolean attribute
      add?.(attrName, '');
    }
  }
  for (const at of passed) memo.tag.set(at, j);
  return j;
}

/**
 * Index of the quote ending the attribute value that starts at `j`, or the
 * end of the input. A `{…}` interpolation in it is skipped whole, so quotes
 * inside it don't end the value. A code attribute's value is no markup
 * (`isCodeAttribute`): only `{` and a sigil open a reference, other braces
 * and backslashes are text, as `splitSigilTemplate` reads them.
 *
 * The value reads the same from just past an interpolation, however the scan
 * got there, so the end is recorded there (in `memo.value`), and a recorded
 * one is used. An unclosed value that skips interpolations to the end of
 * the input (`<a x="}<a x={<a x="}…`) is then read once, not once per tag.
 */
function scanQuotedValue(
  input: string,
  j: number,
  quote: string,
  code: boolean,
  memo: ScanMemo,
): number {
  const variant = (quote === '"' ? 0 : 2) + (code ? 1 : 0);
  const passed: number[] = [];
  let checkpoint = true;
  while (j < input.length) {
    if (checkpoint) {
      const known = memo.value.get(j * 4 + variant);
      if (known !== undefined) {
        j = known;
        break;
      }
      passed.push(j * 4 + variant);
      checkpoint = false;
    }
    if (!code && input[j] === '\\') {
      // A brace after an odd backslash run is escaped (`\{`) and opens
      // no interpolation, as in passage text.
      let k = j + 1;
      while (input[k] === '\\') k++;
      const brace = input[k] === '{' || input[k] === '}';
      j = brace && (k - j) % 2 === 1 ? k + 1 : k;
      continue;
    }
    if (input[j] === '{') {
      const closeIdx = !code
        ? scanBlockClose(input, j, memo)
        : isSigil(input[j + 1])
          ? scanBalancedBrace(input, j + 1, memo)
          : -1;
      if (closeIdx !== -1) {
        j = closeIdx + 1;
        checkpoint = true;
        continue;
      }
    } else if (input[j] === quote) break;
    j++;
  }
  for (const at of passed) memo.value.set(at, j);
  return j;
}

/**
 * Results of the brace and template scans of one input, shared by repeated
 * scans of it. A scan's result depends only on the input and where it
 * starts, so caching it is exact. Without the cache, each unclosed template
 * literal was scanned once as a template and again as plain text, so nested
 * unclosed ones (`` {$a`${$a`${… ``) took time exponential in their depth;
 * and each unclosed `{` was scanned to the end of the input, so many of them
 * took quadratic time. A memo must only be reused for scans of the same input
 * string.
 */
export interface ScanMemo {
  /** `scanBalancedBrace` results, by lenient start. */
  code: Map<number, number>;
  /** JavaScript lexer results. */
  js: JsScanCache;
  /** Lenient brace scan results. */
  brace: Map<number, number>;
  /** Lenient template literal scan results. */
  template: Map<number, number>;
  /** Lenient template literal scan results, by a point in its text. */
  templateText: Map<number, number>;
  /** The last macro name run found: no whitespace or } in [from, to). */
  name: { from: number; to: number };
  /** The last unquoted attribute value run: no whitespace or > in [from, to). */
  unquoted: { from: number; to: number };
  /** Link scan results (`scanLinkClose`). */
  link: Map<number, number>;
  /** Where the attributes of a tag end, by attribute start (`scanAttributes`). */
  tag: Map<number, number>;
  /** Where quoted attribute values end, by checkpoint (`scanQuotedValue`). */
  value: Map<number, number>;
  /**
   * The last search for a raw-body closer, by macro name: the first one
   * from `from` on is at `at` (-1 for none).
   */
  rawClose: Map<string, { from: number; at: number }>;
}

export function createScanMemo(): ScanMemo {
  return {
    code: new Map(),
    js: createJsScanCache(),
    brace: new Map(),
    template: new Map(),
    templateText: new Map(),
    name: { from: 0, to: -1 },
    unquoted: { from: 0, to: -1 },
    link: new Map(),
    tag: new Map(),
    value: new Map(),
    rawClose: new Map(),
  };
}

/**
 * Find the } closing the code that starts at position i: a `{$…}`
 * expression from its sigil on, an attribute interpolation. The code is
 * lexed as JavaScript, so only a } in code outside the brackets it opened
 * counts — not one in a string, template or regex literal or a comment —
 * and `/` after an operand divides.
 *
 * Text that is not well-formed JavaScript (an apostrophe, an unterminated
 * literal or comment, unbalanced brackets) is scanned leniently instead, as
 * prose-like macro arguments are: braces count except inside string and
 * template literals, and a quote that can't start a string (apostrophe,
 * escaped, not closed on its line) is text.
 *
 * Returns the index of the closing } or -1 if there is none. Pass the same
 * memo to repeated scans of one input to share their work.
 */
export function scanBalancedBrace(
  input: string,
  i: number,
  memo: ScanMemo = createScanMemo(),
): number {
  return scanClose(input, i, i, memo);
}

/**
 * Index of the } closing the macro whose content (name, then arguments)
 * starts at `contentStart`, or -1. The name runs up to whitespace or the }
 * (as `parseMacroContent` reads it); the arguments after it are code. The
 * lenient scan covers the whole content, as it always has.
 */
function scanMacroClose(
  input: string,
  contentStart: number,
  memo: ScanMemo,
): number {
  const run = memo.name;
  if (contentStart < run.from || contentStart > run.to) {
    let k = contentStart;
    while (k < input.length && input[k] !== '}' && !/\s/.test(input[k]!)) k++;
    run.from = contentStart;
    run.to = k;
  }
  return scanClose(input, run.to, contentStart, memo);
}

/**
 * Index of the } closing the `{…}` block opened at `open`, read as passage
 * text reads it: a macro (`{name args}`, `{/name}`) has its arguments lexed
 * after its name, an expression (`{$…}`, `{(…)}`, `{!…}`) from its first
 * character, after any `.class#id` selectors. Any other block is scanned as
 * code from just past the {. Returns -1 if it is unclosed.
 */
function scanBlockClose(input: string, open: number, memo: ScanMemo): number {
  const at = parseSelectors(input, open + 1).end;
  const first = input[at];
  if (first !== undefined && (first === '/' || /[a-zA-Z]/.test(first))) {
    return scanMacroClose(input, at, memo);
  }
  return scanBalancedBrace(input, at, memo);
}

/** Lex the code from `codeStart`, else scan leniently from `lenientStart`. */
function scanClose(
  input: string,
  codeStart: number,
  lenientStart: number,
  memo: ScanMemo,
): number {
  let end = memo.code.get(lenientStart);
  if (end === undefined) {
    end = findCodeEnd(input, codeStart, { cache: memo.js });
    if (end === -1) end = scanBraceLenient(input, lenientStart, memo);
    memo.code.set(lenientStart, end);
  }
  return end;
}

/**
 * Index of the ]] closing the link whose text starts at `from`, or -1. A
 * [[ inside opens a nested pair. Each nested [[ starts a scan that reads the
 * rest the same way, so its result is recorded too: unclosed [[s don't each
 * scan to the end of the input.
 */
function scanLinkClose(input: string, from: number, memo: ScanMemo): number {
  const known = memo.link.get(from);
  if (known !== undefined) return known;
  const opens = [from];
  let i = from;
  while (i < input.length) {
    if (input[i] === '[' && input[i + 1] === '[') {
      i += 2;
      const inner = memo.link.get(i);
      if (inner === undefined) opens.push(i);
      else if (inner === -1)
        break; // nor does this one close
      else i = inner + 2;
    } else if (input[i] === ']' && input[i + 1] === ']') {
      memo.link.set(opens.pop()!, i);
      if (!opens.length) return i;
      i += 2;
    } else {
      i++;
    }
  }
  for (const open of opens) memo.link.set(open, -1);
  return -1;
}

/**
 * Skip a '…' or "…" string literal opening at i.
 * Returns the index just past the closing quote, or -1 if the string is
 * not closed on the same line (JS strings can't span lines unescaped).
 */
function skipQuoted(input: string, i: number): number {
  const quote = input[i];
  let j = i + 1;
  while (j < input.length) {
    const c = input[j];
    if (c === '\\') j += 2;
    else if (c === quote) return j + 1;
    else if (c === '\n') return -1;
    else j++;
  }
  return -1;
}

/**
 * A quote directly after a letter/digit is an apostrophe (don't), not a
 * string; after a backslash it is an escaped attribute delimiter (\").
 */
const NON_STRING_QUOTE_PREFIX = /[\p{L}\p{N}_\\]/u;

/**
 * A brace or template literal scan in progress: braces from `start` (just
 * past a {) to their closing }, or a template literal from its backtick at
 * `start` to the closing one.
 */
interface LenientScan {
  template: boolean;
  start: number;
  /**
   * For braces, per brace depth from the outermost: the checkpoints at that
   * depth whose scans end where the depth does.
   */
  levels: number[][];
  /**
   * For a template literal, the points in its text it passed (just past its
   * backtick, an escape or an interpolation), whose scans end where it does.
   */
  passed?: number[];
}

/**
 * Scan for the balanced closing } starting at position i (just past the {).
 * Braces inside string and template literals are ignored. A quote that
 * can't start a string (apostrophe, escaped, unterminated) counts as text,
 * and so does a backtick without a closing one.
 * Returns the index of the closing } or -1 if unbalanced.
 *
 * Template literals and their ${…} parts are scans on a stack, not
 * recursive calls, so deep nesting can't overflow the call stack. How the
 * text reads depends only on where a scan is, so a scan passing a point —
 * just past a {, a string or a template literal — goes on as a scan
 * starting there would: its result there is recorded too, and a recorded
 * result is used instead of scanning on. Scans from many starts in one
 * input then take about linear time.
 */
function scanBraceLenient(input: string, i: number, memo: ScanMemo): number {
  const known = memo.brace.get(i);
  if (known !== undefined) return known;
  const stack: LenientScan[] = [{ template: false, start: i, levels: [[]] }];
  for (;;) {
    const scan = stack[stack.length - 1]!;
    let end: number | undefined; // set when `scan` is done
    if (scan.template) {
      // Template text reads the same from such a point, however the scan got
      // there: in `` `\`\`\`… `` each backtick a scan from an earlier one
      // reads as escaped starts a template that reads the same rest.
      let point = true;
      while (end === undefined && i < input.length) {
        if (point) {
          const known = memo.templateText.get(i);
          if (known !== undefined) {
            end = known;
            break;
          }
          scan.passed!.push(i);
          point = false;
        }
        const c = input[i];
        if (c === '\\') {
          i += 2;
          point = true;
        } else if (c === '`') {
          end = i + 1;
        } else if (c === '$' && input[i + 1] === '{') {
          const inner = memo.brace.get(i + 2);
          if (inner === undefined) break; // scan the ${…} first
          if (inner === -1) end = -1;
          else {
            i = inner + 1;
            point = true;
          }
        } else {
          i++;
        }
      }
      if (end === undefined && i < input.length) {
        stack.push({ template: false, start: i + 2, levels: [[]] });
        i += 2;
        continue;
      }
      end ??= -1;
    } else {
      const { levels } = scan;
      /** The } at `close` ends the innermost level. */
      const closeLevel = (close: number) => {
        for (const at of levels.pop()!) memo.brace.set(at, close);
        if (!levels.length) end = close;
      };
      while (end === undefined && i < input.length) {
        const c = input[i]!;
        let at = -1; // a checkpoint, if one starts here
        if (c === '{') {
          levels.push([]);
          at = ++i;
        } else if (c === '}') {
          closeLevel(i++);
        } else if (
          (c === '"' || c === "'") &&
          !(i > 0 && NON_STRING_QUOTE_PREFIX.test(input[i - 1]!))
        ) {
          const close = skipQuoted(input, i);
          if (close === -1) i++;
          else at = i = close;
        } else if (c === '`') {
          const close = memo.template.get(i);
          if (close === undefined) break; // scan the template first
          if (close === -1) i++;
          else at = i = close;
        } else {
          i++;
        }
        if (at === -1) continue;
        const known = memo.brace.get(at);
        if (known === undefined) {
          levels[levels.length - 1]!.push(at);
        } else if (known === -1) {
          // The innermost level never closes, so neither do the others
          i = input.length;
        } else {
          closeLevel(known);
          i = known + 1;
        }
      }
      if (end === undefined && i < input.length) {
        stack.push({ template: true, start: i, levels: [], passed: [] });
        i++;
        continue;
      }
      if (end === undefined) {
        end = -1;
        for (const level of levels) {
          for (const at of level) memo.brace.set(at, -1);
        }
      }
    }
    // `scan` is done: hand its result to the scan that started it
    stack.pop();
    (scan.template ? memo.template : memo.brace).set(scan.start, end);
    for (const at of scan.passed ?? []) memo.templateText.set(at, end);
    const parent = stack[stack.length - 1];
    if (!parent) return end;
    if (parent.template) {
      // An unclosed ${…} leaves the template unclosed: go on to its end
      i = end === -1 ? input.length : end + 1;
    } else {
      // An unclosed template's backtick is text
      i = end === -1 ? scan.start + 1 : end;
    }
  }
}

/**
 * Options for {@link tokenize}.
 */
export interface TokenizeOptions {
  /**
   * Text mode, for markup that becomes a string (HTML attribute values,
   * macro labels): only `{…}` markup and brace escapes are recognized, while
   * `[[` and `<` are text. With no markdown to pair up the backslashes of a
   * run before a brace, they are paired up here: `\\{` is one backslash
   * before a live brace, `\\\{` one before a literal one.
   */
  text?: boolean;
}

/**
 * Single-pass tokenizer for Twine passage content.
 * Recognizes: [[links]], {$variable}, {_temporary}, {macroName args}
 */
export function tokenize(
  input: string,
  options: TokenizeOptions = {},
): Token[] {
  const textMode = options.text === true;
  const tokens: Token[] = [];
  const memo = createScanMemo();
  let i = 0;
  let textStart = 0;

  /** Push a text token for the text not yet tokenized before `end`. */
  function flushText(end: number) {
    if (end > textStart) {
      tokens.push({
        type: 'text',
        value: input.slice(textStart, end),
        start: textStart,
        end,
      });
      textStart = end;
    }
  }

  /** Push `token` and go on after it. */
  function emit(token: Token) {
    tokens.push(token);
    i = textStart = token.end;
  }

  /**
   * After an opening raw-body macro ({do}), emit everything up to its
   * {/name} as a single text token so JavaScript source is not parsed as
   * markup. The body is lexed as JavaScript statements: a {/do} in code ends
   * it, one inside a string, template or regex literal or a comment does
   * not. If the body is not well-formed JavaScript up to a {/do} in code,
   * the first {/do} ends it. Without a closer, nothing is consumed and the
   * AST builder reports it.
   */
  function consumeRawBody(name: string, isClose: boolean) {
    const lower = name.toLowerCase();
    if (isClose || !RAW_BODY_MACROS.has(lower)) return;
    const closer = `\\{/${lower}\\s*\\}`;
    // The first closer from here on. Without one from `from` on there is
    // none later either, so many unclosed {do}s don't each search the rest.
    let last = memo.rawClose.get(lower);
    if (!last || i < last.from || (last.at >= 0 && i > last.at)) {
      const firstRe = new RegExp(closer, 'gi');
      firstRe.lastIndex = i;
      last = { from: i, at: firstRe.exec(input)?.index ?? -1 };
      memo.rawClose.set(lower, last);
    }
    const first = last.at;
    if (first === -1) return;
    const atRe = new RegExp(closer, 'iy');
    const closerAt = (k: number) => {
      atRe.lastIndex = k;
      return atRe.test(input);
    };
    let closeStart = findCodeEnd(input, i, {
      goal: 'statements',
      stop: closerAt,
      stopKey: lower,
      cache: memo.js,
    });
    if (closeStart === -1) closeStart = first;
    atRe.lastIndex = closeStart;
    const closeEnd = closeStart + atRe.exec(input)![0].length;
    flushText(closeStart);
    emit({
      type: 'macro',
      ...parseMacroContent(input.slice(closeStart + 1, closeEnd - 1)),
      start: closeStart,
      end: closeEnd,
    });
  }

  /**
   * Push an expression token for the `{…}` block opened at `start` whose
   * expression starts at `exprStart`, flushing the text before it first.
   * Returns false, consuming nothing, if the block is unclosed.
   */
  function pushExpression(
    exprStart: number,
    start: number,
    selectors: Selectors,
  ): boolean {
    const closeIdx = scanBalancedBrace(input, exprStart, memo);
    if (closeIdx === -1) return false;
    flushText(start);
    emit(
      withSelectors<ExpressionToken>(
        {
          type: 'expression',
          expression: input.slice(exprStart, closeIdx),
          start,
          end: closeIdx + 1,
        },
        selectors,
      ),
    );
    return true;
  }

  /**
   * Push a variable token for the `{…}` block opened at `start` whose sigil
   * is at `sigilAt`: `{$name}`, `{_name.field.subfield}`. Anything else
   * after the name makes the block an expression from the sigil on
   * (`{$expr[...]}`). Returns false, consuming nothing, if it is unclosed.
   */
  function pushVariable(
    sigilAt: number,
    start: number,
    selectors: Selectors,
  ): boolean {
    let nameEnd = sigilAt + 1;
    while (nameEnd < input.length && /[\w.]/.test(input[nameEnd]!)) nameEnd++;
    if (input[nameEnd] !== '}') {
      // Complex expression — scan for balanced closing }
      return pushExpression(sigilAt, start, selectors);
    }
    emit(
      withSelectors<VariableToken>(
        {
          type: 'variable',
          name: input.slice(sigilAt + 1, nameEnd),
          scope: SIGIL_SCOPES[input[sigilAt] as Sigil],
          start,
          end: nameEnd + 1,
        },
        selectors,
      ),
    );
    return true;
  }

  /**
   * Push a macro token for the `{…}` block opened at `start` whose content
   * (name, then arguments) starts at `contentStart`, then consume the body
   * of a raw-body macro. Returns false, consuming nothing, if the block is
   * unclosed.
   */
  function pushMacro(
    contentStart: number,
    start: number,
    selectors: Selectors,
  ): boolean {
    // Scan to closing }, tracking brace nesting (object literals)
    // and string literals
    const closeIdx = scanMacroClose(input, contentStart, memo);
    if (closeIdx === -1) return false;
    const token = withSelectors<MacroToken>(
      {
        type: 'macro',
        ...parseMacroContent(input.slice(contentStart, closeIdx)),
        start,
        end: closeIdx + 1,
      },
      selectors,
    );
    emit(token);
    consumeRawBody(token.name, token.isClose);
    return true;
  }

  while (i < input.length) {
    // Escaped braces: \{ and \}. Count the whole backslash run so \\{ is a
    // backslash pair before a live brace. In an odd run the last backslash
    // escapes the brace; the even rest stays text, which markdown collapses
    // pair by pair like any other \\ in the passage.
    if (input[i] === '\\') {
      let k = i + 1;
      while (input[k] === '\\') k++;
      const next = input[k];
      if (textMode && (next === '{' || next === '}')) {
        const escaped = (k - i) % 2 === 1;
        const end = escaped ? k + 1 : k;
        const value = '\\'.repeat((k - i) >> 1) + (escaped ? next : '');
        flushText(i);
        if (value) tokens.push({ type: 'text', value, start: i, end });
        i = textStart = end;
        continue;
      }
      if ((next === '{' || next === '}') && (k - i) % 2 === 1) {
        flushText(k - 1);
        emit({ type: 'text', value: next, start: k - 1, end: k + 1 });
        continue;
      }
      i = k;
      continue;
    }

    // Check for [[ link, with optional .class or #id syntax after [[
    if (!textMode && input[i] === '[' && input[i + 1] === '[') {
      flushText(i);
      const start = i;
      const { selectors, end: innerStart } = parseSelectors(input, i + 2);

      // Find closing ]]
      const closeIdx = scanLinkClose(input, innerStart, memo);
      if (closeIdx === -1) {
        // Unclosed link — treat as text
        i = start + 2;
        continue;
      }

      emit(
        withSelectors<LinkToken>(
          {
            type: 'link',
            ...parseLink(input.slice(innerStart, closeIdx)),
            start,
            end: closeIdx + 2, // skip ]]
          },
          selectors,
        ),
      );
      continue;
    }

    // Check for { — variable, expression or macro, with an optional
    // .class/#id prefix: {.foo#bar $var} or {#id.foo macroName ...}
    if (input[i] === '{') {
      const start = i;
      const { selectors, end: at } = parseSelectors(input, i + 1);
      const prefixed = at > i + 1;
      // The text before a selector prefix ends there, whatever follows it
      if (prefixed) flushText(start);
      const c = input[at];

      if (isSigil(c)) {
        // {$variable.field} or {_temporary} or {@local} or {%expr[...]}
        flushText(start);
        if (pushVariable(at, start, selectors)) continue;
      } else if (EXPRESSION_START.has(c!)) {
        // {(expr)} or {!expr}: an expression that doesn't start with a variable
        if (pushExpression(at, start, selectors)) continue;
      } else if (
        c !== undefined &&
        (/[a-zA-Z]/.test(c) || (c === '/' && !prefixed))
      ) {
        // {macro ...} or {/macro}; a closing tag takes no selectors
        flushText(start);
        if (pushMacro(at, start, selectors)) continue;
      }

      // Unclosed, or a bare { — treat as regular text
      i = start + 1;
      continue;
    }

    // Check for < — HTML tag
    if (!textMode && input[i] === '<') {
      const start = i;
      let j = i + 1;

      // Closing tag?
      const isClose = input[j] === '/';
      if (isClose) j++;

      // Read tag name (letters, digits, hyphens for custom elements)
      const tagStart = j;
      while (j < input.length && /[a-zA-Z0-9-]/.test(input[j]!)) j++;
      const tag = input.slice(tagStart, j);
      const tagLower = tag.toLowerCase();

      // Valid tag name must start with a letter
      if (tag && VALID_TAG_START.test(tag[0]!)) {
        if (isClose) {
          // Closing tag: skip whitespace, expect >
          while (j < input.length && /\s/.test(input[j]!)) j++;
          if (input[j] === '>') {
            j++;
            flushText(start);
            if (HTML_VOID_TAGS.has(tagLower)) {
              // Void elements never take a closer; drop a redundant </input>
              i = textStart = j;
              continue;
            }
            emit({
              type: 'html',
              tag,
              attributes: {},
              isClose: true,
              isSelfClose: false,
              start,
              end: j,
            });
            continue;
          }
        } else {
          // Opening or self-closing tag: find where its attributes end, and
          // read them only if the tag closes there
          const attrsStart = j;
          j = scanAttributes(input, attrsStart, memo);

          let isSelfClose = HTML_VOID_TAGS.has(tagLower);
          if (input[j] === '/') {
            isSelfClose = true;
            j++;
          }

          if (input[j] === '>') {
            j++;
            flushText(start);
            emit({
              type: 'html',
              tag,
              attributes: parseHtmlAttributes(input, attrsStart, memo)
                .attributes,
              isClose: false,
              isSelfClose,
              start,
              end: j,
            });
            continue;
          }
        }
      }

      // Not a valid HTML tag — treat as text
      i++;
      continue;
    }

    i++;
  }

  flushText(input.length);
  return tokens;
}
