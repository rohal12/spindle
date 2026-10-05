export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
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
  parameters?: ParameterDef[];
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
