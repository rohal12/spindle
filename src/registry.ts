import type { ComponentType } from 'preact';
import type { ASTNode, Branch } from './markup/ast';
import { NameMap, NameSet } from './utils/macro-names';

export interface MacroProps {
  rawArgs: string;
  className?: string;
  id?: string;
  children?: ASTNode[];
  branches?: Branch[];
}

const registry = new NameMap<ComponentType<MacroProps>>();

export function registerMacro(
  name: string,
  component: ComponentType<MacroProps>,
): void {
  registry.set(name, component);
}

export function getMacro(name: string): ComponentType<MacroProps> | undefined {
  return registry.get(name);
}

/**
 * What a macro's text form gets: see MacroDefinition.text. Evaluation runs
 * in the scope of the attribute (or label) being resolved.
 */
export interface MacroTextContext {
  /** Evaluate an expression in the current scope. */
  evaluate: (expr: string) => unknown;
  /**
   * The text of AST nodes (a body or branch) in the current scope, with
   * `locals` (keys without `@`) added on top of the current locals.
   */
  renderText: (nodes: ASTNode[], locals?: Record<string, unknown>) => string;
}

/** A macro's text form: the string it stands for in text-only markup. */
export type MacroTextRenderer = (
  props: MacroProps,
  ctx: MacroTextContext,
) => string;

const textRegistry = new NameMap<MacroTextRenderer>();

/** Register (or, with undefined, remove) the text form of a macro. */
export function registerMacroText(
  name: string,
  text: MacroTextRenderer | undefined,
): void {
  if (text) textRegistry.set(name, text);
  else textRegistry.delete(name);
}

export function getMacroText(name: string): MacroTextRenderer | undefined {
  return textRegistry.get(name);
}

const subMacros = new NameSet();

export function registerSubMacro(name: string): void {
  subMacros.add(name);
}

export function isSubMacro(name: string): boolean {
  return subMacros.has(name);
}

/**
 * How a macro argument is read (see components/macros/macro-args.ts).
 * Quoted strings accept `\"`, `\'` and `\\` escapes.
 * - `expression`: code, as written (the default).
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
  type?: ParameterType;
  /** The options of an `options` parameter. */
  parameters?: readonly ParameterDef[];
}

type ArgValue<T, D> = T extends 'flag' | 'separator'
  ? boolean
  : T extends 'names'
    ? string[] | undefined
    : T extends 'delay' | 'number'
      ? number | undefined
      : T extends 'options'
        ? D extends { parameters: infer Q extends readonly ParameterDef[] }
          ? Partial<MacroArgs<Q>>
          : Partial<MacroArgs>
        : string | undefined;

/** The arguments of a macro declaring `parameters`, by parameter name. */
export type MacroArgs<P extends readonly ParameterDef[] = ParameterDef[]> = {
  [D in P[number] as D['name']]: ArgValue<D['type'], D>;
};

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

const metadataRegistry = new NameMap<MacroMetadata>();

export function registerMacroMetadata(
  name: string,
  metadata: MacroMetadata,
): void {
  metadataRegistry.set(name, metadata);
}

export function getMacroRegistry(): MacroMetadata[] {
  return Array.from(metadataRegistry.values());
}

export function clearMetadataRegistry(): void {
  metadataRegistry.clear();
}
