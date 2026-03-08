import { defineMacro } from '../../define-macro';
import { PassageDialog } from '../PassageDialog';

defineMacro({
  name: 'dialog',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);

    const label = ctx.resolve?.(rawArgs.replace(/^["']|["']$/g, '')) ?? rawArgs;
    const passageName = ctx
      .collectText(children)
      .trim()
      .replace(/^["']|["']$/g, '');

    return (
      <>
        <button
          id={ctx.id}
          class={ctx.cls}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
        {open && (
          <PassageDialog
            passageName={passageName}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  },
});
