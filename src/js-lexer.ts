/**
 * The JavaScript in story markup, read with acorn.
 *
 * acorn reads the code: where string, template and regex literals and
 * comments begin and end, whether `/` opens a regex, and (`parseCode`) the
 * syntax tree. A plugin (`SigilParser`) teaches its tokenizer the two sigils
 * that are no JavaScript: `@name` (locals) anywhere, and `%name`
 * (transients) where an operand is expected, the same place acorn reads `/`
 * as a regex; `%` elsewhere is the modulo operator. `$name` and `_name` are
 * identifiers already; the syntax tree tells references from property names
 * and declarations.
 *
 * - `parseCode`: the references and string text of well-formed code, or a
 *   `CodeSyntaxError` that says what is wrong and where. The expression
 *   engine (`expression.ts`) rewrites the references it finds, and the
 *   story-start check (`story-variables.ts`) reports the errors.
 * - `findCodeEnd`: where the code in a `{…}` ends, for the passage
 *   tokenizer. -1 when acorn can't tokenize it: the tokenizer then scans it
 *   leniently, as prose-like macro arguments (`{link Don't go}`) need.
 * - `lexJs`: a lenient token walk for the macro argument splitters
 *   (`components/macros/arg-utils.ts`), which also read text that is no
 *   JavaScript.
 *
 * Restrictions (docs/variables.md "Code in passages"): sigil variables can't
 * be declared (`let _x`, `(_a) => …`) or be property names (`a.@x`), and
 * code must be valid modern JavaScript (a non-strict script).
 */
import {
  Parser,
  tokTypes as tt,
  getLineInfo,
  type Options,
  type TokenType,
} from 'acorn';

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
   * comment, or a piece of a template literal (its backticks, text and the
   * `${` / `}` around interpolations, whose code is reported through
   * `code`).
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

/** Code runs through `new Function`: a non-strict script body. */
const OPTIONS: Options = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
};

/** `@name`: a local; the name is the whole identifier after the `@`. */
const AT_NAME_RE = /\w+(?![\p{ID_Continue}$\u200c\u200d])/uy;
/** `%name`: a transient; `%3` is never one. */
const TRANS_NAME_RE = /[A-Za-z_]\w*(?![\p{ID_Continue}$\u200c\u200d])/uy;
/** A `$`/`_` identifier that is a variable reference: `$a`, not `$a$b`. */
const SIGIL_IDENT_RE = /^[$_]\w+$/;
/**
 * `%name` starting a line after an operand, assigned to: `$x = 5⏎%a = 1`
 * would otherwise read as `5 % a = 1`. Its target may go on with `.name`
 * and `[…]` (no brackets inside); otherwise a `;` must end the line before.
 */
const TRANSIENT_ASSIGN_RE = (() => {
  const ws = String.raw`(?:\s|/\*[\s\S]*?\*/)*`;
  const member = String.raw`(?:\.${ws}[\w$]+|\[[^[\]]*\])`;
  const op = String.raw`(?:\*\*|<<|>>>?|&&|\|\||\?\?|[-+*/%&|^])?=(?![=>])`;
  return new RegExp(`${ws}(?:${member}${ws})*${op}`, 'y');
})();
const LINE_BREAK_RE = /[\n\r\u2028\u2029]/;

/** acorn's tokenizer state, which its typings leave out. */
interface ParserState {
  input: string;
  pos: number;
  type: TokenType;
  value: unknown;
  start: number;
  end: number;
  exprAllowed: boolean;
  context: unknown[];
  nextToken(): void;
  finishToken(type: TokenType, value?: unknown): void;
  parseExpression(): AnyNode;
}

type Base = new (options: Options, input: string, start?: number) => Parser;

/**
 * acorn with the `@name` and `%name` sigils, and a fix to its guess whether
 * a `{` after `:` opens a block: after the `:` of a conditional it opens an
 * object literal (`a ? b : {} / 2`), not a block as after a label.
 */
const SigilParser = class extends (Parser as unknown as Base) {
  /** Whether an operand could start before the last token, and this one. */
  operandBeforeLast = true;
  operandHere = true;
  /** Whether a line break came before the last token, and this one. */
  breakBeforeLast = false;
  breakHere = false;
  /** Conditional `?`s awaiting their `:`, by context depth. */
  ternaries: number[] = [];
  /** The last `:` ended a conditional's `?`. */
  colonEndsTernary = false;

  readToken(code: number): void {
    const self = this as unknown as ParserState;
    this.operandBeforeLast = this.operandHere;
    this.operandHere = self.exprAllowed;
    this.breakBeforeLast = this.breakHere;
    this.breakHere = LINE_BREAK_RE.test(self.input.slice(self.end, self.pos));
    if (code === 64 || code === 37) {
      const at = self.pos;
      const re = code === 64 ? AT_NAME_RE : TRANS_NAME_RE;
      re.lastIndex = at + 1;
      const name = re.exec(self.input)?.[0];
      if (name) {
        const end = at + 1 + name.length;
        // acorn reads `/` after a prefix `++` as division; `%` there is
        // still a sigil (`++%n`), but after a postfix one modulo (`n++ % 2`)
        const afterPrefix =
          self.type === tt.incDec &&
          (this.operandBeforeLast || this.breakBeforeLast);
        if (
          code === 64 ||
          self.exprAllowed ||
          afterPrefix ||
          transientAssignment(self, end)
        ) {
          self.pos = end;
          self.finishToken(tt.name, self.input.charAt(at) + name);
          return;
        }
      }
    }
    // @ts-expect-error acorn internals
    super.readToken(code);
  }

  finishToken(type: TokenType, value?: unknown): void {
    const depth = (this as unknown as ParserState).context.length;
    if (type === tt.question) {
      this.ternaries[depth] = (this.ternaries[depth] ?? 0) + 1;
    } else if (type === tt.colon) {
      const open = this.ternaries[depth] ?? 0;
      this.colonEndsTernary = open > 0;
      if (open > 0) this.ternaries[depth] = open - 1;
    }
    // @ts-expect-error acorn internals
    super.finishToken(type, value);
  }

  braceIsBlock(prevType: TokenType): boolean {
    if (prevType === tt.colon && this.colonEndsTernary) return false;
    // @ts-expect-error acorn internals
    return super.braceIsBlock(prevType);
  }
};

function transientAssignment(p: ParserState, end: number): boolean {
  if (!LINE_BREAK_RE.test(p.input.slice(p.end, p.pos))) return false;
  TRANSIENT_ASSIGN_RE.lastIndex = end;
  return TRANSIENT_ASSIGN_RE.test(p.input);
}

/**
 * A tokenizer (and parser) for `src` from `start` on. In an expression, the
 * first token reads as after a `(`: a `{` opens an object literal, and a
 * `function` or `class` is an expression, which an operator may follow.
 * After an operand, a `/` divides.
 */
function tokenizerAt(
  src: string,
  start: number,
  goal: JsGoal,
  { onComment, afterOperand = false }: TokenizerOptions = {},
): ParserState {
  const options = onComment ? { ...OPTIONS, onComment } : OPTIONS;
  const p = new SigilParser(options, src, start) as unknown as ParserState;
  if (goal === 'expression') p.type = tt.parenL;
  if (afterOperand) p.exprAllowed = false;
  return p;
}

interface TokenizerOptions {
  onComment?: Options['onComment'];
  afterOperand?: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The bracket left open where a syntax error is. */
export interface OpenBracket {
  /** `(`, `[`, `{` or `${`. */
  open: string;
  closer: string;
  /** Its index in the source. */
  pos: number;
}

/**
 * A syntax error in story code: `reason` at index `pos` of `source`, and the
 * bracket left open there when that is the likely cause. Its message reads
 * `Unexpected end of code at column 16: ($gold + $count▶ (missing ")" for
 * the "(" at column 1)`.
 */
export class CodeSyntaxError extends SyntaxError {
  constructor(
    readonly reason: string,
    readonly source: string,
    readonly pos: number,
    readonly bracket?: OpenBracket,
  ) {
    super(
      `${reason} ${where(source, pos)}` +
        bracketHint(bracket, (at) => columnOf(source, at)),
    );
    this.name = 'SyntaxError';
  }

  /**
   * The error as found in `text` (a passage) where the code starts at
   * `offset`: `line 2, column 16: Unexpected "{" (missing ")" for the "("
   * at line 2, column 4)`.
   */
  describeIn(text: string, offset: number): string {
    const at = (pos: number) => {
      const { line, column } = getLineInfo(text, offset + pos);
      return `line ${line}, column ${column + 1}`;
    };
    return (
      `${at(this.pos)}: ${this.reason}` +
      bracketHint(this.bracket, (pos) => `at ${at(pos)}`)
    );
  }
}

function bracketHint(
  b: OpenBracket | undefined,
  at: (pos: number) => string,
): string {
  return b ? ` (missing "${b.closer}" for the "${b.open}" ${at(b.pos)})` : '';
}

/** `at column 4`, or `at line 2, column 4` in code over several lines. */
function columnOf(src: string, pos: number): string {
  const { line, column } = getLineInfo(src, pos);
  return LINE_BREAK_RE.test(src)
    ? `at line ${line}, column ${column + 1}`
    : `at column ${column + 1}`;
}

/** `at column 9: $name = ▶"Bob`: the place, and its line marked there. */
function where(src: string, pos: number): string {
  const { column } = getLineInfo(src, pos);
  const lineStart = pos - column;
  const after = src.slice(lineStart).search(LINE_BREAK_RE);
  const lineEnd = after < 0 ? src.length : lineStart + after;
  const from = Math.max(lineStart, pos - 30);
  const to = Math.min(lineEnd, pos + 30);
  const excerpt =
    (from > lineStart ? '…' : '') +
    src.slice(from, pos) +
    '▶' +
    src.slice(pos, to) +
    (to < lineEnd ? '…' : '');
  return `${columnOf(src, pos)}: ${excerpt.trim()}`;
}

/** The last element of `list`. */
const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

const CLOSER: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '${': '}',
};

/**
 * Turn an acorn error into a `CodeSyntaxError`: name the token it stopped
 * at, and the bracket left open when that is the likely cause.
 */
function syntaxError(src: string, error: unknown): CodeSyntaxError {
  if (!(error instanceof SyntaxError) || !('pos' in error)) throw error;
  const pos = (error as SyntaxError & { pos: number }).pos;
  let reason = error.message.replace(/ \(\d+:\d+\)$/, '');
  const { open, token } = bracketsBefore(src, pos);
  const atEnd = pos >= src.length || token === '';
  let unclosed = false;
  if (reason === 'Unexpected token') {
    reason = atEnd ? 'Unexpected end of code' : `Unexpected "${token}"`;
    unclosed =
      !!open &&
      CLOSER[open.text] !== token &&
      (atEnd || [')', ']', '}', ';', '{'].includes(token));
  } else if (reason.startsWith('Unterminated template')) {
    // A backtick in an interpolation opens a template of its own: the `}`
    // ending the interpolation is missing (`${$name`)
    unclosed = open?.text === '${';
  }
  const bracket =
    unclosed && open
      ? { open: open.text, closer: CLOSER[open.text]!, pos: open.pos }
      : undefined;
  return new CodeSyntaxError(reason, src, pos, bracket);
}

/** The innermost bracket open at `pos`, and the token there. */
function bracketsBefore(
  src: string,
  pos: number,
): { open?: { text: string; pos: number }; token: string } {
  const stack: { text: string; pos: number }[] = [];
  for (const tok of tokens(src, 0, 'statements')) {
    if ('error' in tok) break;
    if (tok.start >= pos || tok.type === tt.eof) {
      return { open: last(stack), token: src.slice(tok.start, tok.end) };
    }
    const text = src.slice(tok.start, tok.end);
    if (text in CLOSER) stack.push({ text, pos: tok.start });
    else if (stack.length && CLOSER[last(stack)!.text] === text) stack.pop();
  }
  return { open: last(stack), token: src.charAt(pos) };
}

// ---------------------------------------------------------------------------
// Parsing: references, string text, errors
// ---------------------------------------------------------------------------

export interface VariableRef {
  sigil: Sigil;
  /** The name after the sigil. */
  name: string;
  /** Range of the sigil and name in the source. */
  start: number;
  end: number;
  /** A shorthand property (`{ $gold }`): its key is to be written out. */
  shorthand: boolean;
}

export interface ParsedCode {
  /** The variable references, in source order. */
  refs: VariableRef[];
  /** The raw text of string literals and template literal pieces. */
  strings: string[];
}

/**
 * Parse `src` as `goal`, and find its variable references and string text.
 * Throws a `CodeSyntaxError` for code that is not well-formed, and for a
 * sigil variable declared (`let _x`) or used as a property name (`a.@x`).
 */
export function parseCode(
  src: string,
  goal: JsGoal = 'expression',
): ParsedCode {
  let ast: AnyNode;
  try {
    if (goal === 'statements') {
      ast = (SigilParser as unknown as typeof Parser).parse(
        src,
        OPTIONS,
      ) as unknown as AnyNode;
    } else {
      // As acorn's parseExpressionAt, and then the code must end
      const p = tokenizerAt(src, 0, goal);
      p.nextToken();
      ast = p.parseExpression();
      if (p.type !== tt.eof) {
        throw Object.assign(new SyntaxError('Unexpected token'), {
          pos: p.start,
        });
      }
    }
  } catch (error) {
    throw syntaxError(src, error);
  }
  const out: ParsedCode = { refs: [], strings: [] };
  walk(ast, src, out, false, false);
  out.refs.sort((a, b) => a.start - b.start);
  return out;
}

interface AnyNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const isNode = (v: unknown): v is AnyNode =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as AnyNode).type === 'string';

const NAMESPACE_NAME: Record<Sigil, string> = {
  $: 'story',
  _: 'temporary',
  '@': 'local',
  '%': 'transient',
};

/** The sigil and name of a sigil identifier, as written. */
function sigilOf(node: AnyNode, src: string): [Sigil, string] | null {
  const name = node.name as string;
  const c = src.charAt(node.start);
  if (c !== name.charAt(0)) return null; // written with an escape
  if (c === '@' || c === '%') return [c, name.slice(1)];
  if ((c === '$' || c === '_') && SIGIL_IDENT_RE.test(name)) {
    return [c, name.slice(1)];
  }
  return null;
}

/** A property or member name: never a reference, and never `@x`/`%x`. */
function propertyName(node: unknown, src: string): void {
  if (!isNode(node) || node.type !== 'Identifier') return;
  const c = src.charAt(node.start);
  if (c === '@' || c === '%') {
    throw new CodeSyntaxError(
      `"${node.name as string}" can't be a property name`,
      src,
      node.start,
    );
  }
}

/**
 * Collect the references and string text under `node`. `binding`: the
 * identifiers here are declared (a `let`, a parameter), where a sigil
 * variable can't be. `shorthand`: the node is a shorthand property's value.
 */
function walk(
  node: unknown,
  src: string,
  out: ParsedCode,
  binding: boolean,
  shorthand: boolean,
): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, src, out, binding, false);
    return;
  }
  if (!isNode(node)) return;
  const sub = (child: unknown, bind = false, short = false) =>
    walk(child, src, out, bind, short);
  switch (node.type) {
    case 'Identifier': {
      const sigil = sigilOf(node, src);
      if (!sigil) return;
      if (binding) {
        throw new CodeSyntaxError(
          `"${node.name as string}" is a ${NAMESPACE_NAME[sigil[0]]} variable and can't be declared`,
          src,
          node.start,
        );
      }
      out.refs.push({
        sigil: sigil[0],
        name: sigil[1],
        start: node.start,
        end: node.end,
        shorthand,
      });
      return;
    }
    case 'Literal':
      if (typeof node.value === 'string') {
        out.strings.push(src.slice(node.start + 1, node.end - 1));
      }
      return;
    case 'TemplateElement':
      out.strings.push((node.value as { raw: string }).raw);
      return;
    case 'MemberExpression':
      sub(node.object);
      if (node.computed) sub(node.property);
      else propertyName(node.property, src);
      return;
    case 'Property':
      if (node.computed) sub(node.key);
      else if (!node.shorthand) propertyName(node.key, src);
      if (node.shorthand) {
        const value = node.value as AnyNode;
        if (value.type === 'AssignmentPattern') {
          sub(value.left, binding, true);
          sub(value.right);
        } else {
          sub(value, binding, true);
        }
      } else {
        sub(node.value, binding);
      }
      return;
    case 'MethodDefinition':
    case 'PropertyDefinition':
      if (node.computed) sub(node.key);
      else propertyName(node.key, src);
      sub(node.value);
      return;
    case 'LabeledStatement':
      sub(node.body);
      return;
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
    case 'PrivateIdentifier':
      return;
    case 'VariableDeclarator':
      sub(node.id, true);
      sub(node.init);
      return;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      sub(node.id, true);
      for (const p of node.params as unknown[]) sub(p, true);
      sub(node.body);
      return;
    case 'ClassDeclaration':
    case 'ClassExpression':
      sub(node.id, true);
      sub(node.superClass);
      sub(node.body);
      return;
    case 'CatchClause':
      sub(node.param, true);
      sub(node.body);
      return;
    case 'AssignmentPattern':
      sub(node.left, binding);
      sub(node.right);
      return;
    case 'ObjectPattern':
    case 'ArrayPattern':
    case 'RestElement':
      for (const key of ['properties', 'elements', 'argument']) {
        sub(node[key], binding);
      }
      return;
    default:
      for (const key in node) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const v = node[key];
        if (typeof v === 'object' && v !== null) sub(v);
      }
  }
}

// ---------------------------------------------------------------------------
// Where code in markup ends
// ---------------------------------------------------------------------------

export interface FindCodeEndOptions {
  /** What the code is (default `expression`). */
  goal?: JsGoal;
  /** End the code at a `{` in code, at any depth, for which this holds. */
  stop?: (index: number) => boolean;
  /** @deprecated Ignored: scans share no results. */
  stopKey?: string;
  /** @deprecated Ignored: scans share no results. */
  cache?: JsScanCache;
}

/** @deprecated Scans share no results; kept for callers' signatures. */
export type JsScanCache = Record<string, never>;

/** @deprecated Scans share no results; kept for callers' signatures. */
export function createJsScanCache(): JsScanCache {
  return {};
}

/** Words a string may follow with no space between (`of'x'`, `get"y"`). */
const WORDS_BEFORE_STRING = new Set(['of', 'get', 'set', 'static', 'async']);

/**
 * Find where the code starting at `start` ends, reading it as JavaScript:
 * braces, quotes and backticks inside literals and comments don't count.
 *
 * Without `stop`, the code ends at the first `}` in code outside the
 * brackets it opened (the `}` closing a `{…}` around it); with `stop`, at
 * the first `{` in code, at any depth, for which `stop` holds. Returns the
 * index of that `}` or `{`.
 *
 * A backtick inside a `${…}` that the code never closes is read as closing
 * the template literal around it, once (`{set $s = \`Hi ${$name\`}` ends
 * at its last `}`), so the error is reported in the block the author wrote.
 *
 * Returns -1 when there is no such end, or when the code before it can't be
 * JavaScript: an unterminated string, regex literal or comment, a character
 * no JavaScript has, or a quote directly after a word (`don't`). Callers
 * fall back to a more lenient reading there, so text that only looks like
 * code is not swallowed by an apostrophe or a stray quote. A quoted string
 * may span lines here, as quoted macro labels may.
 */
export function findCodeEnd(
  src: string,
  start: number,
  { goal = 'expression', stop }: FindCodeEndOptions = {},
): number {
  const stack: string[] = [];
  let prevEnd = -1;
  let prevWord = false;
  let from = start;
  let afterOperand = false;
  for (;;) {
    let resumeAt = -1;
    for (const tok of tokens(src, from, goal, { afterOperand })) {
      if ('error' in tok) {
        const k = stack.lastIndexOf('${');
        const unclosed = /^Unterminated template/.test(tok.error.message);
        // One such slip per block: more is no code an author meant
        if (!unclosed || k < 0 || afterOperand) return -1;
        // The template's text starts just past the backtick that opened it
        stack.length = k;
        resumeAt = tok.pos;
        break;
      }
      const t = tok.type;
      if (t === tt.eof) return -1;
      if (t === tt.string && prevWord && tok.start === prevEnd) return -1;
      prevWord =
        (t === tt.name && !WORDS_BEFORE_STRING.has(tok.value as string)) ||
        t === tt.num;
      prevEnd = tok.end;
      if (t === tt.braceL) {
        if (stop?.(tok.start)) return tok.start;
        stack.push('{');
      } else if (t === tt.dollarBraceL) stack.push('${');
      else if (t === tt.parenL) stack.push('(');
      else if (t === tt.bracketL) stack.push('[');
      else if (t === tt.parenR || t === tt.bracketR) {
        if (last(stack) === (t === tt.parenR ? '(' : '[')) stack.pop();
      } else if (t === tt.braceR) {
        const k = Math.max(stack.lastIndexOf('{'), stack.lastIndexOf('${'));
        if (k >= 0) stack.length = k;
        else if (!stop) return tok.start;
      }
    }
    from = resumeAt;
    afterOperand = true;
    prevWord = false;
  }
}

interface Tok {
  type: TokenType;
  start: number;
  end: number;
  value: unknown;
}

/**
 * acorn's tokens from `start` on, up to and including `eof`, or up to an
 * error it raises (`pos` is where). A quoted string with a line break in it
 * is one string token: quoted macro labels may span lines, though no
 * JavaScript string does.
 */
function* tokens(
  src: string,
  start: number,
  goal: JsGoal,
  options: TokenizerOptions = {},
): Generator<Tok | { error: Error; pos: number }> {
  let p = tokenizerAt(src, start, goal, options);
  for (;;) {
    try {
      p.nextToken();
    } catch (error) {
      const pos = Math.min(
        (error as { pos?: number }).pos ?? p.pos,
        src.length,
      );
      if (/^Unterminated string/.test((error as Error).message)) {
        const { end, closed } = scanStringLiteral(src, pos);
        if (closed) {
          yield { type: tt.string, start: pos, end, value: undefined };
          p = tokenizerAt(src, end, 'statements', {
            onComment: options.onComment,
            afterOperand: true,
          });
          continue;
        }
      }
      yield { error: error as Error, pos };
      return;
    }
    yield { type: p.type, start: p.start, end: p.end, value: p.value };
    if (p.type === tt.eof) return;
  }
}

// ---------------------------------------------------------------------------
// Lenient token walk
// ---------------------------------------------------------------------------

/**
 * Walk `src`, reporting code characters, literal text and variable
 * references to `handlers` in source order, every character exactly once.
 * Text acorn can't tokenize is read leniently: an unterminated literal runs
 * to the end, and a character no JavaScript has is code. Returns
 * `src.length`.
 */
export function lexJs(
  src: string,
  handlers: JsLexHandlers,
  goal: JsGoal = 'expression',
): number {
  return walkTokens(src, 0, handlers, 0, goal, false);
}

/**
 * Lex the template literal opening at `start` (a backtick) as `lexJs` does,
 * its interpolations one nesting level deeper. Returns the index just past
 * its closing backtick, or `src.length` if it is unterminated.
 */
export function lexTemplate(
  src: string,
  start: number,
  handlers: JsLexHandlers = {},
  nesting = 0,
): number {
  return walkTokens(src, start, handlers, nesting, 'expression', true);
}

function walkTokens(
  src: string,
  from: number,
  handlers: JsLexHandlers,
  nesting: number,
  goal: JsGoal,
  oneTemplate: boolean,
): number {
  const comments: [number, number][] = [];
  const onComment = (_block: boolean, _text: string, s: number, e: number) => {
    comments.push([s, e]);
  };
  const code = (a: number, b: number) => {
    for (let i = a; i < b; i++) handlers.code?.(src.charAt(i), i, nesting);
  };
  const literal = (a: number, b: number) => {
    if (b > a) handlers.literal?.(src.slice(a, b), a, nesting);
  };
  /** Spaces and comments between tokens. */
  const gap = (a: number, b: number) => {
    for (const [s, e] of comments) {
      if (e <= a || s >= b) continue;
      code(a, s);
      literal(s, e);
      a = e;
    }
    comments.length = 0;
    code(a, b);
  };
  /** Open brackets; `${` stands for a template interpolation. */
  const stack: string[] = [];
  let templates = 0;
  let gen = tokens(src, from, goal, { onComment });
  let pos = from;
  let prev: TokenType | undefined;
  for (;;) {
    const tok = gen.next().value!;
    if ('error' in tok) {
      const at = Math.max(pos, tok.pos);
      gap(pos, at);
      if (at >= src.length) return src.length;
      if (/^Unterminated/.test(tok.error.message)) {
        literal(at, src.length);
        return src.length;
      }
      // A character no JavaScript has: code, and on after it
      code(at, at + 1);
      pos = at + 1;
      gen = tokens(src, pos, goal, { onComment });
      prev = undefined;
      continue;
    }
    const t = tok.type;
    if (t === tt.eof) {
      gap(pos, src.length);
      return src.length;
    }
    gap(pos, tok.start);
    if (t === tt.name) {
      const sigil = sigilAt(src, tok.start, tok.value as string);
      const property =
        prev === tt.dot ||
        prev === tt.questionDot ||
        ((sigil === '$' || sigil === '_') && keyPosition(src, tok.end, prev));
      if (sigil && !property) {
        handlers.variable?.(
          sigil,
          src.slice(tok.start + 1, tok.end),
          tok.start,
          nesting,
        );
      } else code(tok.start, tok.end);
    } else if (
      t === tt.string ||
      t === tt.regexp ||
      t === tt.template ||
      t === tt.invalidTemplate
    ) {
      literal(tok.start, tok.end);
    } else if (t === tt.backQuote) {
      literal(tok.start, tok.end);
      // acorn reads a (maybe empty) text piece before each closing backtick
      if (prev === tt.template || prev === tt.invalidTemplate) {
        templates--;
        if (oneTemplate && templates === 0) return tok.end;
      } else {
        templates++;
      }
    } else if (t === tt.dollarBraceL) {
      literal(tok.start, tok.end);
      stack.push('${');
      nesting++;
    } else if (t === tt.braceR && last(stack) === '${') {
      stack.pop();
      nesting--;
      literal(tok.start, tok.end);
    } else {
      if (t === tt.braceL || t === tt.parenL || t === tt.bracketL) {
        stack.push(src.charAt(tok.start));
      } else if (t === tt.braceR || t === tt.parenR || t === tt.bracketR) {
        if (stack.length && last(stack) !== '${') stack.pop();
      }
      code(tok.start, tok.end);
    }
    prev = t;
    pos = tok.end;
  }
}

/** The sigil of the name token `value` at `start`, if it is a reference. */
function sigilAt(src: string, start: number, value: string): Sigil | null {
  const c = src.charAt(start);
  if ((c === '@' || c === '%') && value.charAt(0) === c) return c;
  if ((c === '$' || c === '_') && SIGIL_IDENT_RE.test(value)) return c;
  return null;
}

/** A key in an object literal: after `{` or `,`, before `:` or `(`. */
function keyPosition(
  src: string,
  end: number,
  prev: TokenType | undefined,
): boolean {
  if (prev !== tt.braceL && prev !== tt.comma) return false;
  const next = /\S/g;
  next.lastIndex = end;
  const c = next.exec(src)?.[0];
  return c === ':' || c === '(';
}

/**
 * Scan the `"…"` or `'…'` string literal opening at `start`. `end` is the
 * index just past its closing quote, or `src.length` when it is unterminated
 * (`closed` false). A backslash escapes the character after it, so a quote
 * after an even run of backslashes closes the string and one after an odd
 * run does not. Line breaks don't end it: quoted macro labels may span lines.
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
