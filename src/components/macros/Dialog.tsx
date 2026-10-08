import { defineMacro } from '../../define-macro';
import { PassageDialog } from '../PassageDialog';

defineMacro({
  name: 'dialog',
  block: true,
  interpolate: true,
  parameters: [
    { name: 'label', type: 'text', holds: 'markup', required: true },
    { name: 'noclose', type: 'flag' },
  ],
  render({ children = [] }, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);

    const { noclose } = ctx.args;
    const label = ctx.resolve!(ctx.args.label ?? '');
    const passageName = ctx
      .collectText(children)
      .trim()
      .replace(/^["']|["']$/g, '');

    return (
      <>
        <button
          type="button"
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
            showCloseButton={!noclose}
          />
        )}
      </>
    );
  },
});
