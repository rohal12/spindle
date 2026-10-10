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
  /** The kind of error, which tools tell apart without reading `message`. */
  code: MarkupDiagnosticCode;
  /**
   * Where the offending text is in the passage's content: from `start` up to
   * `end` (UTF-16 offsets). `line` and `column` are those of `start`.
   */
  start: number;
  end: number;
  /** What the diagnostic names, by `code`: the macro, the passage, what to try. */
  data?: MarkupDiagnosticData;
  /** The source file and line, when the passage says where it came from. */
  file?: string;
  fileLine?: number;
}

/**
 * The kinds of diagnostic, which stay the same where the wording of the
 * message changes (they are covered by semver, with the data they carry).
 * The kinds of malformed markup are those of {@link MarkupErrorCode}.
 *
 * | code | `data` |
 * | --- | --- |
 * | `unknown-macro` | `name`, `suggestions` (the closest known macro, if close) |
 * | `unknown-passage` | `name`, `macro` (`link` for `[[…]]`), `suggestions` |
 * | `unquoted-passage-name` | `name`, `macro` |
 * | `argument-error` | `macro` |
 * | `code-syntax` | `macro`, for a macro argument |
 */
export type MarkupDiagnosticCode =
  | MarkupErrorCode
  | 'unknown-macro'
  | 'argument-error'
  | 'code-syntax'
  | 'unknown-passage'
  | 'unquoted-passage-name';

/** What a diagnostic names, by code (see {@link MarkupDiagnosticCode}). */
export type MarkupDiagnosticData = Readonly<
  Record<string, string | readonly string[]>
>;

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

/**
 * Where the selectors of a token are written: from `selectorsStart` up to
 * `selectorsEnd`, without the space that may follow them. Both are absent for
 * a token without selectors.
 */
export interface SelectorSpan {
  selectorsStart?: number;
  selectorsEnd?: number;
}

export interface TextToken extends TokenSpan {
  type: 'text';
  value: string;
  /** A closed HTML comment: markdown drops it, and so does raw rendering. */
  comment?: true;
}

export interface LinkToken extends TokenSpan, Selectors, SelectorSpan {
  type: 'link';
  display: string;
  /** Where the label is written, from `displayStart` to `displayEnd`. */
  displayStart: number;
  displayEnd: number;
  target: string;
  /** Where the target is written, from `targetStart` to `targetEnd`. */
  targetStart: number;
  targetEnd: number;
}

export interface MacroToken extends TokenSpan, Selectors, SelectorSpan {
  type: 'macro';
  name: string;
  /** Where the name is written (after `{`, `/` and the selectors). */
  nameStart: number;
  nameEnd: number;
  rawArgs: string;
  /**
   * Where `rawArgs` is written, without the whitespace around it; an empty
   * span at `nameEnd` when there are none.
   */
  argsStart: number;
  argsEnd: number;
  isClose: boolean;
}

export interface VariableToken extends TokenSpan, Selectors, SelectorSpan {
  type: 'variable';
  name: string;
  /** Where the name is written, without the sigil. */
  nameStart: number;
  nameEnd: number;
  scope: VariableScope;
}

export interface ExpressionToken extends TokenSpan, Selectors, SelectorSpan {
  type: 'expression';
  expression: string;
  /** Where `expression` is written, after the `{` and the selectors. */
  expressionStart: number;
  expressionEnd: number;
}

/** An attribute of an HTML tag as it is written, in order. */
export interface AttributeSpan {
  name: string;
  nameStart: number;
  nameEnd: number;
  /** Where the value is written, without its quotes; absent with no `=`. */
  valueStart?: number;
  valueEnd?: number;
  /** The quote around the value, if it has one. */
  quote?: '"' | "'";
}

export interface HtmlToken extends TokenSpan {
  type: 'html';
  tag: string;
  /** Where the tag name is written. */
  tagNameStart: number;
  tagNameEnd: number;
  /** The attribute values by name; the first of equal names (any case). */
  attributes: Record<string, string>;
  /** Every attribute as written, in order, duplicates included. */
  attributeSpans: AttributeSpan[];
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

/**
 * The kinds of malformed markup. A tag that is malformed: `unclosed-link`
 * (`[[` with no `]]`), `unclosed-expression` (`{$…` with no `}`),
 * `unclosed-macro` (`{name…` with no `}`), `invalid-closer` (`{/` and no
 * name), `closer-with-selectors`, `closer-with-arguments`, `unclosed-tag`
 * (`<div` with no `>`), `unexpected-character` (in a tag) and
 * `unclosed-attribute` (a value with no closing quote). Tags that pair with
 * nothing: `unclosed-block` (`{if}` with no `{/if}`, `<div>` with no
 * `</div>`), `mismatched-closer`, `stray-closer` and `misplaced-branch`
 * (`{else}` outside `{if}`). `syntax` is any other.
 */
export type MarkupErrorCode =
  | PairingErrorCode
  | 'syntax'
  | 'unclosed-link'
  | 'unclosed-expression'
  | 'unclosed-macro'
  | 'invalid-closer'
  | 'closer-with-selectors'
  | 'closer-with-arguments'
  | 'unclosed-tag'
  | 'unexpected-character'
  | 'unclosed-attribute';

/**
 * Malformed markup, with where it starts (0-based offset, 1-based line and
 * column).
 */
export declare class MarkupError extends Error {
  /** What is wrong, without the position. */
  reason: string;
  offset: number;
  line: number;
  column: number;
  /** The kind of error, which stays the same where the wording changes. */
  code: MarkupErrorCode;
  /** Where the offending text ends (0-based, exclusive). */
  end: number;
  /**
   * The names involved, by `code`: `name` for an unclosed, mismatched or
   * stray tag (and `closer`, `parent`, `inside` where there are several).
   */
  data: Readonly<Record<string, string>>;
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
 * they hold a passage name) and the body of `{dialog}`, also in the labels
 * and attribute values that hold markup. Malformed tags are skipped, so
 * half-typed markup reads. It uses the macros registered here; see
 * {@link collectStoryPassageReferences}.
 */
export declare function collectPassageReferences(
  source: string,
): PassageReference[];

// ---------------------------------------------------------------------------
// Stateless checks
//
// `validateMarkup` and `collectPassageReferences` read the process-global
// registry (`defineMacro`). The functions below take the macros to check
// against and keep no state: use them to analyse several projects in one
// process.
// ---------------------------------------------------------------------------

/** What tooling knows about a macro (a `MacroMetadata` has all of it). */
export interface ToolingMacro {
  name: string;
  block: boolean;
  subMacros: string[];
  /**
   * Its declared parameters: their types tell which arguments are code, and
   * what a `string` or `text` argument holds (see `ParameterDef.holds`).
   */
  parameters?: readonly ParameterDef[];
  /** Whether it resolves markup: its strings hold markup by default. */
  interpolate?: boolean;
  /** Whether its first argument names the story variable it binds. */
  storeVar?: boolean;
}

/**
 * The built-in macros, as data: what `getMacroRegistry()` returns before any
 * `defineMacro`. It is loaded without `fs`, so a bundler inlines it.
 */
export declare const builtinMacros: readonly MacroMetadata[];

/**
 * `validateMarkup` against the given `macros` (the built-in ones are in
 * `builtinMacros`; add the user-defined ones): the same checks, with no
 * registry involved.
 */
export declare function validateStoryMarkup(
  passages: Iterable<MarkupPassage>,
  macros: Iterable<ToolingMacro>,
  options?: ValidateMarkupOptions,
): MarkupDiagnostic[];

/**
 * `collectPassageReferences` against the given `macros`, with no registry
 * involved.
 */
export declare function collectStoryPassageReferences(
  source: string,
  macros: Iterable<ToolingMacro>,
): PassageReference[];

// ---------------------------------------------------------------------------
// Variable references
// ---------------------------------------------------------------------------

/** A reference to a story (`$`) or transient (`%`) variable in markup. */
export interface VariableReference {
  sigil: '$' | '%';
  /** The variable, without the sigil. */
  name: string;
  /** The fields accessed with dots (`$a.b.c`: `['b', 'c']`). */
  path: string[];
  /** Where `$a.b.c` is written: `[start, end)` UTF-16 offsets into the markup. */
  start: number;
  end: number;
}

/**
 * What is declared. A schema is absent for a variable whose initializer is not
 * static (`parseDeclarations`): it is declared, and its fields are not checked.
 */
export interface VariableDeclarations {
  variables: ReadonlyMap<string, FieldSchema | undefined>;
  /** The transients (`%`); not checked when absent, as at story start. */
  transients?: ReadonlyMap<string, FieldSchema | undefined>;
}

export type VariableDiagnosticCode =
  | 'undeclared-variable'
  | 'undeclared-transient'
  | 'reserved-name'
  | 'primitive-field';

/** A variable reference that is not valid against the declarations. */
export interface VariableDiagnostic {
  passage: string;
  code: VariableDiagnosticCode;
  /** The variable, without the sigil. */
  name: string;
  /** The fields accessed with dots, if any. */
  path?: string[];
  /** The reference, as offsets into the passage content. */
  start: number;
  end: number;
  /** The message the story start shows (after `Passage "name": `). */
  message: string;
}

/**
 * The variable references the markup of a passage evaluates, in source order,
 * with their positions. Malformed tags are skipped. The macros are those the
 * markup may use (`builtinMacros` and the user-defined ones).
 */
export declare function variableReferences(
  source: string,
  macros?: Iterable<ToolingMacro>,
): VariableReference[];

/**
 * The variable references of the passages that are not valid against the
 * declarations, as the story start checks them: undeclared variables (and
 * transients, when `transients` is given), and fields accessed on primitives
 * that have no such member. Unknown fields of objects are valid (classes may
 * add members), as are any fields of arrays and `null` defaults. Tolerant of
 * half-typed markup; evaluates no project code.
 */
export declare function validateVariableReferences(
  passages: Iterable<MarkupPassage>,
  declarations: VariableDeclarations,
  macros?: Iterable<ToolingMacro>,
): VariableDiagnostic[];

// ---------------------------------------------------------------------------
// Widget definitions
// ---------------------------------------------------------------------------

/** What a `{widget}` definition's arguments declare. */
export interface WidgetDef {
  name: string;
  /** The `@` parameters. */
  params: string[];
}

/**
 * A widget defined by a `{widget}` macro. The offsets are UTF-16 offsets into
 * the content of `passage`.
 */
export interface WidgetDefinition extends WidgetDef {
  /** Whether its body renders `{@children}`: it takes a closing tag. */
  block: boolean;
  passage: string;
  /** The opening `{widget …}` tag. */
  start: number;
  end: number;
  /** The name as written, without quotes. */
  nameStart: number;
  nameEnd: number;
  /** The `{/widget}` closer; absent while the definition is not closed. */
  closeStart?: number;
}

/**
 * The name and `@` parameters a `{widget}` macro reads from its arguments
 * (`"Wrap" @a @b`), as the runtime reads them. Throws where the macro
 * reports the arguments.
 */
export declare function parseWidgetDef(rawArgs: string): WidgetDef;

/**
 * The widgets the story defines, as the runtime registers them: those of
 * `StoryInit` and of the passages tagged `widget`, in source order. Block-ness
 * is decided on tokens, so a `{@children}` in an HTML comment or a `{do}` body
 * does not count; one in an attribute value or label of the `macros` does.
 * Tolerant: a half-typed definition is reported without `closeStart`, and one
 * whose arguments cannot be read is left out.
 */
export declare function widgetDefinitions(
  passages: Iterable<MarkupPassage>,
  macros?: Iterable<ToolingMacro>,
): WidgetDefinition[];

// ---------------------------------------------------------------------------
// Pieces of a passage
// ---------------------------------------------------------------------------

/**
 * What every piece says of where it is: it is at `offset` in the markup
 * given (UTF-16 code units). A piece in the markup of a text (a label, an
 * attribute value) is `nested`, with `where` the description of that text.
 */
export interface PieceBase {
  offset: number;
  nested?: true;
  where?: string;
  /**
   * For the code or text of a quoted string with escapes (a `\"`), whose
   * characters are not where `offset` plus their index says: the offset of
   * each character in the source, and of the end of the text, so that
   * `sourceOffsets[i]` is where character `i` of `code` or `text` is. Absent
   * when `offset + i` is (see {@link pieceOffset}).
   */
  sourceOffsets?: readonly number[];
}

/** Where character `index` of the code or text of `piece` is in the source. */
export declare function pieceOffset(piece: PieceBase, index: number): number;

/**
 * A piece of code: a `{$expr}` display, a `{do}` body, a condition, a macro
 * argument of an `expression`, `statements` or `passage` parameter, a string
 * that holds code, or an attribute that holds code (`onclick`).
 */
export interface CodePiece extends PieceBase {
  kind: 'code';
  code: string;
  goal: JsGoal;
  /** The markup it is in, for an error: `{print $a +}`. */
  label: string;
  /**
   * Whether it names a passage: a `passage` argument that is an expression
   * (one that is a string literal is a PassagePiece).
   */
  passage?: boolean;
  /** Whether it is the code in a quoted string, as in `{watch}`. */
  inString?: boolean;
  /** The macro it is the argument of, for a `passage` argument. */
  macro?: string;
}

/** A passage name written out: in a link, or a quoted `passage` argument. */
export interface PassagePiece extends PieceBase {
  kind: 'passage';
  name: string;
  /** The markup it is in, for an error: `[[Go->Hall]]`. */
  label: string;
  /** How much of the markup is the name, as written (quotes included). */
  length: number;
  /** The macro it is the argument of; `link` for `[[…]]` links. */
  macro: string;
}

/** Macro arguments that don't have their parameters' forms. */
export interface ArgumentErrorPiece extends PieceBase {
  kind: 'argument-error';
  message: string;
  /** How much of the markup the arguments are. */
  length: number;
  /** The markup it is in, for an error: `{link Go}`. */
  label: string;
  /** The macro whose arguments they are. */
  macro: string;
}

/**
 * A text that may hold markup of its own: a label, an attribute value. The
 * pieces of that markup follow it, `nested`.
 */
export interface TextPiece extends PieceBase {
  kind: 'text';
  text: string;
  /** Where it is, for an error: `In the label of {button}: `. */
  where: string;
  /**
   * The tokens of the markup in it, with offsets in the source given (none
   * for a text with no `{`, which has no markup in it).
   */
  tokens: Token[];
  /**
   * Its malformed markup, in the order a parser reading from left to right
   * meets it, with offsets in the source given.
   */
  errors: MarkupError[];
}

/** What a passage runs and names, and where (see {@link passagePieces}). */
export type Piece = CodePiece | TextPiece | PassagePiece | ArgumentErrorPiece;

/**
 * What a passage's markup runs and names, and where: the pieces of code
 * (`{$expr}` displays, `{do}` bodies, conditions, macro arguments by their
 * declared parameter types, strings that hold code), the passage names
 * written out (links, `passage` arguments, `{dialog}` bodies), the texts that
 * hold markup of their own (labels, attribute values) and the arguments that
 * don't have their parameters' forms, in source order with offsets (UTF-16)
 * into `source`. The markup in a text follows it, as pieces marked `nested`
 * with offsets into `source` too. Malformed tags are skipped, so it reads
 * half-typed markup. `macros` are those the markup may use (see
 * `builtinMacros`); without them only the code that needs no declaration is
 * found.
 */
export declare function passagePieces(
  source: string,
  macros?: Iterable<ToolingMacro>,
): Piece[];

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/** What is wrong with the pairing of tags (a subset of {@link MarkupErrorCode}). */
export type PairingErrorCode =
  | 'unclosed-block'
  | 'mismatched-closer'
  | 'stray-closer'
  | 'misplaced-branch';

/** A problem in the pairing of the tokens. */
export interface PairingError {
  code: PairingErrorCode;
  /** What is wrong, without the position. */
  message: string;
  /** The token it is at: from `start` up to `end` (offsets in the source). */
  start: number;
  end: number;
  /**
   * The offset a parser reading left to right notices it at: where the
   * closer ends, or past the end of the markup for what is left open there.
   */
  noticedAt: number;
  /** The names involved, by code (see {@link MarkupError.data}). */
  data: Record<string, string>;
}

/** A branch (`{else}`, `{case}`, …) of a macro, with what follows it. */
export interface PairedBranch {
  tag: MacroToken;
  children: PairedNode[];
}

/** What a macro or element holds, up to its closer. */
export interface PairedBody {
  children: PairedNode[];
  branches: PairedBranch[];
  /** The closing tag; absent if it is never closed. */
  close?: MacroToken | HtmlToken;
}

/**
 * A node of the tree: a token that stands alone (text, a link, a variable, an
 * expression, a macro without a body, a self-closing element), or the opening
 * tag of a macro or element with its `body`.
 */
export interface PairedNode {
  /** The token, or the opening tag of the element. */
  token: Token;
  body?: PairedBody;
  /** From the start of the token to the end of the closer (or of the body). */
  start: number;
  end: number;
}

export interface PairMarkupOptions {
  /** Whether a macro takes a body (default: {@link isBlockMacro}). */
  isBlock?(name: string): boolean;
  /**
   * Whether a macro's body is JavaScript, kept verbatim as one text token
   * (default: `{do}`). One that is never closed is a problem at its opening
   * tag, and the markup after it is not its body.
   */
  isRaw?(name: string): boolean;
  /**
   * The markup the tokens are of: lets a message say at which line and column
   * an element was opened (else it says at which offset).
   */
  source?: string;
}

export interface PairedMarkup {
  nodes: PairedNode[];
  errors: PairingError[];
}

/**
 * Pair the flat `tokens` of markup: which closer closes which opener, which
 * branches belong to which macro, as the runtime reads them (it builds its
 * AST from this). It never throws: a problem is an entry of `errors`, in the
 * order a parser reading from left to right notices them, and the tree is
 * recovered around it. A closer closes the innermost open element, or, when
 * it names one further out, that one, leaving what is open inside it
 * unclosed.
 */
export declare function pairMarkup(
  tokens: readonly Token[],
  options?: PairMarkupOptions,
): PairedMarkup;

/**
 * Whether a macro takes a body closed by `{/name}`: the built-in block
 * macros. Pass the block macros of your story to `pairMarkup` instead when it
 * defines others (see `ToolingMacro.block`, and `{widget}`).
 */
export declare function isBlockMacro(name: string): boolean;

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/** What is wrong with a declaration (see {@link DeclarationError}). */
export type DeclarationErrorCode =
  | 'invalid-declaration'
  | 'invalid-name'
  | 'duplicate-declaration'
  | 'unsupported-value';

/** A declaration of a `StoryVariables` or `StoryTransients` passage. */
export interface Declaration {
  name: string;
  /** Where the name is written, without the sigil (UTF-16 offsets). */
  nameStart: number;
  nameEnd: number;
  /** Where the initializer expression is written, without surrounding space. */
  valueStart: number;
  valueEnd: number;
  /**
   * The shape of the initializer when it is static: a literal, or an array or
   * object literal of them. Absent when it is not (a call, a reference, an
   * operator…).
   */
  schema?: FieldSchema;
}

/** An invalid line of a `StoryVariables` or `StoryTransients` passage. */
export interface DeclarationError {
  code: DeclarationErrorCode;
  /** From `offset` up to `end` (UTF-16 offsets into the content). */
  offset: number;
  end: number;
  /** What is wrong, as `parseStoryVariables` throws it after the passage name. */
  message: string;
}

/**
 * Read the declarations of a `StoryVariables` (`$name = value`) or
 * `StoryTransients` (`%name = value`, pass `sigil: '%'`) passage, without
 * evaluating them and without throwing: every valid declaration, and every
 * invalid line as an error. It is the grammar `parseStoryVariables` reads
 * with.
 *
 * What is static: `number`, `string` (no template with `${}`), `boolean` and
 * `null` literals (also signed numbers), arrays of them, and objects with
 * identifier, string or number keys and static values. The `schema` of an
 * array is `{ type: 'array' }`, as `parseStoryVariables` makes it. Anything
 * else (`Math.PI`, `new Date()`, `1 + 2`, a reference, a spread, a computed
 * key) has no `schema`, and is no error: only a value that no variable can
 * hold is, a function (`function`, `=>`, `class`) or `undefined`.
 */
export declare function parseDeclarations(
  content: string,
  sigil?: '$' | '%',
): { declarations: Declaration[]; errors: DeclarationError[] };
