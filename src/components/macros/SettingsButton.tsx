import { settings } from '../../settings';
import { SettingsDialog } from '../SettingsDialog';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'settings',
  render(_, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);

    if (!settings.hasAny()) return null;

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
          ⚙ Settings
        </button>
        {open && <SettingsDialog onClose={() => setOpen(false)} />}
      </>
    );
  },
});
