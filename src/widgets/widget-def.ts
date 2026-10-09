/**
 * Reading widget definitions without rendering anything: the `{widget}`
 * macro, startup and markup validation (also in tooling) share these.
 */
import { parseMacroArgs } from '../components/macros/macro-args';
import type { MacroArgs } from '../registry';
import { tokenizeMarkupTolerant } from '../markup/parse';
import type { ParametersOf } from '../code-check';
import { registeredParameters, tokenTextContainsChildren } from './ast-scanner';

/** A {widget} definition's name, then its `@` parameters. */
export const WIDGET_PARAMETERS = [
  { name: 'name', type: 'text', holds: 'text', required: true },
  { name: 'parameters', type: 'text', holds: 'text' },
] as const;

export interface WidgetDef {
  name: string;
  params: string[];
}

/**
 * The widget a {widget} definition's arguments declare: its name and its
 * parameters, the words after it that start with `@` (docs/widgets.md).
 * Other words, such as `$name`, are not parameters.
 */
export function widgetDef({
  name = '',
  parameters = '',
}: MacroArgs<typeof WIDGET_PARAMETERS>): WidgetDef {
  return {
    name,
    params: parameters.split(/\s+/).filter((word) => word.startsWith('@')),
  };
}

/** Read the arguments of a {widget} definition (see widgetDef). */
export function parseWidgetDef(rawArgs: string): WidgetDef {
  return widgetDef(parseMacroArgs(rawArgs, WIDGET_PARAMETERS));
}

/**
 * The names of the block widgets (those whose body renders `{@children}`)
 * that StoryInit and the passages tagged `widget` define. They must be
 * known as block macros before any passage is parsed, so that passages
 * invoking them nest their content whatever the passage order.
 *
 * The passages are read as flat tokens, which need no block macros to be
 * known, so a `{@children}` in an HTML comment or in a `{do}` body is text
 * here as it is to the parser, and does not make a block widget (#387).
 */
export function blockWidgetNames(
  passages: Iterable<{ name: string; tags?: string[]; content: string }>,
  parametersOf: ParametersOf = registeredParameters,
): string[] {
  const names: string[] = [];
  for (const passage of passages) {
    if (passage.name !== 'StoryInit' && !passage.tags?.includes('widget')) {
      continue;
    }
    // The open definitions: their arguments, and whether a slot was seen
    const open: { rawArgs: string; isBlock: boolean }[] = [];
    for (const token of tokenizeMarkupTolerant(passage.content).tokens) {
      if (token.type === 'macro' && token.name.toLowerCase() === 'widget') {
        if (!token.isClose) {
          open.push({ rawArgs: token.rawArgs, isBlock: false });
          continue;
        }
        const def = open.pop();
        if (!def?.isBlock) continue;
        try {
          names.push(parseWidgetDef(def.rawArgs).name);
        } catch {
          // The {widget} macro reports a definition it cannot read
        }
      } else if (
        open.length > 0 &&
        ((token.type === 'variable' &&
          token.scope === 'local' &&
          token.name === 'children') ||
          tokenTextContainsChildren(token, parametersOf))
      ) {
        open[open.length - 1]!.isBlock = true;
      }
    }
  }
  return names;
}
