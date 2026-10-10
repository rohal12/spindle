/**
 * Reading widget definitions without rendering anything: the `{widget}`
 * macro, startup and markup validation (also in tooling) share these.
 */
import { parseMacroArgs, type ArgSpans } from '../components/macros/macro-args';
import { STRING_HOLDS, type MacroArgs, type StringHolds } from '../registry';
import { tokenizeMarkupTolerant } from '../markup/parse';
import type { MacroToken } from '../markup/tokens';
import type { ParametersOf } from '../code-check';
import { registeredParameters, tokenTextContainsChildren } from './ast-scanner';

/** A {widget} definition's name, then its `@` parameters. */
export const WIDGET_PARAMETERS = [
  { name: 'name', type: 'text', holds: 'text', required: true },
  { name: 'parameters', type: 'text', holds: 'text' },
] as const;

export interface WidgetDef {
  name: string;
  /** The `@` parameters, without what they declare to hold. */
  params: string[];
  /**
   * What the parameters that declare it hold (`@target:passage`), by name
   * with the `@`: the check of a call reads such an argument as it reads
   * the same `holds` of a macro's `string` parameter. Absent when none does.
   */
  holds?: Record<string, StringHolds>;
  /** The parameters that declare something no `holds` is (see checkWidgetHolds). */
  badHolds?: { param: string; written: string }[];
}

/**
 * The widget a {widget} definition's arguments declare: its name and its
 * parameters, the words after it that start with `@` (docs/widgets.md),
 * separated by spaces or commas (`@a, @b`). A parameter may say what its
 * argument holds after a colon (`@target:passage`, one of the `holds` of a
 * macro parameter; another word is a `badHolds`). Other words, such as
 * `$name`, are not parameters.
 */
export function widgetDef({
  name = '',
  parameters = '',
}: MacroArgs<typeof WIDGET_PARAMETERS>): WidgetDef {
  const params: string[] = [];
  const holds: Record<string, StringHolds> = {};
  const badHolds: WidgetDef['badHolds'] = [];
  for (const word of parameters.split(/[\s,]+/)) {
    if (!word.startsWith('@')) continue;
    const [param = word, written] = word.split(/:(.*)/s);
    params.push(param);
    if (written === undefined) continue;
    if (STRING_HOLDS.includes(written as StringHolds)) {
      holds[param] = written as StringHolds;
    } else {
      badHolds.push({ param, written });
    }
  }
  return {
    name,
    params,
    ...(Object.keys(holds).length > 0 ? { holds } : {}),
    ...(badHolds.length > 0 ? { badHolds } : {}),
  };
}

/** Throw if a parameter of `def` declares what it holds wrongly. */
export function checkWidgetHolds({ name, badHolds = [] }: WidgetDef): void {
  const [bad] = badHolds;
  if (!bad) return;
  throw new Error(
    `spindle: The widget parameter ${bad.param} of {widget "${name}"} holds the unknown ${JSON.stringify(bad.written)}. ` +
      `Write one of ${STRING_HOLDS.join(', ')} after the colon (see docs/widgets.md#what-an-argument-holds).`,
  );
}

/** Read the arguments of a {widget} definition (see widgetDef). */
export function parseWidgetDef(rawArgs: string): WidgetDef {
  return widgetDef(parseMacroArgs(rawArgs, WIDGET_PARAMETERS));
}

/** A passage that may define widgets, as the tooling reads it. */
export interface WidgetPassage {
  name: string;
  tags?: string[];
  content: string;
}

/**
 * A widget defined by a `{widget}` macro, with where it is written (UTF-16
 * offsets into the passage content).
 */
export interface WidgetDefinition extends WidgetDef {
  /** Whether its body renders `{@children}`. */
  block: boolean;
  /** The passage defining it. */
  passage: string;
  /** The opening `{widget …}` tag. */
  start: number;
  end: number;
  /** The name as written, without quotes. */
  nameStart: number;
  nameEnd: number;
  /** The `{/widget}` closer, absent while the definition is not closed. */
  closeStart?: number;
}

/** Where the name is written in the arguments, without its quotes. */
function nameSpan(rawArgs: string): [number, number] {
  const spans: ArgSpans = new Map();
  parseMacroArgs(rawArgs, WIDGET_PARAMETERS, spans);
  const [start, end] = spans.get(WIDGET_PARAMETERS[0]) ?? [0, 0];
  const quote = rawArgs[start];
  return (quote === '"' || quote === "'") && end - start >= 2
    ? [start + 1, rawArgs[end - 1] === quote ? end - 1 : end]
    : [start, end];
}

/**
 * The widgets that StoryInit and the passages tagged `widget` define, in
 * source order: the ones the runtime registers, read tolerantly (a half-typed
 * definition is still reported, without a `closeStart`). Definitions whose
 * arguments cannot be read are left out.
 *
 * The passages are read as flat tokens, which need no block macros to be
 * known, so a `{@children}` in an HTML comment or in a `{do}` body is text
 * here as it is to the parser, and does not make a block widget (#387). In
 * nested definitions, it belongs to the innermost.
 */
export function widgetDefinitions(
  passages: Iterable<WidgetPassage>,
  parametersOf: ParametersOf = registeredParameters,
): WidgetDefinition[] {
  const found: WidgetDefinition[] = [];
  for (const passage of passages) {
    if (passage.name !== 'StoryInit' && !passage.tags?.includes('widget')) {
      continue;
    }
    // The open definitions: their tags, and whether a slot was seen
    const open: { token: MacroToken; isBlock: boolean; closeStart?: number }[] =
      [];
    const done: typeof open = [];
    for (const token of tokenizeMarkupTolerant(passage.content).tokens) {
      if (token.type === 'macro' && token.name.toLowerCase() === 'widget') {
        if (!token.isClose) {
          open.push({ token, isBlock: false });
        } else {
          const def = open.pop();
          if (def) done.push({ ...def, closeStart: token.start });
        }
      } else if (
        open.length > 0 &&
        ((token.type === 'variable' &&
          token.scope === 'local' &&
          token.name === 'children') ||
          tokenTextContainsChildren(token, parametersOf, passage.content))
      ) {
        open[open.length - 1]!.isBlock = true;
      }
    }
    done.push(...open);
    const defs: WidgetDefinition[] = [];
    for (const { token, isBlock, closeStart } of done) {
      try {
        const [from, to] = nameSpan(token.rawArgs);
        defs.push({
          ...parseWidgetDef(token.rawArgs),
          block: isBlock,
          passage: passage.name,
          start: token.start,
          end: token.end,
          nameStart: token.argsStart + from,
          nameEnd: token.argsStart + to,
          ...(closeStart === undefined ? {} : { closeStart }),
        });
      } catch {
        // The {widget} macro reports a definition it cannot read
      }
    }
    found.push(...defs.sort((a, b) => a.start - b.start));
  }
  return found;
}

/**
 * The names of the block widgets (those whose body renders `{@children}`)
 * that StoryInit and the passages tagged `widget` define, closed. They must
 * be known as block macros before any passage is parsed, so that passages
 * invoking them nest their content whatever the passage order.
 */
export function blockWidgetNames(
  passages: Iterable<WidgetPassage>,
  parametersOf: ParametersOf = registeredParameters,
): string[] {
  return widgetDefinitions(passages, parametersOf)
    .filter((def) => def.block && def.closeStart !== undefined)
    .map((def) => def.name);
}
