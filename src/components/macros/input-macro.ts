import { h } from 'preact';
import { defineMacro, type MacroContext } from '../../define-macro';
import type { UseActionOptions } from '../../hooks/use-action';
import { display } from './display';

/** The story variable a `storeVar` macro binds: its first parameter. */
export const VARIABLE_PARAMETER = {
  name: 'variable',
  type: 'variable',
  required: true,
} as const;

/**
 * Register the automation action of a macro bound to a story variable: keyed
 * by the variable (or `key`), with the variable's value unless `action`
 * gives another.
 */
export function useVariableAction(
  ctx: Pick<MacroContext, 'useAction' | 'id' | 'varName' | 'value'>,
  action: Omit<UseActionOptions, 'key' | 'authorId' | 'variable'> & {
    key?: string;
  },
): string {
  return ctx.useAction({
    key: `$${ctx.varName}`,
    authorId: ctx.id,
    variable: ctx.varName,
    value: ctx.value,
    ...action,
  });
}

/**
 * Define a text input macro, `{name $var "placeholder"}`: an `<input>` of
 * `type` (or, without one, a `<textarea>`) bound to the story variable.
 * `toValue` turns what the reader types, or an automation action's value
 * (`undefined` when it has none), into the variable's value: by default,
 * the text.
 */
export function defineInputMacro(
  name: 'textbox' | 'numberbox' | 'textarea',
  type?: 'text' | 'number',
  toValue = (input: unknown): unknown =>
    input !== undefined ? String(input) : '',
): void {
  defineMacro({
    name,
    storeVar: true,
    parameters: [VARIABLE_PARAMETER, { name: 'placeholder', type: 'string' }],
    render(_props, ctx) {
      const placeholder = ctx.args.placeholder ?? '';

      useVariableAction(ctx, {
        type: name,
        label: placeholder || ctx.varName!,
        perform: (v) => ctx.setValue!(toValue(v)),
      });

      return h(type ? 'input' : 'textarea', {
        type,
        id: ctx.id,
        class: ctx.cls,
        value: display(ctx.value),
        placeholder,
        onInput: (e: Event) =>
          ctx.setValue!(toValue((e.target as HTMLInputElement).value)),
      });
    },
  });
}
