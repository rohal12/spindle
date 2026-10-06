/**
 * Shared helpers for macros that split or read their raw argument text by
 * hand. Their lexical model is the expression lexer's (`js-lexer.ts`):
 * string, template and regex literals and comments are opaque (a backslash
 * inside a literal escapes the character after it, and `${…}` parts of a
 * template are code), `/` opens a regex only where an operand is expected,
 * and `(`/`[`/`{` nest.
 */
import { lexJs, lexTemplate, scanStringLiteral } from '../../js-lexer';

/** True for a whitespace character. */
export function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}

function isOpener(ch: string): boolean {
  return ch === '(' || ch === '[' || ch === '{';
}

function isCloser(ch: string): boolean {
  return ch === ')' || ch === ']' || ch === '}';
}

/**
 * Given the index of an opening quote (`"`, `'` or a backtick), return the
 * index just past its closing quote, or `src.length` if it is unterminated.
 * A backslash escapes the character after it, so a quote preceded by an even
 * run of backslashes still closes the string and one preceded by an odd run
 * does not. Inside a template literal, `${…}` interpolations are lexed as
 * code, so quotes, backticks, braces and regexes inside them do not end it.
 */
export function skipString(src: string, start: number): number {
  return src[start] === '`'
    ? lexTemplate(src, start)
    : scanStringLiteral(src, start).end;
}

/**
 * Undo the escapes allowed in a literal quoted macro argument: `\"`, `\'`
 * and `\\` become `"`, `'` and `\`. Other backslash sequences (`\n`, `\d`)
 * are kept as written, so code and regex text inside the string survive.
 */
export function unescapeQuoted(body: string): string {
  return body.replace(/\\(["'\\])/g, '$1');
}

/**
 * Read the `"…"` or `'…'` string whose opening quote is at `start`.
 * Returns its unescaped value and the index just past the closing quote, or
 * `null` if there is no such quote at `start` or the string is unterminated.
 */
export function readQuoted(
  src: string,
  start: number,
): { value: string; end: number } | null {
  const quote = src[start];
  if (quote !== '"' && quote !== "'") return null;
  const { end, closed } = scanStringLiteral(src, start);
  if (!closed) return null;
  return { value: unescapeQuoted(src.slice(start + 1, end - 1)), end };
}

/**
 * The unescaped value of `src` when it is exactly one `"…"` or `'…'` string
 * (as with `readQuoted`), otherwise `null`.
 */
export function readWholeQuoted(src: string): string | null {
  const quoted = readQuoted(src, 0);
  return quoted && quoted.end === src.length ? quoted.value : null;
}

const JS_SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

/** Undo every escape of a JavaScript string literal's body. */
function decodeJsEscapes(body: string): string {
  return body.replace(
    /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r\n|[\n\r\u2028\u2029])|([\s\S]))/g,
    (_, braced, unicode, hex, lineBreak, other: string | undefined) => {
      if (lineBreak !== undefined) return '';
      const code = braced ?? unicode ?? hex;
      if (code !== undefined) {
        const point = parseInt(code, 16);
        return point <= 0x10ffff ? String.fromCodePoint(point) : '';
      }
      return JS_SIMPLE_ESCAPES[other!] ?? other!;
    },
  );
}

/**
 * The value of `src` when it is exactly one `"…"` or `'…'` string, read as
 * the JavaScript literal it is (`"\u0048all"` is `Hall`), otherwise `null`.
 * `readWholeQuoted` keeps other escapes as written, for labels and code.
 */
export function readWholeJsString(src: string): string | null {
  const quoted = readQuoted(src, 0);
  if (!quoted || quoted.end !== src.length) return null;
  return decodeJsEscapes(src.slice(1, -1));
}

/**
 * Strip an optional quote from each end of an unquoted-or-loosely-quoted
 * argument (`"Red`, `Red'`), leaving at least one character. This is the
 * lenient fallback for labels that are not one well-formed quoted string.
 */
export function stripLooseQuotes(src: string): string {
  return /^["']?(.+?)["']?$/s.exec(src)?.[1] ?? src;
}

/** An operator character, or an operator keyword, at the end of code. */
const TRAILING_OPERATOR_RE =
  /(?:[-+*/%&|^!~=<>?:,.]|(?:^|[^\w$@.])(?:typeof|void|new|delete|in|instanceof|await|yield))$/;

/**
 * Whether `src` ends with an operator that still needs an operand (`$a +`,
 * `$a+`, `$x ==`, `typeof`), so it cannot be a complete value on its own.
 * Only code counts: the closing `/` of a regex literal is not division, a
 * variable reference (`$a`, `%name`, ...) is an operand, trailing comments are skipped,
 * and a postfix `++` or `--` completes its operand.
 */
export function endsWithOperator(src: string): boolean {
  // Index just past the last code token, or -1 when a literal or transient
  // reference ends the source.
  let end = -1;
  lexJs(src, {
    code(ch, i, nesting) {
      if (nesting === 0 && !isWhitespace(ch)) end = i + 1;
    },
    literal(text, _i, nesting) {
      const comment = text.startsWith('//') || text.startsWith('/*');
      if (nesting === 0 && !comment) end = -1;
    },
    variable(_sigil, _name, _i, nesting) {
      if (nesting === 0) end = -1;
    },
  });
  if (end < 0) return false;
  const code = src.slice(0, end);
  if (/(?:\+\+|--)$/.test(code)) return false;
  return TRAILING_OPERATOR_RE.test(code);
}

/**
 * Indices of the characters in `src` that satisfy `isSeparator` and sit at
 * depth 0: in code outside string, template and regex literals and comments,
 * and outside `()`, `[]` and `{}` pairs.
 */
export function topLevelIndices(
  src: string,
  isSeparator: (ch: string) => boolean,
): number[] {
  const indices: number[] = [];
  let depth = 0;
  lexJs(src, {
    code(ch, i, nesting) {
      if (nesting > 0) return; // inside a template interpolation
      if (isOpener(ch)) depth++;
      else if (isCloser(ch)) depth--;
      else if (depth === 0 && isSeparator(ch)) indices.push(i);
    },
  });
  return indices;
}

/**
 * Split `src` at every depth-0 separator (see `topLevelIndices`). Segments
 * are returned as written, untrimmed, and empty segments are kept, so
 * `n` separators always give `n + 1` segments.
 */
export function splitTopLevel(
  src: string,
  isSeparator: (ch: string) => boolean,
): string[] {
  const segments: string[] = [];
  let from = 0;
  for (const i of topLevelIndices(src, isSeparator)) {
    segments.push(src.slice(from, i));
    from = i + 1;
  }
  segments.push(src.slice(from));
  return segments;
}

/**
 * Check whether a whitespace-delimited token looks like a standalone value
 * (not an operator or partial expression): it starts like a value and does
 * not end with an operator still waiting for its operand.
 */
function isStandaloneValue(token: string): boolean {
  return startsLikeValue(token) && !endsWithOperator(token);
}

function startsLikeValue(token: string): boolean {
  const first = token[0]!;
  // Quoted string
  if (first === '"' || first === "'" || first === '`') return true;
  // Variable ($var, _var, @var, %var), but not the modulo operator in `$a % 2`
  if (/^[$_@]\w|^%[A-Za-z_]/.test(token)) return true;
  // Number literal
  if (/\d/.test(first)) return true;
  // Signed number (-1, +2)
  if (
    (first === '-' || first === '+') &&
    token.length > 1 &&
    /\d/.test(token[1]!)
  )
    return true;
  // Grouped expression or collection literal
  if (first === '(' || first === '[' || first === '{') return true;
  // Boolean / null / undefined, alone or leading an expression (true||$x)
  if (/^(?:true|false|null|undefined)(?![\w$])/.test(token)) return true;
  // Negation (!$flag, !true), but not the operators != and !==
  if (first === '!' && token.length > 1 && token[1] !== '=') return true;
  return false;
}

/**
 * Try to split a raw string on whitespace at depth 0 (respecting strings,
 * template literals, parentheses, brackets, and braces). Each resulting token
 * must pass `isStandaloneValue()` or the split is rejected and `null` is
 * returned.
 */
function trySplitOnWhitespace(raw: string): string[] | null {
  const args = splitTopLevel(raw, isWhitespace).filter(Boolean);

  // Need 2+ tokens
  if (args.length < 2) return null;

  // Every token must be a standalone value (not an operator)
  for (const arg of args) {
    if (!isStandaloneValue(arg)) return null;
  }

  return args;
}

/**
 * Split rawArgs by commas, respecting parentheses, brackets, braces, and
 * strings. When no top-level commas are present, also supports adjacent quoted
 * string literals separated by whitespace (e.g. `"Label" "target"`).
 */
export function splitArgs(raw: string): string[] {
  const args = splitTopLevel(raw, (ch) => ch === ',').map((a) => a.trim());
  const hasComma = args.length > 1;
  if (args[args.length - 1] === '') args.pop();

  // If no commas were found and we got a single expression, try splitting
  // on whitespace at depth 0 (e.g. "Label" "target", $var "text", $x $y).
  if (!hasComma && args.length === 1) {
    const split = trySplitOnWhitespace(args[0]!);
    if (split) return split;
  }

  return args;
}
