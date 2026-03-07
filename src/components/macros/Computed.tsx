import { useLayoutEffect } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { currentSourceLocation } from '../../utils/source-location';

interface ComputedProps {
  rawArgs: string;
}

function parseComputedArgs(rawArgs: string): { target: string; expr: string } {
  const trimmed = rawArgs.trim();

  // Find the first '=' that isn't part of '==' or '!='
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === '=' && depth === 0) {
      if (trimmed[i + 1] === '=') {
        i++;
        continue;
      }
      if (i > 0 && trimmed[i - 1] === '!') continue;

      const target = trimmed.slice(0, i).trim();
      const expr = trimmed.slice(i + 1).trim();

      if (!target.match(/^[$_]\w+$/)) {
        throw new Error(
          `{computed}: target must be $name or _name, got "${target}"`,
        );
      }

      return { target, expr };
    }
  }

  throw new Error(
    `{computed}: expected "target = expression", got "${rawArgs}"`,
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function Computed({ rawArgs }: ComputedProps) {
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  let target: string;
  let expr: string;
  try {
    ({ target, expr } = parseComputedArgs(rawArgs));
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{computed error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }
  const isTemp = target.startsWith('_');
  const name = target.slice(1);

  // Evaluate in useLayoutEffect so preceding {set} effects have already run
  useLayoutEffect(() => {
    const state = useStoryStore.getState();

    let newValue: unknown;
    try {
      newValue = evaluate(expr, mergedVars, mergedTemps, mergedLocals);
    } catch (err) {
      console.error(
        `spindle: Error in {computed ${rawArgs}}${currentSourceLocation()}:`,
        err,
      );
      return;
    }

    const current = isTemp ? state.temporary[name] : state.variables[name];

    if (!valuesEqual(current, newValue)) {
      if (isTemp) {
        state.setTemporary(name, newValue);
      } else {
        state.setVariable(name, newValue);
      }
    }
  });

  return null;
}
