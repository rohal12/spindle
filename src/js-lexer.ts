/**
 * Lexical scanner for the JavaScript in expressions and macro arguments.
 *
 * It is the one place that knows where string, template and regex literals
 * and comments begin and end. The expression transformer (`expression.ts`)
 * and the macro argument splitters (`components/macros/arg-utils.ts`) both
 * walk source text through `lexJs` and differ only in what they do with the
 * pieces it reports. The passage tokenizer (`markup/tokenizer.ts`) and
 * attribute interpolation (`interpolation.ts`) find where the code in a
 * `{…}` ends with `findCodeEnd`.
 *
 * It also finds the sigil variable references in code: `$name`, `_name` and
 * `@name` where an identifier starts — not inside `a$b` or `ñ_x`, and not
 * where a property name stands: after `.`, as an object literal key or a
 * class member name — and `%name`.
 *
 * Besides literals, the scanner tracks whether the next token is an operand
 * or an operator, which decides two ambiguities: `/` opens a regex in operand
 * position and divides otherwise, and `%name` is a transient reference in
 * operand position while `%` after an operand — `($n)%3`, `$a[i] %2`,
 * `_i++ %n` — is the modulo operator. For that it tells blocks from object
 * literals: `}` closing a block may be followed by a statement, `}` closing
 * an object literal by an operator.
 */

/** The sigil of a variable reference: story, temporary, local, transient. */
export type Sigil = '$' | '_' | '@' | '%';

export interface JsLexHandlers {
  /**
   * One character of code, outside literals and comments. `nesting` is the
   * number of template-literal `${…}` interpolations around it (0 at top
   * level).
   */
  code?(ch: string, index: number, nesting: number): void;
  /**
   * Literal text passed through verbatim: a string or regex literal, a
   * comment, or a piece of a template literal (its backticks, text, escapes
   * and the `${` / `}` delimiters around interpolations, whose code is
   * reported through `code`).
   */
  literal?(text: string, index: number, nesting: number): void;
  /**
   * A sigil variable reference — `$name`, `_name`, `@name` or `%name` —
   * covering the sigil and `name`.
   */
  variable?(sigil: Sigil, name: string, index: number, nesting: number): void;
}

/**
 * What the source is: one expression (a macro argument, an `evaluate`d
 * expression) or a list of statements (the body of `execute`).
 */
export type JsGoal = 'expression' | 'statements';

/** Transient name after `%`: an identifier, so `%3` is never a reference. */
const TRANS_NAME_RE = /[A-Za-z_]\w*/y;
/** An assignment operator: `=`, `+=`, `??=`, … but not `==` or `=>`. */
const ASSIGN_OP_RE = /(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/y;
/** Flags after the closing `/` of a regex literal. */
const REGEX_FLAGS_RE = /\w*/y;
/**
 * Characters of identifiers (with the `\u…` escapes they may contain) and
 * numbers. Surrogates stand for the astral identifier characters they encode.
 */
const WORD_CHAR_RE = /[\p{ID_Continue}$\u200c\u200d\\\ud800-\udfff]/u;
/** An identifier, or the rest of one after a `$`, `_` or `@` sigil. */
const IDENT_RE = /[\p{ID_Continue}$\u200c\u200d]*/uy;
/** A sigil variable name: the whole identifier after the sigil. */
const VAR_NAME_RE = /^\w+$/;
/** What may start a property name after a `get`, `set`, … modifier. */
const KEY_START_RE = /[\p{ID_Continue}$\\"'[*#]/u;
const SPACE_RE = /\s/;
const LINE_TERMINATOR_RE = /[\n\r\u2028\u2029]/;
const LINE_TERMINATOR_G = /[\n\r\u2028\u2029]/g;
/**
 * Keywords followed by an operand rather than an operator (a declaration's
 * binding counts as one: `const of of xs`, `let { _a: x } = o`).
 */
const OPERAND_KEYWORDS = new Set([
  'await',
  'case',
  'const',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'let',
  'new',
  'return',
  'throw',
  'typeof',
  'var',
  'void',
  'yield',
]);
/** Keywords whose parenthesised header is followed by a statement. */
const HEADER_KEYWORDS = new Set(['for', 'if', 'while', 'with']);
/** Keywords that a line break ends the statement after. */
const RESTRICTED_KEYWORDS = new Set(['break', 'continue', 'return']);
/** Words that may precede a property name in an object literal or class. */
const MODIFIERS = new Set(['async', 'get', 'set', 'static']);

/**
 * Scan the `"…"` or `'…'` string literal opening at `start`. `end` is the
 * index just past its closing quote, or `src.length` when it is unterminated
 * (`closed` false). A backslash escapes the character after it, so a quote
 * after an even run of backslashes closes the string and one after an odd
 * run does not.
 */
export function scanStringLiteral(
  src: string,
  start: number,
): { end: number; closed: boolean } {
  const quote = src.charAt(start);
  let i = start + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') i += 2;
    else if (c === quote) return { end: i + 1, closed: true };
    else i++;
  }
  return { end: src.length, closed: false };
}

/**
 * Scan the regex literal (with flags) opening at `start`. `end` is the index
 * just past it; an unterminated one (`closed` false) ends at the line break
 * (escaped or not) or the end of the source.
 */
function scanRegex(
  src: string,
  start: number,
  cache?: JsScanCache,
): { end: number; closed: boolean } {
  let i = start + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') {
      if (LINE_TERMINATOR_RE.test(src.charAt(i + 1))) break;
      i += 2;
      continue;
    }
    // Unterminated at the end of the line: leave the rest to the parser
    if (LINE_TERMINATOR_RE.test(c)) return { end: i, closed: false };
    if (c === '[') {
      // A class, where `/` does not close
      i = scanRegexClass(src, i, cache);
      if (src.charAt(i) !== ']') return { end: i, closed: false };
    } else if (c === '/') {
      REGEX_FLAGS_RE.lastIndex = i + 1;
      const flags = REGEX_FLAGS_RE.exec(src)?.[0].length ?? 0;
      return { end: i + 1 + flags, closed: true };
    }
    i++;
  }
  return { end: Math.min(i + 1, src.length), closed: false };
}

/**
 * Index of the `]` closing the regex character class opening at `open`, or
 * of the line break (or the end of the source) that leaves it unterminated.
 * Every `[` in a class reads the rest of it the same way, so the result is
 * recorded for them too: scans of `/[/[/[…` from each `/` share one pass.
 */
function scanRegexClass(
  src: string,
  open: number,
  cache?: JsScanCache,
): number {
  const known = cache?.classes.get(open);
  if (known !== undefined) return known;
  const opens = [open];
  let i = open + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') {
      if (LINE_TERMINATOR_RE.test(src.charAt(i + 1))) {
        i++;
        break;
      }
      i += 2;
      continue;
    }
    if (c === ']' || LINE_TERMINATOR_RE.test(c)) break;
    if (c === '[' && cache) opens.push(i);
    i++;
  }
  i = Math.min(i, src.length);
  if (cache) for (const o of opens) cache.classes.set(o, i);
  return i;
}

/**
 * The next index from `from` on where `find` matches (-1 for none), for
 * searches from increasing positions: a search from within the stretch the
 * last one covered has the same answer.
 */
function nextMatch(
  memo: NextMatch | undefined,
  from: number,
  find: (from: number) => number,
): number {
  if (memo && from >= memo.from && (memo.at < 0 || from <= memo.at)) {
    return memo.at;
  }
  const at = find(from);
  if (memo) {
    memo.from = from;
    memo.at = at;
  }
  return at;
}

/** A search memo for `nextMatch`. */
interface NextMatch {
  from: number;
  at: number;
}

/**
 * Index just past the comment opening at `start` (`//` or `/*`), or -1 for
 * an unterminated `/*` comment.
 */
function findCommentEnd(
  src: string,
  start: number,
  cache?: JsScanCache,
): number {
  if (src.charAt(start + 1) === '/') {
    const end = nextLineBreak(src, start, cache);
    return end < 0 ? src.length : end;
  }
  const end = nextMatch(cache?.commentClose, start + 2, (from) =>
    src.indexOf('*/', from),
  );
  return end < 0 ? -1 : end + 2;
}

/** Next line break from `from` on (-1 for none). */
function nextLineBreak(src: string, from: number, cache?: JsScanCache): number {
  return nextMatch(cache?.lineEnd, from, (at) => {
    LINE_TERMINATOR_G.lastIndex = at;
    return LINE_TERMINATOR_G.exec(src)?.index ?? -1;
  });
}

/** Is there a line break between `from` and `to`? */
function lineBreakIn(
  src: string,
  from: number,
  to: number,
  cache?: JsScanCache,
): boolean {
  if (!cache) return LINE_TERMINATOR_RE.test(src.slice(from, to));
  const at = nextLineBreak(src, from, cache);
  return at >= 0 && at < to;
}

/** Index just past the comment opening at `start` (`//` or `/*`). */
function skipComment(src: string, start: number): number {
  const end = findCommentEnd(src, start);
  return end < 0 ? src.length : end;
}

/** Index of the first character from `i` on that is no space or comment. */
function skipTrivia(src: string, i: number): number {
  while (i < src.length) {
    const c = src.charAt(i);
    if (SPACE_RE.test(c)) i++;
    else if (c === '/' && '/*'.includes(src.charAt(i + 1)))
      i = skipComment(src, i);
    else break;
  }
  return i;
}

/**
 * Lex the template literal opening at `start` (a backtick): its backticks,
 * text and escapes are reported as literal text and the code of its `${…}`
 * interpolations as `lexJs` does, one nesting level deeper. Returns the index
 * just past the closing backtick, or `src.length` if it is unterminated.
 */
export function lexTemplate(
  src: string,
  start: number,
  handlers: JsLexHandlers = {},
  nesting = 0,
): number {
  handlers.literal?.('`', start, nesting);
  const outer = frame('template', '`', start);
  return scan(src, handlers, start + 1, nesting, outer, newContext());
}

/**
 * State shared by the scans of one source: the main scan and the look-ahead
 * scans that find where a bracketed assignment target ends.
 */
interface ScanContext {
  /**
   * Look ahead after a `%name` starting a line for an assignment. Off in
   * look-ahead scans, which only need to match brackets — and whose own
   * look-ahead could rescan the same text over and over.
   */
  lookahead: boolean;
  /**
   * Index of the `]` matching the `[` at an index (`src.length` if there is
   * none), as found by look-ahead scans: each text is scanned ahead once.
   */
  brackets: Map<number, number>;
  /** Set for `findCodeEnd`: the scan stops at the first lexical error. */
  strict?: StrictScan;
}

interface StrictScan {
  /** Stop at a `{` in code for which this holds. */
  stop?: (index: number) => boolean;
  /** The scan ran into a lexical error. */
  malformed: boolean;
  /** The scan stopped where `stop` held. */
  stopped: boolean;
  /** Results shared with other scans of the source. */
  cache?: JsScanCache;
  /** `cache.braces`, unless the scan has a `stop`. */
  braces?: Map<number, number>;
  /** `cache.statements` for this scan's `stopKey`. */
  checkpoints?: Map<number, number>;
  /** Checkpoints this scan passed, to record its result at. */
  passed: number[];
}

/** A `{…}` frame result: it is still open at the end of the source. */
const UNCLOSED = -1;
/** A `{…}` frame result: a lexical error inside it ends the scan. */
const MALFORMED = -2;
const BRACE_KINDS: readonly Frame['kind'][] = ['block', 'object', 'class'];

/** Key of a `{…}` frame result: where it opens and what it holds. */
const braceKey = (f: Frame) => f.open * 3 + BRACE_KINDS.indexOf(f.kind);

/**
 * Results that `findCodeEnd` scans of one source share, so that scanning it
 * from many starts doesn't lex the same code over and over.
 */
export interface JsScanCache {
  /**
   * Where each `{…}` frame closes: the index of its `}`, `UNCLOSED` or
   * `MALFORMED`. The code inside a frame lexes the same whatever surrounds
   * it, given where it opens and its kind (block, object literal or class
   * body) — a stray `)` or `]` inside never closes it — so a later scan
   * entering the same frame skips to its end.
   */
  braces: Map<number, number>;
  /** Look-ahead bracket matches (`ScanContext.brackets`). */
  brackets: Map<number, number>;
  /** Regex character class ends (`scanRegexClass`). */
  classes: Map<number, number>;
  /** The last search for a line break ending a `//` comment. */
  lineEnd: NextMatch;
  /** The last search for the end of a block comment. */
  commentClose: NextMatch;
  /**
   * Statement scans with a `stop`, by `stopKey`: how a scan goes on from a
   * point at the top level just past a `}`, by the point and the scan state
   * there. Scans from different starts soon pass such points in the same
   * state (a statement scan starts in one, past the `}` of `{do}`), and
   * from there on go the same way.
   */
  statements: Map<string, Map<number, number>>;
}

export function createJsScanCache(): JsScanCache {
  return {
    statements: new Map(),
    braces: new Map(),
    brackets: new Map(),
    classes: new Map(),
    lineEnd: { from: Infinity, at: -1 },
    commentClose: { from: Infinity, at: -1 },
  };
}

const newContext = (): ScanContext => ({
  lookahead: true,
  brackets: new Map(),
});

/** Index of the `]` matching the `[` at `open`, or `src.length`. */
function matchBracket(src: string, open: number, ctx: ScanContext): number {
  let close = ctx.brackets.get(open);
  if (close === undefined) {
    const ahead = { lookahead: false, brackets: ctx.brackets };
    close = scan(src, {}, open + 1, 0, frame('expr', ']', open), ahead);
    ctx.brackets.set(open, close);
  }
  return close;
}

/**
 * Is the code at `i`, just past a `%name`, the rest of an assignment target
 * and its operator: ` = 1`, `.a[b] += 2`, but not `== 1`, `=> 1` or `% 2`?
 */
function assignmentFollows(src: string, i: number, ctx: ScanContext): boolean {
  for (;;) {
    i = skipTrivia(src, i);
    const c = src.charAt(i);
    if (c === '.' && src.charAt(i + 1) !== '.') {
      IDENT_RE.lastIndex = skipTrivia(src, i + 1);
      const name = IDENT_RE.exec(src)?.[0];
      if (!name) return false;
      i = IDENT_RE.lastIndex;
    } else if (c === '[') {
      i = matchBracket(src, i, ctx);
      if (i >= src.length) return false;
      i++;
    } else {
      break;
    }
  }
  ASSIGN_OP_RE.lastIndex = i;
  return ASSIGN_OP_RE.test(src);
}

/**
 * The code between a pair of brackets, or the whole source.
 *
 * - `block`: statements (a block, a function body, the whole source as
 *   statements),
 * - `object`: the property definitions of an object literal,
 * - `class`: the member definitions of a class body,
 * - `expr`: an expression (parentheses, square brackets, a template literal
 *   interpolation, the whole source as an expression),
 * - `template`: the text of a template literal.
 */
interface Frame {
  kind: 'block' | 'object' | 'class' | 'expr' | 'template';
  /** The character closing it, or '' for the whole source. */
  closer: string;
  /** Index of its opening bracket. */
  open: number;
  /** A parenthesised `if`/`for`/`while`/`with` header: a statement follows. */
  header: boolean;
  /** Its closing `}` ends an operand (object literal, function expression). */
  operand: boolean;
  /** Conditional-expression `?`s awaiting their `:`. */
  ternary: number;
  /** A template literal's `${…}` interpolation. */
  interpolation: boolean;
}

function frame(kind: Frame['kind'], closer: string, open = -1): Frame {
  return {
    kind,
    closer,
    open,
    header: false,
    operand: false,
    ternary: 0,
    interpolation: false,
  };
}

/**
 * Walk `src`, reporting code characters, literal text and variable
 * references to `handlers` in source order. Every character is reported
 * exactly once (a variable reference covers its sigil and name). Returns
 * `src.length`.
 */
export function lexJs(
  src: string,
  handlers: JsLexHandlers,
  goal: JsGoal = 'expression',
): number {
  const outer = frame(goal === 'statements' ? 'block' : 'expr', '');
  return scan(src, handlers, 0, 0, outer, newContext());
}

export interface FindCodeEndOptions {
  /** What the code is (default `expression`). */
  goal?: JsGoal;
  /** End the code at a `{` in code, at any depth, for which this holds. */
  stop?: (index: number) => boolean;
  /**
   * Names `stop` for `cache`: statement scans with the same key share
   * results.
   */
  stopKey?: string;
  /**
   * Results to share with other scans of the same source. Scanning a source
   * from n starts then takes about linear time instead of n scans of the
   * rest of it.
   */
  cache?: JsScanCache;
}

/**
 * Find where the code starting at `start` ends, lexing it as JavaScript:
 * braces, quotes and backticks inside string, template and regex literals and
 * comments don't count.
 *
 * Without `stop`, the code ends at the first `}` in code outside the
 * brackets it opened (the `}` closing a `{…}` around it); with `stop`, at
 * the first `{` in code, at any depth, for which `stop` holds. Returns the
 * index of that `}` or `{`.
 *
 * Returns -1 when there is no such end, or when the code before it is not
 * well-formed JavaScript as far as a lexer can tell: an unterminated string,
 * regex literal or block comment, or a quote directly after an identifier or
 * number (`don't`, but not `typeof'x'`). Callers fall back to a more lenient
 * reading there, so text that only looks like code is not swallowed by an
 * apostrophe or a stray quote.
 */
export function findCodeEnd(
  src: string,
  start: number,
  { goal = 'expression', stop, stopKey, cache }: FindCodeEndOptions = {},
): number {
  const strict: StrictScan = {
    stop,
    malformed: false,
    stopped: false,
    passed: [],
  };
  strict.cache = cache;
  // Where a `{…}` frame ends depends on `stop`
  if (cache && !stop) strict.braces = cache.braces;
  if (cache && stop && stopKey !== undefined && goal === 'statements') {
    let checkpoints = cache.statements.get(stopKey);
    if (!checkpoints) cache.statements.set(stopKey, (checkpoints = new Map()));
    strict.checkpoints = checkpoints;
  }
  const ctx: ScanContext = {
    lookahead: true,
    brackets: cache?.brackets ?? new Map(),
    strict,
  };
  const kind = goal === 'statements' ? 'block' : 'expr';
  const outer = frame(kind, stop ? '' : '}', start - 1);
  const end = scan(src, {}, start, 0, outer, ctx);
  if (strict.checkpoints) {
    const result = strict.malformed
      ? MALFORMED
      : strict.stopped
        ? end
        : UNCLOSED;
    for (const at of strict.passed) strict.checkpoints.set(at, result);
  }
  if (strict.malformed) return -1;
  if (stop) return strict.stopped ? end : -1;
  return end < src.length ? end : -1;
}

/**
 * Scan from `start` within `outer`. Returns `src.length`, or the index of
 * the `]` closing an `outer` square bracket, or the index just past the
 * backtick closing an `outer` template literal.
 *
 * Nested brackets, template literals and their interpolations are frames
 * on a stack, not recursive calls: however deep the nesting, the scan
 * cannot overflow the call stack.
 */
function scan(
  src: string,
  handlers: JsLexHandlers,
  start: number,
  nesting: number,
  outer: Frame,
  ctx: ScanContext,
): number {
  const frames: Frame[] = [outer];
  const top = () => frames[frames.length - 1]!;
  /**
   * Indices of the open frames closed by `)`, `]` and `}` (above `outer`),
   * innermost last: the frame a closer closes is found without walking the
   * stack.
   */
  const closers: Record<string, number[]> = { ')': [], ']': [], '}': [] };
  const innermost = (c: string) => {
    const list = closers[c]!;
    return list.length ? list[list.length - 1]! : 0;
  };
  let i = start;

  let operandNext = true; // an operand (not an operator) comes next
  let stmtNext = outer.kind === 'block'; // a statement starts here
  let arrowBody = false; // an arrow function body starts here
  let keyNext = false; // a property name may come next
  let word = ''; // identifier/number currently being read
  let afterDot = false; // the next word is a property name, never a keyword
  let dots = 0; // length of the current run of `.` tokens
  let afterHeaderKeyword = false; // last token was if/while/for/with
  let lastPunct = '';
  let lastKeyword = ''; // the last token, if it was a keyword
  let lineBreak = false; // a line break since the last token
  /** The next `{` at this depth opens a function or class body. */
  let pendingBody: { depth: number; frame: Frame } | undefined;

  const strict = ctx.strict;
  const braces = strict?.braces;
  /** A `{…}` frame result found in `braces`, to skip to. */
  let skipTo: { frame: Frame; end: number } | undefined;

  /** Record how the open `{…}` frames end, when the scan ends in them. */
  function recordOpen(result: number) {
    if (!braces) return;
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k]!;
      if (f.closer === '}' && !f.interpolation) {
        braces.set(braceKey(f), result);
      }
    }
  }

  /** End a strict scan at a lexical error. */
  const malformed = () => {
    recordOpen(MALFORMED);
    strict!.malformed = true;
    return src.length;
  };

  function push(f: Frame) {
    closers[f.closer]?.push(frames.length);
    frames.push(f);
  }

  /**
   * At the top level, just past a `}` in code: the key of the position and
   * the scan state there, which decide how the scan goes on (or undefined
   * elsewhere). Past a `}` no word is being read, the last token is no
   * keyword and no `=` or `.`, and no line break follows it yet; what is
   * left is what may come next, a pending function or class body, and open
   * conditionals.
   */
  function checkpointKey(): number | undefined {
    const ternary = frames[0]!.ternary;
    if (frames.length !== 1 || src.charAt(i - 1) !== '}' || ternary > 3) {
      return undefined;
    }
    let state = ternary;
    if (operandNext) state |= 4;
    if (stmtNext) state |= 8;
    if (keyNext) state |= 16;
    if (pendingBody) {
      state |= pendingBody.frame.kind === 'class' ? 32 : 64;
      if (pendingBody.frame.operand) state |= 128;
    }
    return i * 256 + state;
  }

  /**
   * May a string literal follow the word just read (`word`, or a variable
   * reference) with nothing between? Only after a keyword taking an operand
   * (`typeof'x'`, `case"a"`), `of` in a `for` header, or a modifier before a
   * property name (`static'x'`, `get"y"() {}`); elsewhere the quote is an
   * apostrophe (`don't`), and the text is no JavaScript.
   */
  function stringMayFollowWord(): boolean {
    return (
      OPERAND_KEYWORDS.has(word) ||
      (word === 'of' && top().header) ||
      (keyNext && MODIFIERS.has(word))
    );
  }

  /** Close the frames from index `k` on. */
  function truncate(k: number) {
    frames.length = k;
    for (const list of Object.values(closers)) {
      while (list.length && list[list.length - 1]! >= k) list.pop();
    }
    // A function or class body can't follow once its level is closed
    if (pendingBody && pendingBody.depth > k) pendingBody = undefined;
  }

  const code = (ch: string, index: number) =>
    handlers.code?.(ch, index, nesting);
  const literal = (text: string, index: number) =>
    handlers.literal?.(text, index, nesting);
  /** Literal text from `from` to `to`, sliced only for a handler. */
  const literalSpan = (from: number, to: number) =>
    handlers.literal?.(src.slice(from, to), from, nesting);

  /** Track the word just read (`i` is the index just past it). */
  function endWord() {
    if (!word) return;
    // A property name is never a keyword: `a.return`, `{ in: 1 }`
    const keyword = afterDot || keyNext ? '' : word;
    const inOperandPosition = operandNext && !stmtNext;
    operandNext =
      OPERAND_KEYWORDS.has(keyword) ||
      // `for (x of …)`, but `of` is an identifier where an operand goes
      (keyword === 'of' && top().header && !operandNext);
    afterHeaderKeyword = HEADER_KEYWORDS.has(keyword);
    if (keyword === 'function' || keyword === 'class') {
      // An expression where an operand is expected, else a declaration: at
      // a statement start, or after an operand and a line break (ASI)
      const body = frame(keyword === 'class' ? 'class' : 'block', '}');
      body.operand = inOperandPosition;
      pendingBody = { depth: frames.length, frame: body };
    }
    // `get name()`, `static _x = 1`: the property name is still to come
    keyNext =
      keyNext &&
      MODIFIERS.has(word) &&
      KEY_START_RE.test(src.charAt(skipTrivia(src, i)));
    stmtNext =
      keyword === 'else' ||
      keyword === 'do' ||
      (keyword === 'async' && stmtNext);
    arrowBody = false;
    afterDot = false;
    lastPunct = '';
    lastKeyword = keyword;
    lineBreak = false;
    word = '';
  }

  /** A string, template or regex literal, or a variable reference, ended. */
  function endOperand() {
    endWord();
    operandNext = false;
    stmtNext = false;
    arrowBody = false;
    keyNext = false;
    afterHeaderKeyword = false;
    afterDot = false;
    lastPunct = '';
    lastKeyword = '';
    lineBreak = false;
  }

  /** Track an operator token: `operandNext` tells what may follow it. */
  function endPunct(punct: string, nextIsOperand: boolean) {
    operandNext = nextIsOperand;
    stmtNext = false;
    arrowBody = false;
    keyNext = false;
    afterDot = punct === '.' && !nextIsOperand;
    afterHeaderKeyword = false;
    lastPunct = punct;
    lastKeyword = '';
    lineBreak = false;
  }

  /**
   * A line break between tokens. After `return`, `break` or `continue` it
   * ends the statement (ASI): `return⏎function f() {}` declares `f`.
   */
  function lineBreakSeen() {
    lineBreak = true;
    if (RESTRICTED_KEYWORDS.has(lastKeyword)) {
      operandNext = true;
      stmtNext = true;
      lastKeyword = '';
    }
  }

  function open(f: Frame) {
    push(f);
    stmtNext = f.kind === 'block';
    keyNext = f.kind === 'object' || f.kind === 'class';
  }

  function openBrace() {
    let f: Frame;
    if (pendingBody?.depth === frames.length) {
      f = pendingBody.frame;
      pendingBody = undefined;
    } else if (!operandNext || stmtNext || arrowBody) {
      f = frame('block', '}');
    } else {
      f = frame('object', '}');
      f.operand = true;
    }
    f.open = i;
    endPunct('{', true);
    const end = braces?.get(braceKey(f));
    if (end === undefined) open(f);
    else skipTo = { frame: f, end };
  }

  /** State after the `}` closing `closed`, a block or literal. */
  function afterBrace(closed: Frame) {
    if (closed.operand) {
      endPunct('}', false);
    } else {
      // A block: a statement (or the next class member) may follow
      endPunct('}', true);
      stmtNext = top().kind === 'block';
      keyNext = top().kind === 'class';
    }
  }

  /**
   * Close the innermost frame that `c` closes; a stray closer, with no such
   * frame within the innermost braces (a block, an object literal, a class
   * body or an interpolation), is ignored. So a stray `)` or `]` never
   * closes the braces around it, and how a `{…}` ends depends only on the
   * code inside it.
   */
  function close(c: string) {
    const k = Math.max(innermost(c), innermost('}'));
    if (k === 0 || frames[k]!.closer !== c) {
      endPunct(c, c === '}');
      return;
    }
    const closed = frames[k]!;
    truncate(k);
    if (c === ']' && !ctx.lookahead) ctx.brackets.set(closed.open, i);
    if (c === ')') {
      // `if (…) %x = 1` vs `($n)%3`
      endPunct(c, closed.header);
      stmtNext = closed.header;
    } else if (c === ']') {
      endPunct(c, false);
    } else {
      braces?.set(braceKey(closed), i);
      afterBrace(closed);
    }
  }

  function trackCode(c: string) {
    if (WORD_CHAR_RE.test(c)) {
      word += c;
      return;
    }
    endWord();
    // A line break alone never changes operand/operator position:
    // `$x = 5\n%n` continues the expression, as in JavaScript.
    if (LINE_TERMINATOR_RE.test(c)) lineBreakSeen();
    if (SPACE_RE.test(c)) return;
    const t = top();
    switch (c) {
      case '(': {
        const f = frame('expr', ')');
        f.header = afterHeaderKeyword;
        endPunct(c, true);
        open(f);
        break;
      }
      case '[':
        endPunct(c, true);
        open(frame('expr', ']', i));
        break;
      case '{':
        openBrace();
        break;
      case ')':
      case ']':
      case '}':
        close(c);
        break;
      case '.':
        // Property access, unless it is the spread `...`
        dots = lastPunct === '.' ? dots + 1 : 1;
        endPunct(c, dots === 3);
        break;
      case ';':
        endPunct(c, true);
        stmtNext = t.kind === 'block';
        keyNext = t.kind === 'class';
        break;
      case ',':
        endPunct(c, true);
        keyNext = t.kind === 'object';
        break;
      case '?':
        endPunct(c, true);
        t.ternary++;
        break;
      case ':':
        endPunct(c, true);
        // Not a conditional's `:`: an object literal value, or a statement
        // after a `case`, `default` or label
        if (t.ternary > 0) t.ternary--;
        else stmtNext = t.kind === 'block';
        break;
      case '#':
        // A private name: `this.#_x`
        endPunct(c, false);
        afterDot = true;
        break;
      case '*': {
        // A generator method: `{ *_gen() {} }`
        const key = keyNext;
        endPunct(c, true);
        keyNext = key;
        break;
      }
      case '>': {
        // `=>`: the body may be a block
        const arrow = lastPunct === '=';
        endPunct(c, true);
        arrowBody = arrow;
        break;
      }
      default:
        endPunct(c, true);
    }
  }

  while (i < src.length) {
    const ch = src.charAt(i);

    // At the top level just past a `}`: go on as a scan that passed here in
    // the same state did
    const checkpoints = strict?.checkpoints;
    const key = checkpoints && checkpointKey();
    if (key !== undefined) {
      const known = checkpoints!.get(key);
      if (known === undefined) {
        strict!.passed.push(key);
      } else if (known === MALFORMED) {
        return malformed();
      } else if (known === UNCLOSED) {
        i = src.length;
        break;
      } else {
        strict!.stopped = true;
        return known;
      }
    }

    // Template literal text: escapes, the closing backtick, interpolations
    if (top().kind === 'template') {
      if (ch === '\\') {
        literal(src.slice(i, i + 2), i);
        i += 2;
      } else if (ch === '`') {
        literal(ch, i);
        i++;
        if (frames.length === 1) return i; // the end of `lexTemplate`
        truncate(frames.length - 1);
        endOperand();
      } else if (ch === '$' && src.charAt(i + 1) === '{') {
        literal('${', i);
        const f = frame('expr', '}', i);
        f.interpolation = true;
        i += 2;
        nesting++;
        endPunct('{', true);
        open(f);
      } else {
        literal(ch, i);
        i++;
      }
      continue;
    }

    // String literal — skip entirely
    if (ch === '"' || ch === "'") {
      if (strict && i > start && WORD_CHAR_RE.test(src.charAt(i - 1))) {
        if (!stringMayFollowWord()) return malformed();
      }
      endWord();
      const { end, closed } = scanStringLiteral(src, i);
      if (strict && !closed) return malformed();
      literalSpan(i, end);
      i = end;
      endOperand();
      continue;
    }

    if (ch === '`') {
      endWord();
      literal(ch, i);
      push(frame('template', '`', i));
      i++;
      continue;
    }

    if (ch === '{' && strict?.stop?.(i)) {
      strict.stopped = true;
      return i;
    }

    // End of a template literal interpolation: the innermost `}` closer
    if (ch === '}') {
      const k = innermost('}');
      if (frames[k]!.interpolation) {
        endWord();
        truncate(k);
        nesting--;
        literal(ch, i);
        i++;
        continue;
      }
    }

    if (ch === '/') {
      endWord();
      const next = src.charAt(i + 1);
      // Comment — skip entirely; it is not a token
      if (next === '/' || next === '*') {
        let end = findCommentEnd(src, i, strict?.cache);
        if (end < 0) {
          if (strict) return malformed();
          end = src.length;
        }
        literalSpan(i, end);
        if (next === '*' && lineBreakIn(src, i, end, strict?.cache)) {
          lineBreakSeen();
        }
        i = end;
        continue;
      }
      // Regex literal — only where an operand is expected
      if (operandNext) {
        const { end, closed } = scanRegex(src, i, strict?.cache);
        if (strict && !closed) return malformed();
        literalSpan(i, end);
        i = end;
        endOperand();
        continue;
      }
    }

    // In a class body, a line break after a complete member starts the next
    // one (ASI): `_x = 1⏎_y = 2`, but `_x = a⏎instanceof B` continues it.
    if (!word && lineBreak && !operandNext && top().kind === 'class') {
      IDENT_RE.lastIndex = i;
      const next = IDENT_RE.exec(src)?.[0];
      if (next && next !== 'in' && next !== 'instanceof') keyNext = true;
    }

    // `$name`, `_name` or `@name` reference where an identifier starts (`@`
    // is no identifier character, so `typeof@x` holds one). The whole
    // identifier must be the sigil and a name: `$a$b` and `$café` are
    // identifiers of their own.
    if (ch === '@' || ((ch === '$' || ch === '_') && !word)) {
      endWord();
      IDENT_RE.lastIndex = i + 1;
      const name = IDENT_RE.exec(src)?.[0] ?? '';
      if (VAR_NAME_RE.test(name) && !isPropertyName(ch, i + 1 + name.length)) {
        handlers.variable?.(ch, name, i, nesting);
        i += 1 + name.length;
        endOperand();
        continue;
      }
    }

    // Transient reference — where an operand is expected, or as the target
    // of an assignment starting a line: `$x = 5\n%a = 1` would otherwise be
    // the invalid assignment `5 % a = 1`.
    if (ch === '%') {
      endWord();
      TRANS_NAME_RE.lastIndex = i + 1;
      const name = TRANS_NAME_RE.exec(src)?.[0];
      if (name) {
        const end = i + 1 + name.length;
        if (
          operandNext ||
          (lineBreak && ctx.lookahead && assignmentFollows(src, end, ctx))
        ) {
          handlers.variable?.('%', name, i, nesting);
          i = end;
          endOperand();
          continue;
        }
      }
    }

    // Increment/decrement: postfix after an operand on the same line (no line
    // break may precede postfix `++`), prefix otherwise.
    if ((ch === '+' || ch === '-') && src.charAt(i + 1) === ch) {
      endWord();
      const postfix = !operandNext && !lineBreak;
      code(ch, i);
      code(ch, i + 1);
      i += 2;
      endPunct(ch, !postfix);
      continue;
    }

    // `??` and optional chaining `?.` (but `a?.5:1` is a conditional)
    if (ch === '?') {
      const next = src.charAt(i + 1);
      if (next === '?' || (next === '.' && !/\d/.test(src.charAt(i + 2)))) {
        endWord();
        code(ch, i);
        code(next, i + 1);
        i += 2;
        dots = 1;
        endPunct(next, next === '?');
        continue;
      }
    }

    // End of an `outer` square bracket
    if (ch === outer.closer && frames.length === 1) break;

    // Regular code character
    trackCode(ch);
    if (skipTo) {
      // A `{…}` frame an earlier scan lexed: continue after it
      const { frame: skipped, end } = skipTo;
      skipTo = undefined;
      if (end === MALFORMED) return malformed();
      if (end === UNCLOSED) {
        i = src.length;
        break;
      }
      i = end;
      afterBrace(skipped);
      i++;
      continue;
    }
    code(ch, i);
    i++;
  }
  if (i >= src.length) recordOpen(UNCLOSED);
  if (!ctx.lookahead) {
    // Brackets left open here close at `i`: the end of `outer` or of `src`
    for (const f of frames) if (f.closer === ']') ctx.brackets.set(f.open, i);
  }
  return Math.min(i, src.length);

  /**
   * Is the `$`/`_` word ending at `end` a property name: after `.`, a key
   * in an object literal (`{ _id: 1 }`, `{ _m() {} }`) or a member name in
   * a class body?
   */
  function isPropertyName(sigil: string, end: number): boolean {
    if (afterDot) return true;
    if (!keyNext || sigil === '@') return false;
    if (top().kind === 'class') return true;
    const next = src.charAt(skipTrivia(src, end));
    return next === ':' || next === '(';
  }
}
