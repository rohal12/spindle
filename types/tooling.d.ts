/**
 * How a macro argument is read into `ctx.args`. Quoted strings accept `\"`,
 * `\'` and `\\` escapes.
 * - `expression`: code, as written (the default).
 * - `statements`: code run as statements (`{set}`), as written.
 * - `passage`: a passage name: an expression, or its text when it can't
 *   be evaluated (`{goto Bob's room}`), as written.
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

export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
  /** How the argument is read (default `expression`). */
  type?: ParameterType;
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
export type VarType = 'number' | 'string' | 'boolean' | 'array' | 'object';

/** Inferred shape of a declared variable (or one of its object fields). */
export interface FieldSchema {
  type: VarType;
  /** Field schemas, only present for objects. */
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
 * `expression`/`statements` arguments of macros), checked against the
 * built-in macros, those registered with `defineMacro` and the widgets the
 * passages define. Spindle refuses to start a story with any of these.
 */
export declare function validateMarkup(
  passages: Iterable<MarkupPassage>,
): MarkupDiagnostic[];

/**
 * A diagnostic as one line of text, as Spindle shows it:
 * `Passage "Start", line 3, column 5 (story.twee:12): Unclosed {if}: …`.
 */
export declare function formatDiagnostic(diagnostic: MarkupDiagnostic): string;
