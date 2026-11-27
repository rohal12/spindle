import { h } from 'preact';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';
import { defineMacro, type MacroContext } from '../../define-macro';
import {
  actionAttributes,
  useControlAction,
  type UseActionOptions,
} from '../../hooks/use-action';
import { display } from './display';

/** The story variable a `storeVar` macro binds: its first parameter. */
export const VARIABLE_PARAMETER = {
  name: 'variable',
  type: 'variable',
  required: true,
} as const;

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

type ResetReader = () => () => void;
const formResets = new WeakMap<
  HTMLFormElement,
  {
    readers: Set<ResetReader>;
    reset: (event: Event) => void;
  }
>();

/** Read every reset value before any binding write can trigger a rerender. */
function subscribeFormReset(
  form: HTMLFormElement,
  read: ResetReader,
): () => void {
  let subscription = formResets.get(form);
  if (!subscription) {
    const readers = new Set<ResetReader>();
    const reset = (event: Event) => {
      // Trusted reset events can run microtasks before their default action.
      // A task sees the native values and the final cancellation state.
      setTimeout(() => {
        if (event.defaultPrevented) return;
        const commits = Array.from(readers, (read) => read());
        for (const commit of commits) commit();
      }, 0);
    };
    subscription = { readers, reset };
    formResets.set(form, subscription);
    form.addEventListener('reset', subscription.reset);
  }
  const { readers, reset } = subscription;
  readers.add(read);
  return () => {
    readers.delete(read);
    if (readers.size === 0) {
      form.removeEventListener('reset', reset);
      formResets.delete(form);
    }
  };
}

/** Native defaults belong to the binding's initial rendered control value. */
function setResetDefault(control: FormControl): void {
  if (control.tagName === 'SELECT') {
    const options = Array.from((control as HTMLSelectElement).options);
    const selected = options.map((option) => option.selected);
    options.forEach((option, i) => (option.defaultSelected = selected[i]!));
  } else if (
    control.tagName === 'INPUT' &&
    ['checkbox', 'radio'].includes((control as HTMLInputElement).type)
  ) {
    (control as HTMLInputElement).defaultChecked = (
      control as HTMLInputElement
    ).checked;
  } else {
    (control as HTMLInputElement | HTMLTextAreaElement).defaultValue =
      control.value;
  }
}

/**
 * Register the automation action of a macro bound to a story variable: keyed
 * by the variable (or `key`), with the variable's value unless `action`
 * gives another.
 */
export function useVariableAction(
  ctx: Pick<MacroContext, 'id' | 'varName' | 'value' | 'setValue'>,
  action: Omit<UseActionOptions, 'key' | 'authorId' | 'variable'> & {
    key?: string;
  },
  onReset?: (control: FormControl) => unknown,
): ReturnType<typeof useControlAction> {
  const registered = useControlAction({
    key: `$${ctx.varName}`,
    authorId: ctx.id,
    variable: ctx.varName,
    value: ctx.value,
    ...action,
  });
  const control = useRef<FormControl | null>(null);
  const initialized = useRef<FormControl | null>(null);
  const resetValue = useRef({ read: onReset, set: ctx.setValue });
  resetValue.current = { read: onReset, set: ctx.setValue };
  const ref = useCallback(
    (element: Element | null) => {
      control.current = element as FormControl | null;
      registered.ref(element);
    },
    [registered.ref],
  );
  // Reattach after commits in case the control's form owner changed.
  useLayoutEffect(() => {
    const element = control.current;
    if (!element || !onReset) return;
    if (initialized.current !== element) {
      setResetDefault(element);
      initialized.current = element;
    }
    const form = element.form;
    if (!form) return;
    return subscribeFormReset(form, () => {
      const value = resetValue.current.read!(element);
      return () => {
        if (control.current === element && element.form === form)
          resetValue.current.set!(value);
      };
    });
  });
  return { ...registered, ref };
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
    interpolate: true,
    storeVar: true,
    parameters: [
      VARIABLE_PARAMETER,
      { name: 'placeholder', type: 'string', holds: 'text' },
    ],
    render(_props, ctx) {
      const { placeholder = '' } = ctx.args;

      // What the reader last typed. A number input reports an unfinished
      // number ("-", "2e") as an empty value, so the text is kept for as
      // long as it still converts to the variable's value, instead of being
      // replaced by that value on every keystroke (#353).
      const typed = ctx.hooks.useRef<string | null>(null);
      const shown =
        typed.current !== null &&
        toValue(typed.current) === ctx.value &&
        type === 'number'
          ? typed.current
          : display(ctx.value);

      const action = useVariableAction(
        ctx,
        {
          type: name,
          label: placeholder || ctx.varName!,
          perform: (v) => ctx.setValue!(toValue(v)),
        },
        (control) => {
          typed.current = control.value;
          return toValue(control.value);
        },
      );

      return h(type ? 'input' : 'textarea', {
        type,
        ...actionAttributes(action, ctx),
        value: shown,
        placeholder,
        onInput: (e: Event) => {
          const text = (e.target as HTMLInputElement).value;
          typed.current = text;
          ctx.setValue!(toValue(text));
        },
      });
    },
  });
}
