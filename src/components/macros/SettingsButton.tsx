import { useState } from "preact/hooks";
import { settings } from "../../settings";
import { SettingsDialog } from "../SettingsDialog";

interface SettingsButtonProps {
  className?: string;
  id?: string;
}

export function SettingsButton({ className, id }: SettingsButtonProps) {
  const [open, setOpen] = useState(false);

  if (!settings.hasAny()) return null;

  const cls = className ? `menubar-button ${className}` : "menubar-button";

  return (
    <>
      <button id={id} class={cls} onClick={() => setOpen(true)}>
        ⚙ Settings
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}
