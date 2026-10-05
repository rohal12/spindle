import { createJsScanCache, findCodeEnd, type JsScanCache } from '../js-lexer';
import { isCodeAttribute } from './code-attributes';

export interface TextToken {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

export interface LinkToken {
  type: 'link';
  display: string;
  target: string;
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface MacroToken {
  type: 'macro';
  name: string;
  rawArgs: string;
  isClose: boolean;
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface VariableToken {
  type: 'variable';
  name: string;
  scope: 'variable' | 'temporary' | 'local' | 'transient';
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface ExpressionToken {
  type: 'expression';
  expression: string;
  className?: string;
  id?: string;
  start: number;
  end: number;
}

export interface HtmlToken {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  isClose: boolean;
  isSelfClose: boolean;
  start: number;
  end: number;
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

/** Variable sigils: story ($), temporary (_), local (@), transient (%). */
const SIGIL_CHARS = new Set(['$', '_', '@', '%']);

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
 * Parse a Twine link interior into display and target.
 * Supports: display|target, display->target, target<-display, plain
 */
function parseLink(inner: string): { display: string; target: string } {
  // Pipe syntax: display|target
  const pipeIdx = inner.indexOf('|');
  if (pipeIdx !== -1) {
    return {
      display: inner.slice(0, pipeIdx).trim(),
      target: inner.slice(pipeIdx + 1).trim(),
    };
  }

  // Arrow syntax: display->target
  const arrowIdx = inner.indexOf('->');
  if (arrowIdx !== -1) {
    return {
      display: inner.slice(0, arrowIdx).trim(),
      target: inner.slice(arrowIdx + 2).trim(),
    };
  }

  // Reverse arrow: target<-display
  const revIdx = inner.indexOf('<-');
  if (revIdx !== -1) {
    return {
      target: inner.slice(0, revIdx).trim(),
      display: inner.slice(revIdx + 2).trim(),
    };
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
 * Scans .[a-zA-Z0-9_-]+ and #[a-zA-Z0-9_-]+ segments in any order.
 * Returns space-joined class string, last id wins, and position after last segment.
 */
function parseSelectors(
  input: string,
  startIdx: number,
): { className: string; id: string; endIdx: number } {
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
      } else if (input[i] === '{' && SIGIL_CHARS.has(input[i + 1]!)) {
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

  return { className: classes.join(' '), id, endIdx: i };
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
        // A code attribute's value is no markup (`isCodeAttribute`): only
        // `{` and a sigil open a reference, other braces and backslashes
        // are text, as `splitSigilTemplate` reads them.
        const code = isCodeAttribute(attrName);
        while (j < input.length) {
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
            // Skip a whole {…} interpolation so quotes inside it don't end the value
            const closeIdx = !code
              ? scanBlockClose(input, j, memo)
              : SIGIL_CHARS.has(input[j + 1]!)
                ? scanBalancedBrace(input, j + 1, memo)
                : -1;
            if (closeIdx !== -1) {
              j = closeIdx + 1;
              continue;
            }
          } else if (input[j] === quote) break;
          j++;
        }
        add?.(attrName, input.slice(valStart, j));
        if (j < input.length) j++; // skip closing quote
      } else {
        // Unquoted value
        const valStart = j;
        while (j < input.length && /[^\s>]/.test(input[j]!)) j++;
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
  /** The last macro name run found: no whitespace or } in [from, to). */
  name: { from: number; to: number };
  /** Link scan results (`scanLinkClose`). */
  link: Map<number, number>;
  /** Where the attributes of a tag end, by attribute start (`scanAttributes`). */
  tag: Map<number, number>;
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
    name: { from: 0, to: -1 },
    link: new Map(),
    tag: new Map(),
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
  let at = open + 1;
  const c = input[at];
  if (c === '.' || c === '#') {
    at = parseSelectors(input, at).endIdx;
    if (input[at] === ' ') at++;
  }
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
      while (end === undefined && i < input.length) {
        const c = input[i];
        if (c === '\\') {
          i += 2;
        } else if (c === '`') {
          end = i + 1;
        } else if (c === '$' && input[i + 1] === '{') {
          const inner = memo.brace.get(i + 2);
          if (inner === undefined) break; // scan the ${…} first
          if (inner === -1) end = -1;
          else i = inner + 1;
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
        stack.push({ template: true, start: i, levels: [] });
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

  function flushText(end: number) {
    if (end > textStart) {
      tokens.push({
        type: 'text',
        value: input.slice(textStart, end),
        start: textStart,
        end,
      });
    }
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
    tokens.push({
      type: 'macro',
      ...parseMacroContent(input.slice(closeStart + 1, closeEnd - 1)),
      start: closeStart,
      end: closeEnd,
    });
    i = closeEnd;
    textStart = closeEnd;
  }

  /**
   * Push an expression token for the `{…}` block opened at `start` whose
   * expression starts at `exprStart`, flushing the text before it first
   * when `flush`. Returns false, consuming nothing, if the block is unclosed.
   */
  function pushExpression(
    exprStart: number,
    start: number,
    flush: boolean,
    className?: string,
    id?: string,
  ): boolean {
    const closeIdx = scanBalancedBrace(input, exprStart, memo);
    if (closeIdx === -1) return false;
    if (flush) flushText(start);
    const token: ExpressionToken = {
      type: 'expression',
      expression: input.slice(exprStart, closeIdx),
      start,
      end: closeIdx + 1,
    };
    if (className) token.className = className;
    if (id) token.id = id;
    tokens.push(token);
    i = textStart = closeIdx + 1;
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
        tokens.push({ type: 'text', value: next, start: k - 1, end: k + 1 });
        i = k + 1;
        textStart = i;
        continue;
      }
      i = k;
      continue;
    }

    // Check for [[ link
    if (!textMode && input[i] === '[' && input[i + 1] === '[') {
      flushText(i);
      const start = i;
      i += 2;

      // Check for .class or #id syntax after [[
      let className: string | undefined;
      let id: string | undefined;
      if (input[i] === '.' || input[i] === '#') {
        const parsed = parseSelectors(input, i);
        className = parsed.className || undefined;
        id = parsed.id || undefined;
        i = parsed.endIdx;
        // Consume trailing space after selectors
        if (input[i] === ' ') i++;
      }

      // Find closing ]]
      const innerStart = i;
      const closeIdx = scanLinkClose(input, innerStart, memo);

      if (closeIdx === -1) {
        // Unclosed link — treat as text
        i = start + 2;
        textStart = start;
        continue;
      }

      const inner = input.slice(innerStart, closeIdx);
      i = closeIdx + 2; // skip ]]

      const { display, target } = parseLink(inner);
      const linkToken: LinkToken = {
        type: 'link',
        display,
        target,
        start,
        end: i,
      };
      if (className) linkToken.className = className;
      if (id) linkToken.id = id;
      tokens.push(linkToken);
      textStart = i;
      continue;
    }

    // Check for { — macro or variable (with optional .class prefix)
    if (input[i] === '{') {
      const start = i;
      let nextChar = input[i + 1];

      // Check for .class/#id prefix: {.foo#bar $var} or {#id.foo macroName ...}
      let className: string | undefined;
      let id: string | undefined;
      if (nextChar === '.' || nextChar === '#') {
        flushText(i);
        const parsed = parseSelectors(input, i + 1);
        className = parsed.className || undefined;
        id = parsed.id || undefined;
        // After selectors, check what follows (space then $ or _ or letter)
        let afterSelectors = parsed.endIdx;
        if (input[afterSelectors] === ' ') afterSelectors++;
        const charAfter = input[afterSelectors];

        if (charAfter === '$') {
          // {.class#id $variable.field} or {.class $expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'variable',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx$ = scanBalancedBrace(input, nameStart - 1, memo);
          if (closeIdx$ !== -1) {
            const expression = input.slice(afterSelectors, closeIdx$);
            i = closeIdx$ + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === '_') {
          // {.class#id _temporary.field} or {.class _expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'temporary',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx_ = scanBalancedBrace(input, nameStart - 1, memo);
          if (closeIdx_ !== -1) {
            const expression = input.slice(afterSelectors, closeIdx_);
            i = closeIdx_ + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === '@') {
          // {.class#id @local.field} or {.class @expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'local',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx_at = scanBalancedBrace(input, nameStart - 1, memo);
          if (closeIdx_at !== -1) {
            const expression = input.slice(afterSelectors, closeIdx_at);
            i = closeIdx_at + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (charAfter === '%') {
          // {.class#id %transient.field} or {.class %expr[...]}
          i = afterSelectors + 1;
          const nameStart = i;
          while (i < input.length && /[\w.]/.test(input[i]!)) i++;
          const name = input.slice(nameStart, i);

          if (input[i] === '}') {
            i++; // skip }
            const token: VariableToken = {
              type: 'variable',
              name,
              scope: 'transient',
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Complex expression — scan for balanced closing }
          const closeIdx_pct = scanBalancedBrace(input, nameStart - 1, memo);
          if (closeIdx_pct !== -1) {
            const expression = input.slice(afterSelectors, closeIdx_pct);
            i = closeIdx_pct + 1;
            const token: ExpressionToken = {
              type: 'expression',
              expression,
              start,
              end: i,
            };
            if (className) token.className = className;
            if (id) token.id = id;
            tokens.push(token);
            textStart = i;
            continue;
          }
          // Unbalanced — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        if (
          EXPRESSION_START.has(charAfter!) &&
          pushExpression(afterSelectors, start, false, className, id)
        ) {
          continue;
        }

        if (charAfter !== undefined && /[a-zA-Z]/.test(charAfter)) {
          // {.class#id macroName args}
          // Scan to closing }, tracking brace nesting and string literals
          const contentStart = afterSelectors;
          const closeIdx = scanMacroClose(input, contentStart, memo);

          if (closeIdx === -1) {
            i = start + 1;
            textStart = start;
            continue;
          }

          const content = input.slice(contentStart, closeIdx);
          i = closeIdx + 1; // skip closing }

          const { name, rawArgs, isClose } = parseMacroContent(content);
          const token: MacroToken = {
            type: 'macro',
            name,
            rawArgs,
            isClose,
            start,
            end: i,
          };
          if (className) token.className = className;
          if (id) token.id = id;
          tokens.push(token);
          textStart = i;
          consumeRawBody(name, isClose);
          continue;
        }

        // Selector prefix after { but nothing valid follows — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {$variable} or {$variable.field.subfield} or {$expr[...]}
      if (nextChar === '$') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'variable',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart - 1, memo);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {_temporary.field} or {_expr[...]}
      if (nextChar === '_') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'temporary',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart - 1, memo);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {@local.field} or {@expr[...]}
      if (nextChar === '@') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'local',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart - 1, memo);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {%transient.field} or {%expr[...]}
      if (nextChar === '%') {
        flushText(i);
        i += 2;
        const nameStart = i;
        while (i < input.length && /[\w.]/.test(input[i]!)) i++;
        const name = input.slice(nameStart, i);

        if (input[i] === '}') {
          i++; // skip }
          tokens.push({
            type: 'variable',
            name,
            scope: 'transient',
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Complex expression — scan for balanced closing }
        const closeIdx = scanBalancedBrace(input, nameStart - 1, memo);
        if (closeIdx !== -1) {
          const expression = input.slice(start + 1, closeIdx);
          i = closeIdx + 1;
          tokens.push({
            type: 'expression',
            expression,
            start,
            end: i,
          });
          textStart = i;
          continue;
        }
        // Unbalanced — treat as text
        i = start + 1;
        textStart = start;
        continue;
      }

      // {(expr)} or {!expr}: an expression that doesn't start with a variable
      if (EXPRESSION_START.has(nextChar!)) {
        if (pushExpression(i + 1, start, true)) continue;
        i++;
        continue;
      }

      // {macro ...} or {/macro} — but not bare { that's just text
      // Must start with a letter or /
      if (
        nextChar !== undefined &&
        (nextChar === '/' || /[a-zA-Z]/.test(nextChar))
      ) {
        flushText(i);

        // Scan to closing }, tracking brace nesting (object literals)
        // and string literals
        const contentStart = i + 1;
        const closeIdx = scanMacroClose(input, contentStart, memo);

        if (closeIdx === -1) {
          // Unclosed macro — treat as text
          i = start + 1;
          textStart = start;
          continue;
        }

        const content = input.slice(contentStart, closeIdx);
        i = closeIdx + 1; // skip closing }

        const { name, rawArgs, isClose } = parseMacroContent(content);
        tokens.push({
          type: 'macro',
          name,
          rawArgs,
          isClose,
          start,
          end: i,
        });
        textStart = i;
        consumeRawBody(name, isClose);
        continue;
      }

      // Just a bare { — treat as regular text
      i++;
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
              textStart = j;
              i = j;
              continue;
            }
            tokens.push({
              type: 'html',
              tag,
              attributes: {},
              isClose: true,
              isSelfClose: false,
              start,
              end: j,
            });
            textStart = j;
            i = j;
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
            tokens.push({
              type: 'html',
              tag,
              attributes: parseHtmlAttributes(input, attrsStart, memo)
                .attributes,
              isClose: false,
              isSelfClose,
              start,
              end: j,
            });
            textStart = j;
            i = j;
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
