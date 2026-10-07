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
 * How a macro argument is read (see components/macros/macro-args.ts). Every
 * declared parameter names one: there is no default.
 * Quoted strings accept `\"`, `\'` and `\\` escapes.
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
export const PARAMETER_TYPES = [
  'expression',
  'statements',
  'passage',
  'variable',
  'string',
  'text',
  'names',
  'delay',
  'number',
  'flag',
  'separator',
  'options',
] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

/**
 * What the value of a `string` or `text` argument holds, for the check at
 * story start and for tooling (see code-check.ts):
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
export const STRING_HOLDS = [
  'markup',
  'text',
  'passage',
  'expression',
  'statements',
] as const;

export type StringHolds = (typeof STRING_HOLDS)[number];

export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
  type: ParameterType;
  /** What a `string` or `text` argument holds (see StringHolds). */
  holds?: StringHolds;
  /** The options of an `options` parameter. */
  parameters?: readonly ParameterDef[];
}

/**
 * Throw if a parameter `macro` declares (or an option of one) has no type,
 * or one that isn't a ParameterType: arguments are read by their type, and
 * there is no default. Throw too if it declares what it `holds` wrongly.
 */
export function checkParameterTypes(
  macro: string,
  parameters: readonly ParameterDef[],
): void {
  const holdsFix =
    `Give a \`string\` or \`text\` parameter one of ${STRING_HOLDS.join(', ')} ` +
    'to hold (see docs/custom-macros.md#what-a-string-holds).';
  for (const param of parameters) {
    const type: unknown = param.type;
    if (!PARAMETER_TYPES.includes(type as ParameterType)) {
      throw parameterError(
        macro,
        param,
        type === undefined
          ? 'has no type'
          : `has the unknown type ${JSON.stringify(type)}`,
        `Give it one of the types ${PARAMETER_TYPES.join(', ')} ` +
          '(see docs/custom-macros.md#parameter-types), ' +
          'or declare no parameters and read props.rawArgs.',
      );
    }
    const holds: unknown = param.holds;
    if (holds !== undefined && type !== 'string' && type !== 'text') {
      throw parameterError(
        macro,
        param,
        `is of the type ${type}, which holds what it is`,
        holdsFix,
      );
    }
    if (holds !== undefined && !STRING_HOLDS.includes(holds as StringHolds)) {
      throw parameterError(
        macro,
        param,
        `holds the unknown ${JSON.stringify(holds)}`,
        holdsFix,
      );
    }
    if (param.parameters) checkParameterTypes(macro, param.parameters);
  }
}

/** The error for the parameter `param` of `macro`: what is wrong, and the fix. */
function parameterError(
  macro: string,
  param: ParameterDef,
  problem: string,
  fix: string,
): Error {
  return new Error(
    `spindle: The parameter "${param.name}" of the macro {${macro}} ${problem}. ${fix}`,
  );
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

/** The declared parameters of the macro `name`, if it declares any. */
export function getMacroParameters(
  name: string,
): readonly ParameterDef[] | undefined {
  return metadataRegistry.get(name)?.parameters;
}

export function getMacroRegistry(): MacroMetadata[] {
  return Array.from(metadataRegistry.values());
}

export function clearMetadataRegistry(): void {
  metadataRegistry.clear();
}
