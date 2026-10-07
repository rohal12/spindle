import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

/** Check the arguments of `{meter currentExpr maxExpr ["label"]}`. */
export function meterArgs(args: {
  current?: string;
  max?: string;
  label?: string;
}): { currentExpr: string; maxExpr: string; labelMode: string } {
  if (args.current === undefined || args.max === undefined) {
    throw new Error(
      'meter requires two arguments: {meter currentExpr maxExpr}',
    );
  }
  return {
    currentExpr: args.current,
    maxExpr: args.max,
    labelMode: args.label ?? '',
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
  // {meter currentExpr maxExpr ["label"]}. A string after an operator
  // (`$a ?? "5"`) is an operand of the max expression, not the label.
  parameters: [
    { name: 'current', type: 'expression', required: true },
    { name: 'max', type: 'expression', required: true },
    { name: 'label', type: 'string', holds: 'markup' },
  ],
  render(_props, ctx) {
    try {
      const { currentExpr, maxExpr, labelMode } = meterArgs(ctx.args);
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
