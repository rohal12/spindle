import { evaluate } from '../../expression';
import { useMergedLocals } from '../../hooks/use-merged-locals';

interface MeterProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

/**
 * Parse rawArgs into currentExpr, maxExpr, and optional labelMode.
 * Supports: {meter $current $max}, {meter $current $max "%"}, etc.
 */
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
  // Expressions can contain dots, brackets, parens — we need to find the split point.
  // Strategy: walk tokens, splitting on whitespace that isn't inside parens/brackets.
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
  if (labelMode === '%') return `${max === 0 ? 0 : Math.round((current / max) * 100)}%`;
  if (labelMode) return `${current} ${labelMode} / ${max} ${labelMode}`;
  return `${current} / ${max}`;
}

export function Meter({ rawArgs, className, id }: MeterProps) {
  const [mergedVars, mergedTemps] = useMergedLocals();

  try {
    const { currentExpr, maxExpr, labelMode } = parseArgs(rawArgs);
    const current = Number(evaluate(currentExpr, mergedVars, mergedTemps));
    const max = Number(evaluate(maxExpr, mergedVars, mergedTemps));
    const pct = max === 0 ? 0 : Math.max(0, Math.min(100, (current / max) * 100));
    const label = formatLabel(current, max, labelMode);

    const classes = ['macro-meter', className].filter(Boolean).join(' ');

    return (
      <div
        class={classes}
        id={id}
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
      <span
        class="error"
        title={String(err)}
      >
        {`{meter error: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }
}
