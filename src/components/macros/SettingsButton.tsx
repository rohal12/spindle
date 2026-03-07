import { useState } from 'preact/hooks';
import { settings } from '../../settings';
import { SettingsDialog } from '../SettingsDialog';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function SettingsButton({ className, id }: MacroProps) {
  const [open, setOpen] = useState(false);

  if (!settings.hasAny()) return null;

  const cls = className ? `menubar-button ${className}` : 'menubar-button';

  return (
    <>
      <button
        id={id}
        class={cls}
        onClick={() => setOpen(true)}
      >
        ⚙ Settings
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

registerMacro('settings', SettingsButton);
