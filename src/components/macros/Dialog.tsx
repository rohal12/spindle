import { defineMacro } from '../../define-macro';
import { PassageDialog } from '../PassageDialog';
import { readWholeQuoted } from './arg-utils';

defineMacro({
  name: 'dialog',
  block: true,
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const [open, setOpen] = ctx.hooks.useState(false);

    const noclose = /\bnoclose\s*$/.test(rawArgs);
    const labelRaw = rawArgs.replace(/\bnoclose\s*$/, '').trim();
    const label =
      ctx.resolve?.(
        readWholeQuoted(labelRaw) ?? labelRaw.replace(/^["']|["']$/g, ''),
      ) ?? labelRaw;
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
            showCloseButton={!noclose}
          />
        )}
      </>
    );
  },
});
