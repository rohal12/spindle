import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { currentSourceLocation } from '../../utils/source-location';
import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';

function parseComputedArgs(rawArgs: string): { target: string; expr: string } {
  const trimmed = rawArgs.trim();

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

      if (!target.match(/^[$_@]\w+$/)) {
        throw new Error(
          `{computed}: target must be $name, _name, or @name, got "${target}"`,
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

function computeAndApply(
  expr: string,
  name: string,
  isTemp: boolean,
  isLocal: boolean,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown>,
  rawArgs: string,
  prevRef: { current: unknown },
  localsUpdate: ((key: string, value: unknown) => void) | null,
): void {
  let newValue: unknown;
  try {
    newValue = evaluate(expr, variables, temporary, locals, transient);
  } catch (err) {
    console.error(
      `spindle: Error in {computed ${rawArgs}}${currentSourceLocation()}:`,
      err,
    );
    return;
  }

  if (!valuesEqual(prevRef.current, newValue)) {
    prevRef.current = newValue;
    if (isLocal) {
      try {
        localsUpdate!(name, newValue);
      } catch (err) {
        console.error(
          `spindle: Error in {computed ${rawArgs}}${currentSourceLocation()}:`,
          err,
        );
      }
    } else {
      const state = useStoryStore.getState();
      if (isTemp) state.setTemporary(name, newValue);
      else state.setVariable(name, newValue);
    }
  }
}

defineMacro({
  name: 'computed',
  merged: true,
  render({ rawArgs }, ctx) {
    const [mergedVars, mergedTemps, mergedLocals, mergedTrans] = ctx.merged!;

    let target: string;
    let expr: string;
    try {
      ({ target, expr } = parseComputedArgs(rawArgs));
    } catch (err) {
      return (
        <MacroError
          macro="computed"
          error={err}
        />
      );
    }
    const isLocal = target.startsWith('@');
    const isTemp = target.startsWith('_');
    const name = target.slice(1);
    const localsUpdate = isLocal ? ctx.update : null;

    const prevOutput = ctx.hooks.useRef<unknown>(undefined);

    const ran = ctx.hooks.useRef(false);
    if (!ran.current) {
      ran.current = true;
      computeAndApply(
        expr,
        name,
        isTemp,
        isLocal,
        mergedVars,
        mergedTemps,
        mergedLocals,
        mergedTrans,
        rawArgs,
        prevOutput,
        localsUpdate,
      );
    }

    ctx.hooks.useLayoutEffect(() => {
      computeAndApply(
        expr,
        name,
        isTemp,
        isLocal,
        mergedVars,
        mergedTemps,
        mergedLocals,
        mergedTrans,
        rawArgs,
        prevOutput,
        localsUpdate,
      );
    }, [mergedVars, mergedTemps, mergedLocals, mergedTrans]);

    return null;
  },
});
