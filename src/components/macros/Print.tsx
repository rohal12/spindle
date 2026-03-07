import { evaluate } from '../../expression';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { currentSourceLocation } from '../../utils/source-location';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Print({ rawArgs, className, id }: MacroProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  try {
    const result = evaluate(rawArgs, mergedVars, mergedTemps, mergedLocals);
    const display = result == null ? '' : String(result);
    if (className || id)
      return (
        <span
          id={id}
          class={className}
        >
          {display}
        </span>
      );
    return <>{display}</>;
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{print error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }
}

registerMacro('print', Print);
