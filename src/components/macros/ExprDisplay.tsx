import { useContext } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { LocalsValuesContext } from '../../markup/render';
import { useInterpolate } from '../../hooks/use-interpolate';

interface ExprDisplayProps {
  expression: string;
  className?: string;
  id?: string;
}

export function ExprDisplay({ expression, className, id }: ExprDisplayProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const localsValues = useContext(LocalsValuesContext);
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);

  let display: string;
  try {
    const value = evaluate(expression, variables, temporary, localsValues);
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
