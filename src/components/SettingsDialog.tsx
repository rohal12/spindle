import { useState } from "preact/hooks";
import { settings, type SettingDef } from "../settings";

interface SettingsDialogProps {
  onClose: () => void;
}

function SettingControl({ name, def }: { name: string; def: SettingDef }) {
  const [value, setValue] = useState(() => settings.get(name));

  const update = (newValue: unknown) => {
    setValue(newValue);
    settings.set(name, newValue);
  };

  switch (def.type) {
    case "toggle":
      return (
        <label class="settings-row">
          <span>{def.config.label}</span>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => update((e.target as HTMLInputElement).checked)}
          />
        </label>
      );

    case "list":
      return (
        <label class="settings-row">
          <span>{def.config.label}</span>
          <select
            value={String(value)}
            onChange={(e) => update((e.target as HTMLSelectElement).value)}
          >
            {def.config.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      );

    case "range":
      return (
        <label class="settings-row">
          <span>
            {def.config.label}: {String(value)}
          </span>
          <input
            type="range"
            min={def.config.min}
            max={def.config.max}
            step={def.config.step}
            value={Number(value)}
            onInput={(e) =>
              update(parseFloat((e.target as HTMLInputElement).value))
            }
          />
        </label>
      );
  }
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const defs = settings.getDefinitions();

  const handleBackdrop = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("settings-overlay")) {
      onClose();
    }
  };

  return (
    <div class="settings-overlay" onClick={handleBackdrop}>
      <div class="settings-panel">
        <div class="settings-header">
          <span>Settings</span>
          <button class="settings-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div class="settings-body">
          {Array.from(defs.entries()).map(([name, def]) => (
            <SettingControl key={name} name={name} def={def} />
          ))}
        </div>
      </div>
    </div>
  );
}
