import { defineMacro } from '../../define-macro';
import { readWholeQuoted, stripLooseQuotes } from './arg-utils';

function parseLabel(rawArgs: string): string {
  const match = rawArgs.match(/^\s*["']?\$?[\w.]+["']?\s+(.+?)\s*$/);
  if (!match) return '';
  const rest = match[1]!;
  return readWholeQuoted(rest) ?? stripLooseQuotes(rest);
}

defineMacro({
  name: 'checkbox',
  storeVar: true,
  render({ rawArgs }, ctx) {
    const label = parseLabel(rawArgs);

    ctx.useAction({
      type: 'checkbox',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: label || ctx.varName || '',
      variable: ctx.varName,
      value: !!ctx.value,
      perform: (v) => ctx.setValue!(v !== undefined ? !!v : !ctx.value),
    });

    return (
      <label
        id={ctx.id}
        class={ctx.cls}
      >
        <input
          type="checkbox"
          checked={!!ctx.value}
          onChange={() => ctx.setValue!(!ctx.value)}
        />
        {label ? ` ${label}` : null}
      </label>
    );
  },
});
