import { useState } from 'preact/hooks';
import { SaveLoadDialog } from '../SaveLoadDialog';

interface SavesProps {
  className?: string;
  id?: string;
}

export function Saves({ className, id }: SavesProps) {
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
