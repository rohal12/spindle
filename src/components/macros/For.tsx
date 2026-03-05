import { useContext } from 'preact/hooks';
import { evaluate } from '../../expression';
import { LocalsContext, renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import type { ASTNode } from '../../markup/ast';

interface ForProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

/**
 * Parse for-loop args: "$item, $i of $list" or "$item of $list"
 */
function parseForArgs(rawArgs: string): {
  itemVar: string;
  indexVar: string | null;
  listExpr: string;
} {
  const ofIdx = rawArgs.indexOf(' of ');
  if (ofIdx === -1) {
    throw new Error(`{for} requires "of" keyword: {for ${rawArgs}}`);
  }

  const varsPart = rawArgs.slice(0, ofIdx).trim();
  const listExpr = rawArgs.slice(ofIdx + 4).trim();

  const vars = varsPart.split(',').map((v) => v.trim());
  const itemVar = vars[0]!;
  const indexVar = vars.length > 1 ? vars[1]! : null;

  return { itemVar, indexVar, listExpr };
}

export function For({ rawArgs, children, className, id }: ForProps) {
  const parentLocals = useContext(LocalsContext);
  const [mergedVars, mergedTemps] = useMergedLocals();

  let parsed: ReturnType<typeof parseForArgs>;
  try {
    parsed = parseForArgs(rawArgs);
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{for error: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }

  const { itemVar, indexVar, listExpr } = parsed;

  let list: unknown[];
  try {
    const result = evaluate(listExpr, mergedVars, mergedTemps);
    if (!Array.isArray(result)) {
      return (
        <span class="error">
          {`{for error: expression did not evaluate to an array}`}
        </span>
      );
    }
    list = result;
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{for error: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }

  const content = list.map((item, i) => {
    const locals = {
      ...parentLocals,
      [itemVar]: item,
      ...(indexVar ? { [indexVar]: i } : undefined),
    };

    return (
      <LocalsContext.Provider
        key={i}
        value={locals}
      >
        {renderNodes(children)}
      </LocalsContext.Provider>
    );
  });

  if (className || id)
    return (
      <span
        id={id}
        class={className}
      >
        {content}
      </span>
    );
  return <>{content}</>;
}
