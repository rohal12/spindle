/**
 * Lexical scanner for the JavaScript in expressions and macro arguments.
 *
 * It is the one place that knows where string, template and regex literals
 * and comments begin and end. The expression transformer (`expression.ts`)
 * and the macro argument splitters (`components/macros/arg-utils.ts`) both
 * walk source text through `lexJs` and differ only in what they do with the
 * pieces it reports.
 *
 * Besides literals, the scanner tracks whether the next token is an operand
 * or an operator, which decides two ambiguities: `/` opens a regex in operand
 * position and divides otherwise, and `%name` is a transient reference in
 * operand position while `%` after an operand — `($n)%3`, `$a[i] %2`,
 * `_i++ %n` — is the modulo operator.
 *
 * A `}` ends an operand when it closes an object literal (`-{}/2` divides)
 * and starts a statement when it closes a block (`if (x) {}\n/re/.test(s)`).
 * A `{` opens a block at the start of the code, after `;`, `{`, `}`, `)`,
 * `=>`, `else` and `do`, and where an operator was expected; elsewhere —
 * after an operator, `(`, `[`, `,`, `:`, `?`, an operand keyword such as
 * `return`, and at the start of a template interpolation — it opens an
 * object literal.
 */

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
  /** A `%name` transient variable reference (`name` without the `%`). */
  transient?(name: string, index: number, nesting: number): void;
}

/** Transient name after `%`: an identifier, so `%3` is never a reference. */
const TRANS_NAME_RE = /[A-Za-z_]\w*/y;
/**
 * The rest of an assignment target and its operator after a transient name:
 * ` = 1`, `.a.b += 2`, but not `== 1` or `=> 1`.
 */
const ASSIGNMENT_RE =
  /(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])/y;
/** Flags after the closing `/` of a regex literal. */
const REGEX_FLAGS_RE = /\w*/y;
/** Characters of identifiers, numbers and sigil variable references. */
const WORD_CHAR_RE = /[\w$@]/;
const SPACE_RE = /\s/;
/** Keywords followed by an operand rather than an operator. */
const OPERAND_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);
/** Keywords whose parenthesised header is followed by a statement. */
const HEADER_KEYWORDS = new Set(['for', 'if', 'while', 'with']);
/** Operand keywords followed by a statement, so a `{` after them is a block. */
const STATEMENT_KEYWORDS = new Set(['do', 'else']);
/** Tokens after which a `{` opens a block (a statement starts there). */
const BLOCK_AFTER_PUNCT = new Set([';', '{', '}', ')', '=>']);

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
    if (c === '\n') return i; // unterminated: leave the rest to the parser
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
    const end = src.indexOf('\n', start);
    return end < 0 ? src.length : end;
  }
  const end = src.indexOf('*/', start + 2);
  return end < 0 ? src.length : end + 2;
}

/**
 * Lex the template literal opening at `start` (a backtick): its backticks,
 * text and escapes are reported as literal text and the code of its `${…}`
 * interpolations through `lexJs` one nesting level deeper. Returns the index
 * just past the closing backtick, or `src.length` if it is unterminated.
 */
export function lexTemplate(
  src: string,
  start: number,
  handlers: JsLexHandlers = {},
  nesting = 0,
): number {
  const literal = (text: string, index: number) =>
    handlers.literal?.(text, index, nesting);
  literal('`', start);
  let i = start + 1;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === '\\') {
      literal(src.slice(i, i + 2), i);
      i += 2;
    } else if (c === '`') {
      literal(c, i);
      return i + 1;
    } else if (c === '$' && src.charAt(i + 1) === '{') {
      literal('${', i);
      i = lexJs(src, handlers, i + 2, nesting + 1);
      if (i < src.length) {
        literal('}', i);
        i++;
      }
    } else {
      literal(c, i);
      i++;
    }
  }
  return Math.min(i, src.length);
}

/**
 * Walk `src` from `start`, reporting code characters, literal text and
 * transient references to `handlers` in source order. Every character of the
 * scanned range is reported exactly once (a transient reference covers its
 * `%` and name). Returns the index where scanning stopped: `src.length`, or
 * — for an interpolation (`nesting > 0`) — the index of the `}` closing it.
 */
export function lexJs(
  src: string,
  handlers: JsLexHandlers,
  start = 0,
  nesting = 0,
): number {
  const interpolation = nesting > 0;
  let i = start;

  let operandNext = true; // an operand (not an operator) comes next
  let word = ''; // identifier/number currently being read
  let afterDot = false; // `word` is a property name, never a keyword
  let afterHeaderKeyword = false; // last token was if/while/for/with
  let lastPunct = '';
  let lastWord = ''; // the identifier or keyword just read, if any
  let lineBreak = false; // a line break since the last token
  let braceDepth = 0;
  const parenIsHeader: boolean[] = []; // per open `(`: closes a header?
  const braceIsBlock: boolean[] = []; // per open `{`: a block, not an object?

  const code = (ch: string, index: number) =>
    handlers.code?.(ch, index, nesting);
  const literal = (text: string, index: number) =>
    handlers.literal?.(text, index, nesting);

  function endWord() {
    if (!word) return;
    operandNext = !afterDot && OPERAND_KEYWORDS.has(word);
    afterHeaderKeyword = !afterDot && HEADER_KEYWORDS.has(word);
    lastWord = afterDot ? '' : word;
    afterDot = false;
    lastPunct = '';
    lineBreak = false;
    word = '';
  }

  /** A string, template or regex literal, or a transient reference, ended. */
  function endOperand() {
    endWord();
    operandNext = false;
    afterHeaderKeyword = false;
    afterDot = false;
    lastPunct = '';
    lastWord = '';
    lineBreak = false;
  }

  /** Track an operator token: `operandNext` tells what may follow it. */
  function endPunct(punct: string, nextIsOperand: boolean) {
    operandNext = nextIsOperand;
    afterDot = punct === '.';
    afterHeaderKeyword = false;
    lastPunct = punct;
    lastWord = '';
    lineBreak = false;
  }

  /** Whether a `{` here opens a block rather than an object literal. */
  function opensBlock(): boolean {
    if (!operandNext) return true; // `try {`, `class A {`, `$x\n{`
    if (lastPunct) return BLOCK_AFTER_PUNCT.has(lastPunct);
    if (lastWord) return STATEMENT_KEYWORDS.has(lastWord);
    return !interpolation; // start of the code
  }

  function trackCode(c: string, index: number) {
    if (WORD_CHAR_RE.test(c)) {
      word += c;
      return;
    }
    endWord();
    // A line break alone never changes operand/operator position:
    // `$x = 5\n%n` continues the expression, as in JavaScript.
    if (c === '\n') lineBreak = true;
    if (SPACE_RE.test(c)) return;
    if (c === '(') parenIsHeader.push(afterHeaderKeyword);
    if (c === '{') {
      braceDepth++;
      braceIsBlock.push(opensBlock());
      endPunct(c, true);
    } else if (c === '}') {
      braceDepth--;
      // After a block a statement may follow; after an object, an operator.
      endPunct(c, braceIsBlock.pop() ?? true);
    } else if (c === ')') {
      // `if (…) %x = 1` vs `($n)%3`
      endPunct(c, parenIsHeader.pop() ?? false);
    } else if (c === '.') {
      // Property access, unless it is the spread `...`
      endPunct(c, lastPunct === '.');
    } else if (
      c === '>' &&
      lastPunct === '=' &&
      src.charAt(index - 1) === '='
    ) {
      endPunct('=>', true);
    } else {
      // `]` ends an operand.
      endPunct(c, c !== ']');
    }
  }

  while (i < src.length) {
    const ch = src.charAt(i);

    // String literal — skip entirely
    if (ch === '"' || ch === "'") {
      const { end } = scanStringLiteral(src, i);
      literal(src.slice(i, end), i);
      i = end;
      endOperand();
      continue;
    }

    if (ch === '`') {
      i = lexTemplate(src, i, handlers, nesting);
      endOperand();
      continue;
    }

    if (ch === '/') {
      endWord();
      const next = src.charAt(i + 1);
      // Comment — skip entirely; it is not a token
      if (next === '/' || next === '*') {
        const end = skipComment(src, i);
        const comment = src.slice(i, end);
        literal(comment, i);
        if (comment.includes('\n')) lineBreak = true;
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

    // Transient reference — where an operand is expected, or as the target
    // of an assignment starting a line: `$x = 5\n%a = 1` would otherwise be
    // the invalid assignment `5 % a = 1`.
    if (ch === '%') {
      endWord();
      TRANS_NAME_RE.lastIndex = i + 1;
      const name = TRANS_NAME_RE.exec(src)?.[0];
      if (name) {
        ASSIGNMENT_RE.lastIndex = i + 1 + name.length;
        if (operandNext || (lineBreak && ASSIGNMENT_RE.test(src))) {
          handlers.transient?.(name, i, nesting);
          i += 1 + name.length;
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

    // End of a template interpolation
    if (ch === '}' && interpolation && braceDepth === 0) break;

    // Regular code character
    trackCode(ch, i);
    code(ch, i);
    i++;
  }
  return i;
}
