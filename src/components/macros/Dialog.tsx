import { defineMacro } from '../../define-macro';
import { PassageDialog } from '../PassageDialog';

defineMacro({
  name: 'dialog',
  merged: true,
  render({ rawArgs, children = [] }, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);

    let passageName: string;
    try {
      const result = ctx.evaluate!(rawArgs);
      passageName = String(result);
    } catch {
      passageName = rawArgs.replace(/^["']|["']$/g, '').trim();
    }

    const label = children.length
      ? ctx.renderInlineNodes(children)
      : passageName;

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
