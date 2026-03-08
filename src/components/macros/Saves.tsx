import { SaveLoadDialog } from '../SaveLoadDialog';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'saves',
  render(_, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);
    const cls = ctx.className
      ? `menubar-button ${ctx.className}`
      : 'menubar-button';

    return (
      <>
        <button
          id={ctx.id}
          class={cls}
          onClick={() => setOpen(true)}
        >
          Saves
        </button>
        {open && <SaveLoadDialog onClose={() => setOpen(false)} />}
      </>
    );
  },
});
