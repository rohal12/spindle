import { defineMacro } from '../../define-macro';

function parseRadioArgs(rawArgs: string): { value: string; label: string } {
  const match = rawArgs.match(
    /^\s*["']?\$?[\w.]+["']?\s+["'](.+?)["']\s+["']?(.+?)["']?\s*$/,
  );
  if (!match) {
    const parts = rawArgs.trim().split(/\s+/).slice(1);
    return { value: parts[0] ?? '', label: parts.slice(1).join(' ') };
  }
  return { value: match[1]!, label: match[2]! };
}

defineMacro({
  name: 'radiobutton',
  storeVar: true,
  render({ rawArgs }, ctx) {
    const { value: radioValue, label } = parseRadioArgs(rawArgs);

    ctx.useAction({
      type: 'radiobutton',
      key: `$${ctx.varName}:${radioValue}`,
      authorId: ctx.id,
      label: label || radioValue,
      variable: ctx.varName,
      value: ctx.value,
      perform: () => ctx.setValue!(radioValue),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="radio"
          name={`radio-${ctx.varName}`}
          checked={ctx.value === radioValue}
          onChange={() => ctx.setValue!(radioValue)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
