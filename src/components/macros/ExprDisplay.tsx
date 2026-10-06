import { evaluate } from '../../expression';
import { useInterpolate } from '../../hooks/use-interpolate';
import { useMergedLocals } from '../../hooks/use-merged-locals';

interface ExprDisplayProps {
  expression: string;
  className?: string;
  id?: string;
}

export function ExprDisplay({ expression, className, id }: ExprDisplayProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const [variables, temporary, localsValues, transient] = useMergedLocals();

  let display: string;
  try {
    const value = evaluate(
      expression,
      variables,
      temporary,
      localsValues,
      transient,
    );
    display = value == null ? '' : String(value);
  } catch {
    display = `{error: ${expression}}`;
  }

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
}
