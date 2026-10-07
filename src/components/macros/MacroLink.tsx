import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { useDetachedBody } from './detached-body';
import { evaluatePassageName } from './macro-args';
import { MacroError } from './MacroError';

defineMacro({
  name: 'link',
  block: true,
  interpolate: true,
  merged: true,
  // {link "text" passage} or {link "text"}; the passage is a quoted name or
  // an expression, as in {goto}.
  parameters: [
    { name: 'text', type: 'string', holds: 'markup', required: true },
    { name: 'passage', type: 'passage' },
  ],
  render({ children = [] }, ctx) {
    // The label is markup: resolved once, for the element and its action
    const display = ctx.resolve?.(ctx.args.text ?? '') ?? '';
    let passage: string | null = null;
    // Boxed: anything can be thrown, including null and other falsy values
    let failure: { error: unknown } | undefined;
    if (ctx.args.passage !== undefined) {
      try {
        passage = evaluatePassageName(
          ctx.args.passage,
          ctx.evaluate!,
          useStoryStore.getState(),
        );
      } catch (error) {
        failure = { error };
      }
    }
    const runBody = useDetachedBody();

    const perform = () => {
      // A link that failed to resolve is an error, not a control
      if (failure) return;
      runBody(children);
      if (passage) {
        useStoryStore.getState().navigate(passage);
      }
    };

    const handleClick = (e: Event) => {
      e.preventDefault();
      perform();
    };

    ctx.useAction({
      type: 'link',
      key: passage || display,
      authorId: ctx.id,
      label: display,
      target: passage ?? undefined,
      disabled: failure ? true : undefined,
      perform,
    });

    if (failure) {
      return (
        <MacroError
          macro="link"
          error={failure.error}
        />
      );
    }
    return (
      <a
        id={ctx.id}
        class={ctx.cls}
        href="#"
        onClick={handleClick}
      >
        {display}
      </a>
    );
  },
});
