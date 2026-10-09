/**
 * How a macro argument is read into `ctx.args`. Quoted strings accept `\"`,
 * `\'` and `\\` escapes.
 * - `expression`: code, as written.
 * - `statements`: code run as statements (`{set}`), as written.
 * - `passage`: a passage name: a quoted string or an expression, as written.
 * - `variable`: a variable reference such as `$name` or `"$name"`, as written.
 * - `string`: one quoted string; anything else leaves the argument unset.
 * - `text`: one quoted string, or text with any loose quotes stripped.
 * - `names`: a comma-separated list of names (`@item, @i`).
 * - `delay`: a duration (`2s`, `500ms`, `300`) in milliseconds.
 * - `number`: a number.
 * - `flag`: a keyword, the parameter's name, at the start or end; a boolean.
 * - `separator`: a word (`of`) or `=` separating the parameters before it
 *   from those after it; a boolean.
 * - `options`: keywords, the names of its `parameters`, each followed by a
 *   quoted string or a number unless it is a flag.
 */
export type ParameterType =
  | 'expression'
  | 'statements'
  | 'passage'
  | 'variable'
  | 'string'
  | 'text'
  | 'names'
  | 'delay'
  | 'number'
  | 'flag'
  | 'separator'
  | 'options';

/**
 * What the value of a `string` or `text` argument holds, for the check at
 * story start and for tooling:
 * - `markup`: markup the macro renders (`{button}`'s label): its markup
 *   is checked.
 * - `text`: plain text the macro uses as written (`{checkbox}`'s label).
 * - `passage`: a passage name (`{watch}`'s `goto`): the passage must exist.
 * - `expression`, `statements`: code (`{watch}`'s condition and `run`): it
 *   is checked as code, and its variable references against the schema.
 *
 * Without it, the argument of a macro with `interpolate` holds `markup`,
 * any other `text`.
 */
export type StringHolds =
  | 'markup'
  | 'text'
  | 'passage'
  | 'expression'
  | 'statements';

export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
  /** How the argument is read: required, there is no default. */
  type: ParameterType;
  /** What a `string` or `text` argument holds (see StringHolds). */
  holds?: StringHolds;
  /** The options of an `options` parameter. */
  parameters?: readonly ParameterDef[];
}

export interface MacroMetadata {
  name: string;
  block: boolean;
  subMacros: string[];
  storeVar?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  source: 'builtin' | 'user';
  description?: string;
  parameters?: ParameterDef[];
}

export interface MacroDefinition {
  name: string;
  subMacros?: string[];
  block?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  storeVar?: boolean;
  description?: string;
  parameters?: readonly ParameterDef[];
  render: (...args: any[]) => any;
  text?: (...args: any[]) => string;
}

/**
 * Metadata-only defineMacro for tooling.
 * Captures macro metadata without creating Preact components.
 * LSP servers call this to register user-defined macros discovered in story scripts.
 */
export declare function defineMacro(config: MacroDefinition): void;

/**
 * Return metadata for all registered macros (built-in + user-defined).
 */
export declare function getMacroRegistry(): MacroMetadata[];

/** Variable type inferred from a StoryVariables/StoryTransients default value. */
export type VarType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null';

/** Inferred shape of a declared variable (or one of its object fields). */
export interface FieldSchema {
  type: VarType;
  /**
   * Field schemas, only present for objects. An object the default refers
   * to more than once has one schema, so a cyclic default (`node.self =
   * node`) gives a schema that refers to itself.
   */
  fields?: Map<string, FieldSchema>;
}

/** A declared variable: its inferred schema plus its default value. */
export interface VariableSchema extends FieldSchema {
  name: string;
  default: unknown;
}

/**
 * Parse the content of a `StoryVariables` (`$name = value`) or
 * `StoryTransients` (`%name = value`, pass `sigil: '%'`) passage into a
 * schema map, exactly as Spindle does at boot.
 * Throws on invalid declarations or unsupported value types (e.g. `null`).
 */
export declare function parseStoryVariables(
  content: string,
  sigil?: '$' | '%',
): Map<string, VariableSchema>;

/** A passage to validate. */
export interface MarkupPassage {
  name: string;
  content: string;
  tags?: string[];
  /**
   * Passage attributes; `data-source-file` and `data-source-line` (the
   * line of its `::` header) place errors in the source file.
   */
  metadata?: Record<string, string>;
}

/** An error in a passage's markup. */
export interface MarkupDiagnostic {
  passage: string;
  /** 1-based line within the passage's content. */
  line: number;
  /** 1-based column (UTF-16 code units). */
  column: number;
  message: string;
  /** The source file and line, when the passage says where it came from. */
  file?: string;
  fileLine?: number;
}

/**
 * Validate the markup of a story's passages as Spindle does when the story
 * starts: malformed markup (unclosed or mismatched macros, tags, links,
 * braces and attribute values), unknown macros and syntax errors in the
 * code passages run (`{$…}` expressions, `{do}` bodies, conditions and the
 * `expression`/`statements`/`passage` arguments of macros), checked against
 * the built-in macros, those registered with `defineMacro` and the widgets
 * the passages define, and passage names that name none of `passages`
 * (links, quoted `passage` arguments, `{link}`, `{dialog}`, `{watch}`).
 * Spindle refuses to start a story with any of these.
 */
export declare function validateMarkup(
  passages: Iterable<MarkupPassage>,
  options?: ValidateMarkupOptions,
): MarkupDiagnostic[];

/** Options for {@link validateMarkup}. */
export interface ValidateMarkupOptions {
  /**
   * Whether passage names written out (links, quoted `passage` arguments)
   * must name one of `passages` (default: true). Turn it off to validate
   * only part of a story.
   */
  checkPassageNames?: boolean;
}

/**
 * A diagnostic as one line of text, as Spindle shows it:
 * `Passage "Start", line 3, column 5 (story.twee:12): Unclosed {if}: …`.
 */
export declare function formatDiagnostic(diagnostic: MarkupDiagnostic): string;

// ---------------------------------------------------------------------------
// Parsing rules
//
// The leaf rules Spindle parses passages with, so that editor tooling can use
// them instead of mirroring them (see docs/tooling.md). They are pure
// string-to-data functions that do not load the runtime.
// ---------------------------------------------------------------------------

/** The sigil of a variable reference: story, temporary, local, transient. */
export type Sigil = '$' | '_' | '@' | '%';

/**
 * What a piece of code is: one expression (a macro argument) or a list of
 * statements (a `{do}` body).
 */
export type JsGoal = 'expression' | 'statements';

/** What `lexJs` reports, in source order, every character exactly once. */
export interface JsLexHandlers {
  /**
   * One character of code, outside literals and comments. `nesting` is the
   * number of template-literal `${…}` interpolations around it.
   */
  code?(ch: string, index: number, nesting: number): void;
  /**
   * Literal text passed through verbatim: a string or regex literal, a
   * comment, or a piece of a template literal.
   */
  literal?(text: string, index: number, nesting: number): void;
  /** A sigil variable reference (`$name`), covering the sigil and name. */
  variable?(sigil: Sigil, name: string, index: number, nesting: number): void;
}

/**
 * Walk `src` as JavaScript, reporting code characters, literal text and
 * variable references to `handlers`. Text that is no JavaScript is read
 * leniently: an unterminated literal runs to the end. Returns `src.length`.
 */
export declare function lexJs(
  src: string,
  handlers: JsLexHandlers,
  goal?: JsGoal,
): number;

/**
 * Lex the template literal opening at `start` (a backtick) as `lexJs` does,
 * its interpolations one nesting level deeper. Returns the index just past
 * its closing backtick, or `src.length` if it is unterminated.
 */
export declare function lexTemplate(
  src: string,
  start: number,
  handlers?: JsLexHandlers,
  nesting?: number,
): number;

export interface FindCodeEndOptions {
  /** What the code is (default `expression`). */
  goal?: JsGoal;
  /** End the code at a `{` in code, at any depth, for which this holds. */
  stop?: (index: number) => boolean;
}

/**
 * Where the code starting at `start` ends: the index of the `}` that closes
 * the `{…}` around it (or, with `stop`, of the first `{` for which it holds).
 * Braces and quotes in literals and comments don't count. `-1` when there is
 * no such end, or the code before it can't be JavaScript.
 */
export declare function findCodeEnd(
  src: string,
  start: number,
  options?: FindCodeEndOptions,
): number;

/**
 * Scan the `"…"` or `'…'` string literal opening at `start`: `end` is just
 * past its closing quote, or `src.length` when unterminated (`closed` false).
 */
export declare function scanStringLiteral(
  src: string,
  start: number,
): { end: number; closed: boolean };

/** The namespace a variable reference reads. */
export type VariableScope = 'variable' | 'temporary' | 'local' | 'transient';

/** The scope each variable sigil names. */
export declare const SIGIL_SCOPES: Readonly<Record<Sigil, VariableScope>>;

/** Whether `c` is a variable sigil. */
export declare function isSigil(c: string | undefined): c is Sigil;

/** The `.class#id` selectors written before a link, variable or macro. */
export interface Selectors {
  className?: string;
  id?: string;
}

/**
 * The selectors that start `source` at `at`, and `end`, the index just past
 * them and the one space that may follow (`at` if there are none). A name
 * may hold `{$name}` interpolations.
 */
export declare function parseSelectors(
  source: string,
  at?: number,
): Selectors & { end: number };

/** Where a token is in the input: from `start` up to `end`. */
interface TokenSpan {
  start: number;
  end: number;
}

export interface TextToken extends TokenSpan {
  type: 'text';
  value: string;
}

export interface LinkToken extends TokenSpan, Selectors {
  type: 'link';
  display: string;
  target: string;
  /** Where the target is written, from `targetStart` to `targetEnd`. */
  targetStart: number;
  targetEnd: number;
}

export interface MacroToken extends TokenSpan, Selectors {
  type: 'macro';
  name: string;
  rawArgs: string;
  isClose: boolean;
}

export interface VariableToken extends TokenSpan, Selectors {
  type: 'variable';
  name: string;
  scope: VariableScope;
}

export interface ExpressionToken extends TokenSpan, Selectors {
  type: 'expression';
  expression: string;
}

export interface HtmlToken extends TokenSpan {
  type: 'html';
  tag: string;
  attributes: Record<string, string>;
  isClose: boolean;
  isSelfClose: boolean;
}

/** A flat markup token, with its offsets (UTF-16 code units) in the input. */
export type Token =
  | TextToken
  | LinkToken
  | MacroToken
  | VariableToken
  | ExpressionToken
  | HtmlToken;

/** Malformed markup, with where it starts (0-based offset, 1-based line and column). */
export declare class MarkupError extends Error {
  reason: string;
  offset: number;
  line: number;
  column: number;
}

export interface ParseMarkupOptions {
  /**
   * Text mode, for markup that becomes a string (HTML attribute values,
   * macro labels): only `{…}` markup and brace escapes are recognized.
   */
  text?: boolean;
}

/**
 * The flat tokens of markup, without nesting, so unclosed or mismatched
 * macros and elements are no error here. Throws a `MarkupError` for a
 * malformed tag, such as an unclosed `{`, `[[` or attribute value.
 */
export declare function tokenizeMarkup(
  source: string,
  options?: ParseMarkupOptions,
): Token[];

/**
 * Split macro arguments at top-level commas (outside strings, templates and
 * brackets); with no comma, adjacent standalone values separated by
 * whitespace (`"Label" "target"`).
 */
export declare function splitArgs(raw: string): string[];

/**
 * Split `src` at every top-level character for which `isSeparator` holds
 * (code outside literals, comments and brackets). Segments are untrimmed and
 * empty ones are kept.
 */
export declare function splitTopLevel(
  src: string,
  isSeparator: (ch: string) => boolean,
): string[];

/**
 * Read the `"…"` or `'…'` string whose opening quote is at `start`: its
 * unescaped value (`\"`, `\'` and `\\` only) and the index just past it, or
 * `null` if there is none or it is unterminated.
 */
export declare function readQuoted(
  src: string,
  start: number,
): { value: string; end: number } | null;

/** Undo `\"`, `\'` and `\\` in the body of a quoted macro argument. */
export declare function unescapeQuoted(body: string): string;

/** Strip an optional quote from each end of a loosely quoted argument. */
export declare function stripLooseQuotes(src: string): string;

/** Whether code ends with an operator that still needs an operand. */
export declare function endsWithOperator(src: string): boolean;

/**
 * The arguments of `{include}`: whether it has the standalone `inline` flag
 * (first or last word, outside quotes and brackets), and the passage
 * expression that is left.
 */
export declare function splitIncludeFlag(rawArgs: string): {
  inline: boolean;
  passage: string | undefined;
};

/** The tokens of markup that may be malformed, and its errors. */
export interface TolerantTokens {
  tokens: Token[];
  /** One for each malformed tag, in source order, with offsets in the source. */
  errors: MarkupError[];
}

/**
 * `tokenizeMarkup` for half-typed markup: the tokens it can read, and every
 * error, instead of throwing at the first. At a malformed tag the tokens
 * before it are kept, its first character is read as text, and tokenizing
 * resumes after it. Offsets are in `source`. For well-formed markup the
 * tokens are those of `tokenizeMarkup` and there are no errors.
 */
export declare function tokenizeMarkupTolerant(
  source: string,
  options?: ParseMarkupOptions,
): TolerantTokens;

/**
 * The code Spindle runs for `expr`: its variable references (`$var`, `_var`,
 * `@var`, `%var`) turned into namespace lookups (`variables["var"]`).
 * String, template and regex literals and comments are untouched. `goal` is
 * `'statements'` for a `{do}` body. Throws a `SyntaxError` for code that is
 * not well-formed, and for a reference to a variable named `__proto__`.
 */
export declare function transform(expr: string, goal?: JsGoal): string;

/** What a `passage` argument is: a quoted name, or an expression. */
export type PassageTarget =
  | { kind: 'name'; name: string }
  | { kind: 'expression'; expression: string };

/**
 * Read a `passage` argument (`{goto "Hall"}`, `{include $room}`) as written:
 * a quoted string is the name its JavaScript literal has (`"Hall"` is
 * `Hall`), anything else an expression whose value, as a string, is the name
 * when it runs.
 */
export declare function passageTarget(arg: string): PassageTarget;

/**
 * The passage a `passage` argument names, as `{goto}`, `{include}` and
 * `{link}` find it: `String(evaluate(expr))`. Throws what `evaluate` throws,
 * and an error naming the current passage if the story has no passage of
 * that name.
 */
export declare function evaluatePassageName(
  expr: string | undefined,
  evaluate: (expr: string) => unknown,
  state: {
    storyData: { passages: { has(name: string): boolean } } | null;
    currentPassage: string;
  },
): string;

/** A passage that markup names, and where. */
export interface PassageReference {
  /** The macro it is the argument of; `link` for `[[…]]` links. */
  macro: string;
  /** The name written out, or the expression whose value is the name. */
  target: PassageTarget;
  /** Where it is written, as written (quotes included): offsets in `source`. */
  start: number;
  end: number;
}

/**
 * The passages the markup of `source` names, in source order: `[[…]]` links,
 * the passage of `{goto}`, `{include}` and `{link}` (and of macros that
 * declare a `passage` argument), the `goto` and `dialog` actions of
 * `{watch}` (and the `string` and `text` arguments of macros that declare
 * they hold a passage name) and the body of `{dialog}`. Malformed tags are
 * skipped, so half-typed markup reads.
 */
export declare function collectPassageReferences(
  source: string,
): PassageReference[];
