import { useEffect, useId, useState } from 'preact/hooks';
import { settings, subscribeSettings, type SettingDef } from '../../settings';
import { defineMacro } from '../../define-macro';

function SettingRow({
  def,
  value,
  describedBy,
  update,
}: {
  def: SettingDef;
  value: unknown;
  describedBy: string | undefined;
  update: (value: unknown) => void;
}) {
  switch (def.type) {
    case 'toggle':
      return (
        <label class="settings-row">
          <span>{def.config.label}</span>
          <input
            type="checkbox"
            checked={!!value}
            aria-describedby={describedBy}
            onChange={(e) => update((e.target as HTMLInputElement).checked)}
          />
        </label>
      );

    case 'list':
      return (
        <label class="settings-row">
          <span>{def.config.label}</span>
          <select
            value={String(value)}
            aria-describedby={describedBy}
            onChange={(e) => update((e.target as HTMLSelectElement).value)}
          >
            {def.config.options.map((opt) => (
              <option
                key={opt}
                value={opt}
              >
                {opt}
              </option>
            ))}
          </select>
        </label>
      );

    case 'range':
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
            aria-describedby={describedBy}
            onInput={(e) =>
              update(parseFloat((e.target as HTMLInputElement).value))
            }
          />
        </label>
      );
  }
}

function SettingControl({ name, def }: { name: string; def: SettingDef }) {
  const [value, setValue] = useState(() => settings.get(name));
  const descriptionId = useId();
  // Plain text, never markup. No description, no element.
  const text = def.config.description;
  const description = typeof text === 'string' && text !== '' ? text : null;

  // Follow changes made elsewhere: Story.settings.set(), another view
  useEffect(() => {
    const sync = () => setValue(settings.get(name));
    sync();
    return subscribeSettings(sync);
  }, [name]);

  const update = (newValue: unknown) => settings.set(name, newValue);

  const row = (
    <SettingRow
      def={def}
      value={value}
      describedBy={description === null ? undefined : descriptionId}
      update={update}
    />
  );
  if (description === null) return row;

  return (
    <div class="settings-item">
      {row}
      <p
        id={descriptionId}
        class="settings-description"
      >
        {description}
      </p>
    </div>
  );
}

function SettingsControlsContent({
  className,
  id,
}: {
  className?: string;
  id?: string;
}) {
  const defs = settings.getDefinitions();

  return (
    <div
      id={id}
      class={className ? `settings-controls ${className}` : 'settings-controls'}
    >
      {Array.from(defs.entries()).map(([name, def]) => (
        <SettingControl
          key={name}
          name={name}
          def={def}
        />
      ))}
    </div>
  );
}

defineMacro({
  name: 'settings-controls',
  interpolate: true,
  render(_props, ctx) {
    return (
      <SettingsControlsContent
        className={ctx.className}
        id={ctx.id}
      />
    );
  },
});
