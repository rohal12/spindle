import { defineMacro } from '../../define-macro';
import {
  isWhitespace,
  readQuoted,
  readWholeQuoted,
  stripLooseQuotes,
} from './arg-utils';

function parseRadioArgs(rawArgs: string): { value: string; label: string } {
  // $var "value" label: a quoted value accepts \" \' and \\ escapes and
  // may contain the other quote kind.
  const head = rawArgs.match(/^\s*["']?\$?[\w.]+["']?\s+/);
  if (head) {
    const rest = rawArgs.slice(head[0].length).trim();
    const value = readQuoted(rest, 0);
    if (
      value &&
      (value.end === rest.length || isWhitespace(rest[value.end]!))
    ) {
      const labelRaw = rest.slice(value.end).trim();
      const label = readWholeQuoted(labelRaw) ?? stripLooseQuotes(labelRaw);
      return { value: value.value, label };
    }
  }

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
