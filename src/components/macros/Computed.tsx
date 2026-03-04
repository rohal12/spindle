import { useLayoutEffect } from 'preact/hooks';
import { useContext } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { LocalsContext } from '../../markup/render';

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
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function Computed({ rawArgs }: ComputedProps) {
  // Subscribe to trigger re-renders when store changes
  useStoryStore((s) => s.variables);
  useStoryStore((s) => s.temporary);
  const locals = useContext(LocalsContext);

  const { target, expr } = parseComputedArgs(rawArgs);
  const isTemp = target.startsWith('_');
  const name = target.slice(1);

  // Evaluate in useLayoutEffect so preceding {set} effects have already run
  useLayoutEffect(() => {
    const state = useStoryStore.getState();

    // Merge locals from for-loops
    const mergedVars = { ...state.variables };
    const mergedTemps = { ...state.temporary };
    for (const [key, val] of Object.entries(locals)) {
      if (key.startsWith('$')) mergedVars[key.slice(1)] = val;
      else if (key.startsWith('_')) mergedTemps[key.slice(1)] = val;
    }

    let newValue: unknown;
    try {
      newValue = evaluate(expr, mergedVars, mergedTemps);
    } catch (err) {
      console.error(`spindle: Error in {computed ${rawArgs}}:`, err);
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
