import { useStoryStore } from "../../store";
import { useContext } from "preact/hooks";
import { evaluate } from "../../expression";
import { LocalsContext } from "../../markup/render";

interface PrintProps {
  rawArgs: string;
  className?: string;
  id?: string;
}

export function Print({ rawArgs, className, id }: PrintProps) {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const locals = useContext(LocalsContext);

  // Merge locals into variables for expression evaluation
  const mergedVars = { ...variables };
  const mergedTemps = { ...temporary };
  for (const [key, val] of Object.entries(locals)) {
    if (key.startsWith("$")) mergedVars[key.slice(1)] = val;
    else if (key.startsWith("_")) mergedTemps[key.slice(1)] = val;
  }

  try {
    const result = evaluate(rawArgs, mergedVars, mergedTemps);
    const display = result == null ? "" : String(result);
    if (className || id) return <span id={id} class={className}>{display}</span>;
    return <>{display}</>;
  } catch (err) {
    return (
      <span class="error" title={String(err)}>
        {`{print error: ${(err as Error).message}}`}
      </span>
    );
  }
}
