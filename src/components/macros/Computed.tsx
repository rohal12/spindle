import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { readState } from '../../execute-mutation';
import { deepEqual } from '../../class-registry';
import { currentSourceLocation } from '../../utils/source-location';
import { defineMacro } from '../../define-macro';
import { MacroError } from './MacroError';
import { checkVariableName } from '../../utils/namespace';

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

      checkVariableName(target.slice(1), target);
      return { target, expr };
    }
  }

  throw new Error(
    `{computed}: expected "target = expression", got "${rawArgs}"`,
  );
}

/**
 * Evaluate `expr` against the current values — the store's state and the
 * enclosing locals scope's live values (`getLocals`) — and write the result
 * to the target if it changed. Reading live values rather than the render's
 * snapshot means the first computation sees a local a preceding {set} just
 * assigned (the scope's context value only catches up on its re-render), and
 * the first computation and later recomputations read the same source.
 */
function computeAndApply(
  expr: string,
  name: string,
  isTemp: boolean,
  isLocal: boolean,
  getLocals: () => Record<string, unknown>,
  rawArgs: string,
  prevRef: { current: unknown },
  localsUpdate: ((key: string, value: unknown) => void) | null,
): void {
  let newValue: unknown;
  try {
    // In program order, also when mutation code sets this off
    const { variables, temporary, transient } = readState();
    newValue = evaluate(expr, variables, temporary, getLocals(), transient);
  } catch (err) {
    console.error(
      `spindle: Error in {computed ${rawArgs}}${currentSourceLocation()}:`,
      err,
    );
    return;
  }

  if (!deepEqual(prevRef.current, newValue)) {
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
        ctx.getValues,
        rawArgs,
        prevOutput,
        localsUpdate,
      );
    }

    // The merged values only decide when to recompute; computeAndApply reads
    // the current ones.
    ctx.hooks.useLayoutEffect(() => {
      computeAndApply(
        expr,
        name,
        isTemp,
        isLocal,
        ctx.getValues,
        rawArgs,
        prevOutput,
        localsUpdate,
      );
    }, [mergedVars, mergedTemps, mergedLocals, mergedTrans]);

    return null;
  },
});
