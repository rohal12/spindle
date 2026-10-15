import { actionAttributes } from '../../hooks/use-action';
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
  render({ rawArgs, children = [] }, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);

    const { noclose } = ctx.args;
    const label = ctx.resolve!(ctx.args.label ?? '') ?? '';
    const passageName = ctx
      .collectText(children)
      .trim()
      .replace(/^["']|["']$/g, '');
    const openDialog = () => setOpen(true);

    // Its own type: the menubar's Saves and Settings are `dialog` (#540)
    const actionId = ctx.useAction({
      type: 'open-dialog',
      key: rawArgs,
      authorId: ctx.id,
      label,
      target: passageName,
      perform: openDialog,
    });

    return (
      <>
        <button
          type="button"
          {...actionAttributes(actionId, ctx)}
          onClick={openDialog}
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
