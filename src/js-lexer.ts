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
  // The rest of a regex reads the same from just past a class, however the
  // scan got there: record how it ends there, and use what is recorded
  const pending: number[] = [];
  const done = (end: number, closed: boolean) => {
    if (cache) {
      for (const at of pending) cache.regexes.set(at, end * 2 + +closed);
    }
    return { end, closed };
  };
  let i = start + 1;
  while (i < src.length) {
    // Unterminated at the end of the line: leave the rest to the parser
    const lineEnd = regexLineEnd(src, i);
    if (lineEnd !== -1) return done(lineEnd, false);
    const c = src.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') {
      // A class, where `/` does not close
      i = scanRegexClass(src, i, cache);
      if (src.charAt(i) !== ']') return done(i, false);
      i++;
      const known = cache?.regexes.get(i);
      if (known !== undefined)
        return done(Math.floor(known / 2), known % 2 === 1);
      pending.push(i);
      continue;
    }
    if (c === '/') {
      REGEX_FLAGS_RE.lastIndex = i + 1;
      const flags = REGEX_FLAGS_RE.exec(src)?.[0].length ?? 0;
      return done(i + 1 + flags, true);
    }
    i++;
  }
  return done(src.length, false);
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
    const lineEnd = regexLineEnd(src, i);
    if (lineEnd !== -1) {
      i = lineEnd;
      break;
    }
    const c = src.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === ']') break;
    if (c === '[' && cache) opens.push(i);
    i++;
  }
  i = Math.min(i, src.length);
  if (cache) for (const o of opens) cache.classes.set(o, i);
  return i;
}

/**
 * Index of the line break at `i`, escaped (`\` then a line break) or not,
 * where a regex literal or class ends unterminated; -1 if there is none.
 */
function regexLineEnd(src: string, i: number): number {
  const c = src.charAt(i);
  if (LINE_TERMINATOR_RE.test(c)) return i;
  if (c === '\\' && LINE_TERMINATOR_RE.test(src.charAt(i + 1))) return i + 1;
  return -1;
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
  /** `cache.checkpoints` for this kind of scan. */
  checkpoints?: Map<CheckpointKey, number>;
  /** `cache.parens` for this kind of scan. */
  parens?: Map<number, number>;
  /** Checkpoints this scan passed, to record its result at. */
  passed: CheckpointKey[];
}

/** Characters that a scan checkpoint follows (`checkpointKey`). */
const CHECKPOINT_AFTER = new Set([
  '}',
  '"',
  "'",
  '`',
  '/',
  '\n',
  '\r',
  '\u2028',
  '\u2029',
  ' ',
  '\t',
]);

/**
 * How far into a scan its results start to be shared within brackets
 * (`checkpointKey`, `knownParen`). Most scans end sooner, so they don't pay
 * for recording results no other scan will use; a long one pays this much
 * before it can use what earlier scans recorded, which keeps scans from
 * many starts about linear.
 */
const SHARE_AFTER = 256;

/**
 * A scan checkpoint: a position and the scan state there (`checkpointKey`).
 * A number at the top level, a string within brackets.
 */
type CheckpointKey = number | string;

/** A frame result: it is still open at the end of the source. */
const UNCLOSED = -1;
/** A frame result: a lexical error inside it ends the scan. */
const MALFORMED = -2;
/** A frame result: the scan stops at index `s` inside it (`STOPPED - s`). */
const STOPPED = -3;

/**
 * The result of a frame that closes at `end`. `bodyStarted`: the code inside
 * started a function or class body. That body replaced the one to come, and
 * is gone once the frame is closed, so after the frame no body is to come —
 * a scan that skips the frame must know, as must the frames around it.
 */
const frameEnd = (end: number, bodyStarted: boolean) => end * 2 + +bodyStarted;

/** The closers whose search for their frame a frame result may depend on. */
const CLOSERS = [')', ']', '}'] as const;
const FRAME_KINDS: readonly Frame['kind'][] = [
  'block',
  'object',
  'class',
  'template',
];

/**
 * Key of a frame result, for the frames whose code lexes the same whatever
 * surrounds them: braces (a block, an object literal, a class body), a
 * template literal and its interpolations. Undefined for parentheses and
 * square brackets, which a stray closer inside may close.
 */
function frameKey(f: Frame): number | undefined {
  const kind = f.interpolation ? 4 : FRAME_KINDS.indexOf(f.kind);
  return kind < 0 ? undefined : f.open * 5 + kind;
}

/**
 * Results that `findCodeEnd` scans of one source share, so that scanning it
 * from many starts doesn't lex the same code over and over.
 */
export interface JsScanCache {
  /**
   * Where each `{…}` frame, template literal or `${…}` interpolation closes,
   * as a frame result (`frameEnd`): its `}` or closing backtick, and whether
   * the code inside started a function or class body; or `UNCLOSED` or
   * `MALFORMED`. The code inside such a frame lexes the same whatever
   * surrounds it, given where it opens and its kind — a stray `)` or `]`
   * inside never closes it — so a later scan entering the same frame skips
   * to its end.
   */
  braces: Map<number, number>;
  /** Look-ahead bracket matches (`ScanContext.brackets`). */
  brackets: Map<number, number>;
  /** Regex character class ends (`scanRegexClass`). */
  classes: Map<number, number>;
  /** How a regex goes on from just past a class: `end * 2 + closed`. */
  regexes: Map<number, number>;
  /** The last search for a line break ending a `//` comment. */
  lineEnd: NextMatch;
  /** The last search for the end of a block comment. */
  commentClose: NextMatch;
  /**
   * How scans go on from points, by the kind of scan (its goal and how it
   * ends) and then by the point and the scan state there, the brackets open
   * around it included: the index the scan ends at, `UNCLOSED` or
   * `MALFORMED`. The points are where no word is being read (see
   * `checkpointKey`). Scans from different starts soon pass such points in
   * the same state, and from there on go the same way.
   */
  checkpoints: Map<string, Map<CheckpointKey, number>>;
  /**
   * Ids of the stacks of open brackets that checkpoints have seen (see
   * `scan`), by the id of the stack below the innermost bracket, the state
   * of that one and the innermost bracket.
   */
  stacks: Map<string, number>;
  /**
   * How `(…)` and `[…]` frames end, by the kind of scan and then by the frame
   * (`parenKey`): a frame result (`frameEnd`), or `UNCLOSED`, `MALFORMED` or
   * `STOPPED - s`. Unlike braces, a stray closer inside may close a frame
   * around them, so the code inside lexes the same only around frames for
   * which the closers it met find nothing to close; the key says which
   * closers met none.
   */
  parens: Map<string, Map<number, number>>;
  /**
   * How far into a scan its results start to be shared within brackets
   * (`SHARE_AFTER`; tests set 0 to share them all).
   */
  shareAfter: number;
}

export function createJsScanCache(): JsScanCache {
  return {
    checkpoints: new Map(),
    stacks: new Map(),
    parens: new Map(),
    shareAfter: SHARE_AFTER,
    braces: new Map(),
    brackets: new Map(),
    classes: new Map(),
    regexes: new Map(),
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
   * Names `stop` for `cache`: scans with the same key share results (scans
   * with a `stop` but no key don't use `cache.checkpoints`).
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
  if (cache && (!stop || stopKey !== undefined)) {
    const kindKey = `${goal} ${stop ? `stop ${stopKey}` : '}'}`;
    let checkpoints = cache.checkpoints.get(kindKey);
    if (!checkpoints) cache.checkpoints.set(kindKey, (checkpoints = new Map()));
    strict.checkpoints = checkpoints;
    let parens = cache.parens.get(kindKey);
    if (!parens) cache.parens.set(kindKey, (parens = new Map()));
    strict.parens = parens;
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
    const ended = stop ? strict.stopped : end < src.length;
    const result = strict.malformed ? MALFORMED : ended ? end : UNCLOSED;
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
  const stacks = strict?.checkpoints && strict.cache?.stacks;
  /**
   * With checkpoints, per open frame the id of the stack up to it, found
   * when a checkpoint needs it: the kind and flags of each frame, and the
   * conditional-expression count of each but the innermost (which changes
   * only while it is innermost, and is part of the checkpoint state). How a
   * scan goes on depends on these, not on where the frames opened.
   */
  const stackIds: (number | undefined)[] | undefined = stacks ? [0] : undefined;

  /** The id of the stack of open frames (`stackIds`). */
  function stackId(): number {
    let k = frames.length - 1;
    while (stackIds![k] === undefined) k--;
    for (k++; k < frames.length; k++) {
      const f = frames[k]!;
      const key =
        `${stackIds![k - 1]} ${frames[k - 1]!.ternary} ${f.kind} ${f.closer}` +
        ` ${+f.header}${+f.operand}${+f.interpolation}`;
      let id = stacks!.get(key);
      if (id === undefined) stacks!.set(key, (id = stacks!.size + 1));
      stackIds![k] = id;
    }
    return stackIds![frames.length - 1]!;
  }
  /** A `{…}` frame result found in `braces`, to skip to. */
  let skipTo: { frame: Frame; end: number } | undefined;

  const parens = strict?.parens;
  const shareAfter = strict?.cache?.shareAfter ?? SHARE_AFTER;
  /**
   * With `parens`, per open frame and per closer in `CLOSERS`: the lowest
   * frame index the closer looked for its frame at, while this frame or one
   * opened in it was innermost. Below a frame's own index, the code in it
   * depended on what is around it. A frame's entry takes in those of the
   * frames opened in it as they close.
   */
  const lowest: number[][] | undefined = parens
    ? [[Infinity, Infinity, Infinity]]
    : undefined;
  /**
   * How many function or class bodies to come the scan has started, and with
   * `braces` or `parens`, that count when each open frame opened. Code in a
   * frame that starts one replaces the one to come, and the new one can't
   * follow once the frame is closed: none is to come then. A scan skipping
   * the frame learns this from its result (`frameEnd`, `resume`), and counts
   * the body as started too, for the frames around it to record.
   */
  let bodyStarts = 0;
  const startsAt: number[] | undefined = braces || parens ? [0] : undefined;
  /** A `(…)` or `[…]` frame result found in `parens`, to skip to. */
  let parenTo: { frame: Frame; result: number } | undefined;

  /** The result of the frame at index `k`, closing at `i`. */
  const closedAt = (k: number) =>
    frameEnd(i, startsAt !== undefined && bodyStarts !== startsAt[k]);

  /**
   * Go on after a frame an earlier scan lexed, whose result (`frameEnd`) is
   * `result`: returns the index it closes at. A body started in it is gone
   * after it, with the one it replaced.
   */
  function resume(result: number): number {
    if (result % 2 === 1) {
      pendingBody = undefined;
      bodyStarts++;
    }
    return Math.floor(result / 2);
  }

  /** The closer `c` looked for its frame and found index `k`. */
  function lookedFor(c: (typeof CLOSERS)[number], k: number) {
    if (!lowest) return;
    const entry = lowest[lowest.length - 1]!;
    const n = CLOSERS.indexOf(c);
    if (k < entry[n]!) entry[n] = k;
  }

  /** Take the entry of the frame at index `k` into the one below it. */
  function foldLowest(k: number) {
    const from = lowest![k]!;
    const into = lowest![k - 1]!;
    for (let n = 0; n < 3; n++) if (from[n]! < into[n]!) into[n] = from[n]!;
  }

  /** Key of a `(…)` or `[…]` frame result, but for the closers it met. */
  const parenKey = (f: Frame) =>
    (f.open * 3 + (f.closer === ']' ? 2 : +f.header)) * 8;

  /**
   * Record how the frame at index `k` ends, if it is a `(…)` or `[…]`, its
   * `lowest` entry complete: under the closers that looked below it, which
   * found nothing to close (else the frame was closed with them).
   */
  function recordParen(k: number, result: number) {
    const f = frames[k]!;
    if (k === 0 || (f.closer !== ')' && f.closer !== ']')) return;
    if (f.open - start < shareAfter) return;
    let met = 0;
    for (let n = 0; n < 3; n++) if (lowest![k]![n]! < k) met |= 1 << n;
    parens!.set(parenKey(f) + met, result);
  }

  /** Record how the open `(…)` and `[…]` frames end: the scan ends in them. */
  function recordOpenParens(result: number) {
    if (!lowest) return;
    for (let k = frames.length - 1; k > 0; k--) {
      recordParen(k, result);
      foldLowest(k);
    }
  }

  /**
   * How an earlier scan found a `(…)` or `[…]` frame opening here to end,
   * if it did: a result recorded under closers that find nothing to close
   * around the frame here too. The frame is not open yet.
   */
  function knownParen(f: Frame): number | undefined {
    if (!parens || f.open - start < shareAfter) return undefined;
    // Where each closer would look for its frame, and whether it would find
    // none to close (it is stray)
    const at = [
      Math.max(innermost(')'), innermost('}')),
      Math.max(innermost(']'), innermost('}')),
      innermost('}'),
    ];
    let stray = 0;
    for (let n = 0; n < 3; n++) {
      const k = at[n]!;
      if (k === 0 || (n < 2 && frames[k]!.closer !== CLOSERS[n])) {
        stray |= 1 << n;
      }
    }
    const key = parenKey(f);
    for (let met = stray; ; met = (met - 1) & stray) {
      const result = parens.get(key + met);
      if (result !== undefined) {
        // The closers it met look here too
        for (let n = 0; n < 3; n++) {
          if (met & (1 << n)) lookedFor(CLOSERS[n]!, at[n]!);
        }
        return result;
      }
      if (met === 0) return undefined;
    }
  }

  /** Record how the open frames end, when the scan ends in them. */
  function recordOpen(result: number) {
    if (!braces) return;
    for (let k = 1; k < frames.length; k++) record(frames[k]!, result);
  }

  /** Record how a frame ends. */
  function record(f: Frame, result: number) {
    const key = braces && frameKey(f);
    if (key !== undefined) braces!.set(key, result);
  }

  /** How an earlier scan found the frame `f` to end, if it did. */
  const known = (f: Frame) => {
    const key = braces && frameKey(f);
    return key === undefined ? undefined : braces!.get(key);
  };

  /** End a strict scan at a lexical error. */
  const malformed = () => {
    recordOpen(MALFORMED);
    recordOpenParens(MALFORMED);
    strict!.malformed = true;
    return src.length;
  };

  function push(f: Frame) {
    stackIds?.push(undefined);
    closers[f.closer]?.push(frames.length);
    frames.push(f);
    lowest?.push([Infinity, Infinity, Infinity]);
    startsAt?.push(bodyStarts);
  }

  /**
   * Just past a token or a space, line break or comment, but not within a
   * word: the key of the position and the whole scan state there, the open
   * frames included, which decide how the scan goes on (or undefined
   * elsewhere). No word is being read there, and the character before is no
   * word character, so a quote after it starts a string in any scan.
   *
   * Within brackets too, once the scan is long (`SHARE_AFTER`). Scans that
   * never passed such a point in the same state each ran on to the end of
   * the source, so many of them took quadratic time: inside an unclosed `(`
   * in `{(}{(}{(…` (there was no point within brackets), or after the regex
   * literals of `{a'</a </p>…` (there was no point after a space).
   */
  function checkpointKey(): CheckpointKey | undefined {
    const ternary = top().ternary;
    if (
      ternary > 3 ||
      !CHECKPOINT_AFTER.has(src.charAt(i - 1)) ||
      (frames.length > 1 && i - start < shareAfter)
    ) {
      return undefined;
    }
    let state = ternary;
    if (operandNext) state |= 1 << 2;
    if (stmtNext) state |= 1 << 3;
    if (keyNext) state |= 1 << 4;
    if (pendingBody) {
      state |= pendingBody.frame.kind === 'class' ? 1 << 5 : 1 << 6;
      if (pendingBody.frame.operand) state |= 1 << 7;
    }
    if (arrowBody) state |= 1 << 8;
    if (afterDot) state |= 1 << 9;
    if (afterHeaderKeyword) state |= 1 << 10;
    if (lineBreak) state |= 1 << 11;
    if (RESTRICTED_KEYWORDS.has(lastKeyword)) state |= 1 << 12;
    if (lastPunct === '=') state |= 1 << 13;
    // A run of dots: one or two (a spread may follow), three, or more
    if (lastPunct === '.') state |= Math.min(dots, 4) << 14;
    const at = i * (1 << 17) + state;
    if (frames.length === 1) return at;
    // A function or class body to come may open at an outer level
    const body = pendingBody ? frames.length - pendingBody.depth : '';
    return `${at} ${stackId()} ${body}`;
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
    if (lowest) {
      for (let j = frames.length - 1; j >= k; j--) foldLowest(j);
      lowest.length = k;
    }
    if (startsAt) startsAt.length = k;
    frames.length = k;
    if (stackIds) stackIds.length = k;
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
      bodyStarts++;
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
    const end = known(f);
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
  function close(c: (typeof CLOSERS)[number]) {
    const k = Math.max(innermost(c), innermost('}'));
    lookedFor(c, k);
    if (k === 0 || frames[k]!.closer !== c) {
      endPunct(c, c === '}');
      return;
    }
    const closed = frames[k]!;
    const result = closedAt(k);
    if (lowest && c !== '}') {
      // Its entry complete, with those of the frames still open in it
      for (let j = frames.length - 1; j > k; j--) foldLowest(j);
      recordParen(k, result);
    }
    truncate(k);
    if (c === ']' && !ctx.lookahead) ctx.brackets.set(closed.open, i);
    if (c === ')') {
      // `if (…) %x = 1` vs `($n)%3`
      endPunct(c, closed.header);
      stmtNext = closed.header;
    } else if (c === ']') {
      endPunct(c, false);
    } else {
      record(closed, result);
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
      case '(':
      case '[': {
        const f = frame('expr', c === '(' ? ')' : ']', i);
        f.header = c === '(' && afterHeaderKeyword;
        endPunct(c, true);
        const result = knownParen(f);
        if (result === undefined) open(f);
        else parenTo = { frame: f, result };
        break;
      }
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
      } else if (frames.length > 1 && known < 0) {
        // The frames open here may close before the error or the end of the
        // source, so their results are not known: none is recorded
        strict!.malformed = known === MALFORMED;
        return src.length;
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
        if (frames.length === 1) return i + 1; // the end of `lexTemplate`
        record(top(), closedAt(frames.length - 1));
        i++;
        truncate(frames.length - 1);
        endOperand();
      } else if (ch === '$' && src.charAt(i + 1) === '{') {
        const f = frame('expr', '}', i);
        f.interpolation = true;
        const end = known(f);
        if (end === MALFORMED) return malformed();
        if (end === UNCLOSED) {
          i = src.length;
          break;
        }
        if (end !== undefined) {
          // An interpolation an earlier scan lexed: on with the text after it
          i = resume(end) + 1;
          continue;
        }
        literal('${', i);
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
      const f = frame('template', '`', i);
      const end = known(f);
      if (end === MALFORMED) return malformed();
      if (end === UNCLOSED) {
        i = src.length;
        break;
      }
      if (end !== undefined) {
        // A template literal an earlier scan lexed: on after it
        i = resume(end) + 1;
        endOperand();
        continue;
      }
      literal(ch, i);
      push(f);
      i++;
      continue;
    }

    if (ch === '{' && strict?.stop?.(i)) {
      recordOpenParens(STOPPED - i);
      strict.stopped = true;
      return i;
    }

    // End of a template literal interpolation: the innermost `}` closer
    if (ch === '}') {
      const k = innermost('}');
      lookedFor('}', k);
      if (frames[k]!.interpolation) {
        endWord();
        record(frames[k]!, closedAt(k));
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

    // End of an `outer` square bracket: a `]` that closes no `[` within the
    // innermost braces closes it, over any `(` left open in it, as it closes
    // a nested `[`. Look-ahead scans record where the `[`s nested in theirs
    // end (`ctx.brackets`), so one starting at a `[` must find the same.
    if (
      ch === outer.closer &&
      (frames.length === 1 ||
        (ch === ']' && innermost(']') === 0 && innermost('}') === 0))
    ) {
      break;
    }

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
      i = resume(end);
      afterBrace(skipped);
      i++;
      continue;
    }
    if (parenTo) {
      // A `(…)` or `[…]` frame an earlier scan lexed: continue after it
      const { frame: skipped, result } = parenTo;
      parenTo = undefined;
      if (result === MALFORMED) return malformed();
      if (result === UNCLOSED) {
        i = src.length;
        break;
      }
      if (result <= STOPPED) {
        recordOpenParens(result);
        strict!.stopped = true;
        return STOPPED - result;
      }
      i = resume(result);
      if (skipped.closer === ')') {
        endPunct(')', skipped.header);
        stmtNext = skipped.header;
      } else {
        endPunct(']', false);
      }
      i++;
      continue;
    }
    code(ch, i);
    i++;
  }
  if (i >= src.length) {
    recordOpen(UNCLOSED);
    recordOpenParens(UNCLOSED);
  }
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
