import { evaluate } from '../../expression';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { currentSourceLocation } from '../../utils/source-location';

interface PrintProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

export function Print({ rawArgs, className, id }: PrintProps) {
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
