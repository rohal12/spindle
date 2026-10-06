/**
 * What the tooling entry point (`@rohal12/spindle/tooling`) bundles as
 * dist/pkg/story-variables.js: the StoryVariables parser and the markup
 * validator, with no Preact or DOM dependencies. pkg/tooling.js re-exports
 * them, binding the validator to its macro metadata.
 */
import {
  validateMarkup,
  type MarkupDiagnostic,
  type MarkupPassage,
} from './markup/validate';
import { isBlockMacro } from './markup/ast';
import { blockWidgetNames } from './widgets/widget-def';
import type { ParameterDef } from './registry';

export { parseStoryVariables } from './story-variables';
export { checkParameterTypes } from './registry';
export { formatDiagnostic } from './markup/validate';
export type { MarkupDiagnostic, MarkupPassage } from './markup/validate';

/** What tooling knows about a macro (see MacroMetadata). */
/** Options for validating markup from tooling. */
export interface ValidateMarkupOptions {
  /**
   * Whether passage names written out (links, quoted `passage` arguments)
   * must name one of the passages given (default: true). Turn it off to
   * validate only part of a story.
   */
  checkPassageNames?: boolean;
}

export interface ToolingMacro {
  name: string;
  block: boolean;
  subMacros: string[];
  /** Its declared parameters: their types tell which arguments are code. */
  parameters?: readonly ParameterDef[];
}

/**
 * Validate the markup of a story's passages as Spindle does when the story
 * starts, against the given macros (built-in and user-defined): malformed
 * markup, unknown macros and syntax errors in code, with their passage, line
 * and column.
 */
export function validateStoryMarkup(
  passages: Iterable<MarkupPassage>,
  macros: Iterable<ToolingMacro>,
  options: ValidateMarkupOptions = {},
): MarkupDiagnostic[] {
  const list = [...passages];
  const known = new Set<string>();
  const parameters = new Map<string, readonly ParameterDef[] | undefined>();
  const blocks = new Set(blockWidgetNames(list).map((n) => n.toLowerCase()));
  for (const macro of macros) {
    const name = macro.name.toLowerCase();
    known.add(name);
    parameters.set(name, macro.parameters);
    for (const sub of macro.subMacros) known.add(sub.toLowerCase());
    if (macro.block) blocks.add(name);
  }
  return validateMarkup(list, {
    isKnownMacro: (name) => known.has(name),
    macroNames: known,
    parametersOf: (name) => parameters.get(name),
    isBlockMacro: (name) =>
      blocks.has(name.toLowerCase()) || isBlockMacro(name),
    checkPassageNames: options.checkPassageNames,
  });
}
