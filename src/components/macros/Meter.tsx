import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

function parseArgs(rawArgs: string): {
  currentExpr: string;
  maxExpr: string;
  labelMode: string;
} {
  const trimmed = rawArgs.trim();

  // Extract quoted label mode from the end if present
  let labelMode = '';
  let rest = trimmed;
  const quoteMatch = rest.match(/\s+(?:"([^"]*)"|'([^']*)')$/);
  if (quoteMatch) {
    labelMode = quoteMatch[1] ?? quoteMatch[2] ?? '';
    rest = rest.slice(0, quoteMatch.index ?? rest.length).trim();
  }

  // Split remaining into two expressions.
  const exprs = splitExpressions(rest);
  if (exprs.length < 2) {
    throw new Error(
      'meter requires two arguments: {meter currentExpr maxExpr}',
    );
  }

  return {
    currentExpr: exprs[0]!,
    maxExpr: exprs.slice(1).join(' '),
    labelMode,
  };
}

function splitExpressions(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '(' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']') {
      depth--;
      current += ch;
    } else if (/\s/.test(ch) && depth === 0 && current.length > 0) {
      result.push(current);
      current = '';
      // Skip additional whitespace
      while (i + 1 < input.length && /\s/.test(input[i + 1]!)) i++;
    } else {
      current += ch;
    }
  }
  if (current.length > 0) result.push(current);
  return result;
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
      const { currentExpr, maxExpr, labelMode } = parseArgs(rawArgs);
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
