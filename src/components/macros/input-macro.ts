import { h } from 'preact';
import { defineMacro } from '../../define-macro';

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
    parameters: [
      { name: 'variable', type: 'variable', required: true },
      { name: 'placeholder', type: 'string' },
    ],
    render(_props, ctx) {
      const placeholder = ctx.args.placeholder ?? '';

      ctx.useAction({
        type: name,
        key: `$${ctx.varName}`,
        authorId: ctx.id,
        label: placeholder || ctx.varName!,
        variable: ctx.varName,
        value: ctx.value,
        perform: (v) => ctx.setValue!(toValue(v)),
      });

      return h(type ? 'input' : 'textarea', {
        type,
        id: ctx.id,
        class: ctx.cls,
        value: ctx.value == null ? '' : String(ctx.value),
        placeholder,
        onInput: (e: Event) =>
          ctx.setValue!(toValue((e.target as HTMLInputElement).value)),
      });
    },
  });
}
