import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { readState } from '../../execute-mutation';
import { deepEqual } from '../../class-registry';
import { defineMacro } from '../../define-macro';
import { MacroError, logMacroError } from './MacroError';
import { checkVariableName } from '../../utils/namespace';

/**
 * The previous output before the first successful evaluation. Distinct from
 * every value an expression can produce, so the first result is always
 * applied, even `undefined`; a first evaluation that throws leaves it unset.
 */
const UNSET: unique symbol = Symbol('unset');

/** Check the arguments of "target = expression". */
function assignmentArgs(
  rawArgs: string,
  args: { target?: string; '=': boolean; expression?: string },
): { target: string; expr: string } {
  if (!args['=']) {
    throw new Error(
      `{computed}: expected "target = expression", got "${rawArgs}"`,
    );
  }

  const { target = '', expression: expr = '' } = args;
  if (!target.match(/^[$_@]\w+$/)) {
    throw new Error(
      `{computed}: target must be $name, _name, or @name, got "${target}"`,
    );
  }

  checkVariableName(target.slice(1), target);
  return { target, expr };
}

/**
 * Evaluate `expr` against the current values — the store's state and the
 * enclosing locals scope's live values (`getLocals`) — and write the result
 * to the target if it differs from the previous output (always, the first
 * time). Reading live values rather than the render's snapshot means the
 * first computation sees a local a preceding {set} just assigned (the scope's
 * context value only catches up on its re-render), and the first computation
 * and later recomputations read the same source.
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
    logMacroError(`computed ${rawArgs}`, err);
    return;
  }

  if (!deepEqual(prevRef.current, newValue)) {
    prevRef.current = newValue;
    if (isLocal) {
      try {
        localsUpdate!(name, newValue);
      } catch (err) {
        logMacroError(`computed ${rawArgs}`, err);
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
  parameters: [
    { name: 'target', type: 'variable', required: true },
    { name: '=', type: 'separator' },
    { name: 'expression', type: 'expression', required: true },
  ],
  render({ rawArgs }, ctx) {
    const [mergedVars, mergedTemps, mergedLocals, mergedTrans] = ctx.merged!;

    let target: string;
    let expr: string;
    try {
      ({ target, expr } = assignmentArgs(rawArgs, ctx.args));
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

    const prevOutput = ctx.hooks.useRef<unknown>(UNSET);

    const compute = () =>
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

    const ran = ctx.hooks.useRef(false);
    if (!ran.current) {
      ran.current = true;
      compute();
    }

    // The merged values only decide when to recompute; computeAndApply reads
    // the current ones.
    ctx.hooks.useLayoutEffect(compute, [
      mergedVars,
      mergedTemps,
      mergedLocals,
      mergedTrans,
    ]);

    return null;
  },
});
