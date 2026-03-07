import { useState } from 'preact/hooks';
import { SaveLoadDialog } from '../SaveLoadDialog';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Saves({ className, id }: MacroProps) {
  const [open, setOpen] = useState(false);
  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  return (
    <>
      <button
        id={id}
        class={cls}
        onClick={() => setOpen(true)}
      >
        Saves
      </button>
      {open && <SaveLoadDialog onClose={() => setOpen(false)} />}
    </>
  );
}

registerMacro('saves', Saves);
