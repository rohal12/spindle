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
