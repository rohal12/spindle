/**
 * Reading widget definitions without rendering anything: the `{widget}`
 * macro, startup and markup validation (also in tooling) share these.
 */
import { parseMacroArgs } from '../components/macros/macro-args';
import type { MacroArgs } from '../registry';

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
 * A definition: its arguments (read like a {widget} macro's, see
 * parseWidgetDef) and its body. Macro names are not case-sensitive.
 */
const WIDGET_DEFINITION = /\{widget\s+([^}]*)\}([\s\S]*?)\{\/widget\}/gi;

/** `{@children}`, also with selectors such as `{.highlight @children}`. */
const CHILDREN_PLACEHOLDER = /\{[^{}]*@children\s*\}/;

/**
 * The names of the block widgets (those whose body renders `{@children}`)
 * that StoryInit and the passages tagged `widget` define. They must be
 * known as block macros before any passage is parsed, so that passages
 * invoking them nest their content whatever the passage order.
 */
export function blockWidgetNames(
  passages: Iterable<{ name: string; tags?: string[]; content: string }>,
): string[] {
  const names: string[] = [];
  for (const passage of passages) {
    if (passage.name !== 'StoryInit' && !passage.tags?.includes('widget')) {
      continue;
    }
    for (const match of passage.content.matchAll(WIDGET_DEFINITION)) {
      if (!CHILDREN_PLACEHOLDER.test(match[2]!)) continue;
      try {
        names.push(parseWidgetDef(match[1]!).name);
      } catch {
        // The {widget} macro reports a definition it cannot read
      }
    }
  }
  return names;
}
