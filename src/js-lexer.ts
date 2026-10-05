/**
 * Lexical scanner for the JavaScript in expressions and macro arguments.
 *
 * It is the one place that knows where string, template and regex literals
 * and comments begin and end. The expression transformer (`expression.ts`)
 * and the macro argument splitters (`components/macros/arg-utils.ts`) both
 * walk source text through `lexJs` and differ only in what they do with the
 * pieces it reports.
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

/** Index just past the regex literal (with flags) opening at `start`. */
function skipRegex(src: string, start: number): number {
  let inClass = false; // inside `[…]`, where `/` does not close
  let i = start + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    // Unterminated at the end of the line: leave the rest to the parser
    if (LINE_TERMINATOR_RE.test(c)) return i;
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') {
      inClass = true;
    } else if (c === '/') {
      REGEX_FLAGS_RE.lastIndex = i + 1;
      return i + 1 + (REGEX_FLAGS_RE.exec(src)?.[0].length ?? 0);
    }
    i++;
  }
  return src.length;
}

/** Index just past the comment opening at `start` (`//` or `/*`). */
function skipComment(src: string, start: number): number {
  if (src.charAt(start + 1) === '/') {
    LINE_TERMINATOR_G.lastIndex = start;
    return LINE_TERMINATOR_G.exec(src)?.index ?? src.length;
  }
  const end = src.indexOf('*/', start + 2);
  return end < 0 ? src.length : end + 2;
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

  const code = (ch: string, index: number) =>
    handlers.code?.(ch, index, nesting);
  const literal = (text: string, index: number) =>
    handlers.literal?.(text, index, nesting);

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
    frames.push(f);
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
    endPunct('{', true);
    open(f);
  }

  /**
   * Close the innermost frame that `c` closes; a stray closer, with no such
   * frame within the current interpolation, is ignored.
   */
  function close(c: string) {
    let k = frames.length - 1;
    while (k > 0 && frames[k]!.closer !== c && !frames[k]!.interpolation) k--;
    if (k === 0 || frames[k]!.closer !== c) {
      endPunct(c, c === '}');
      return;
    }
    const closed = frames[k]!;
    frames.length = k;
    if (c === ']' && !ctx.lookahead) ctx.brackets.set(closed.open, i);
    if (c === ')') {
      // `if (…) %x = 1` vs `($n)%3`
      endPunct(c, closed.header);
      stmtNext = closed.header;
    } else if (c === ']' || closed.operand) {
      endPunct(c, false);
    } else {
      // A block: a statement (or the next class member) may follow
      endPunct(c, true);
      stmtNext = top().kind === 'block';
      keyNext = top().kind === 'class';
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

    // Template literal text: escapes, the closing backtick, interpolations
    if (top().kind === 'template') {
      if (ch === '\\') {
        literal(src.slice(i, i + 2), i);
        i += 2;
      } else if (ch === '`') {
        literal(ch, i);
        i++;
        if (frames.length === 1) return i; // the end of `lexTemplate`
        frames.pop();
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
      endWord();
      const { end } = scanStringLiteral(src, i);
      literal(src.slice(i, end), i);
      i = end;
      endOperand();
      continue;
    }

    if (ch === '`') {
      endWord();
      literal(ch, i);
      frames.push(frame('template', '`', i));
      i++;
      continue;
    }

    // End of a template literal interpolation: the innermost `}` closer
    if (ch === '}') {
      let k = frames.length - 1;
      while (k > 0 && frames[k]!.closer !== '}') k--;
      if (frames[k]!.interpolation) {
        endWord();
        frames.length = k;
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
        const end = skipComment(src, i);
        const comment = src.slice(i, end);
        literal(comment, i);
        if (LINE_TERMINATOR_RE.test(comment)) lineBreakSeen();
        i = end;
        continue;
      }
      // Regex literal — only where an operand is expected
      if (operandNext) {
        const end = skipRegex(src, i);
        literal(src.slice(i, end), i);
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
    code(ch, i);
    i++;
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
