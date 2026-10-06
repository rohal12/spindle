import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import { isWhitespace, readWholeQuoted, splitTopLevel } from './arg-utils';

/**
 * Parse `{meter currentExpr maxExpr ["label"]}`. Arguments are separated by
 * whitespace outside string and template literals and bracket pairs; a
 * trailing standalone `"…"` or `'…'` string is the label mode, with `\"`,
 * `\'` and `\\` escapes.
 */
export function parseMeterArgs(rawArgs: string): {
  currentExpr: string;
  maxExpr: string;
  labelMode: string;
} {
  const tokens = splitTopLevel(rawArgs.trim(), isWhitespace).filter(Boolean);

  let labelMode = '';
  const label =
    tokens.length >= 2 ? readWholeQuoted(tokens[tokens.length - 1]!) : null;
  if (label !== null) {
    labelMode = label;
    tokens.pop();
  }

  if (tokens.length < 2) {
    throw new Error(
      'meter requires two arguments: {meter currentExpr maxExpr}',
    );
  }

  return {
    currentExpr: tokens[0]!,
    maxExpr: tokens.slice(1).join(' '),
    labelMode,
  };
}

function formatLabel(
  current: number,
  max: number,
  labelMode: string,
): string | null {
  if (labelMode === 'none') return null;
  if (labelMode === '%')
    return `${max === 0 ? 0 : Math.round((current / max) * 100)}%`;
  if (labelMode) return `${current} ${labelMode} / ${max} ${labelMode}`;
  return `${current} / ${max}`;
}

defineMacro({
  name: 'meter',
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    try {
      const { currentExpr, maxExpr, labelMode } = parseMeterArgs(rawArgs);
      const current = Number(ctx.evaluate!(currentExpr));
      const max = Number(ctx.evaluate!(maxExpr));
      const pct =
        max === 0 ? 0 : Math.max(0, Math.min(100, (current / max) * 100));
      const label = formatLabel(current, max, labelMode);

      const classes = ctx.cls;

      return (
        <div
          class={classes}
          id={ctx.id}
        >
          <div
            class="macro-meter-fill"
            style={`width: ${pct}%`}
          />
          {label != null && <span class="macro-meter-label">{label}</span>}
        </div>
      );
    } catch (err) {
      return (
        <MacroError
          macro="meter"
          error={err}
        />
      );
    }
  },
});
