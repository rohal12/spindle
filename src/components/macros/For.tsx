import { useStoryStore } from "../../store";
import { useContext } from "preact/hooks";
import { evaluate } from "../../expression";
import { LocalsContext } from "../../markup/render";
import { renderNodes } from "../../markup/render";
import type { ASTNode } from "../../markup/ast";

interface ForProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
}

/**
 * Parse for-loop args: "$item, $i of $list" or "$item of $list"
 */
function parseForArgs(rawArgs: string): {
  itemVar: string;
  indexVar: string | null;
  listExpr: string;
} {
  const ofIdx = rawArgs.indexOf(" of ");
  if (ofIdx === -1) {
    throw new Error(`{for} requires "of" keyword: {for ${rawArgs}}`);
  }

  const varsPart = rawArgs.slice(0, ofIdx).trim();
  const listExpr = rawArgs.slice(ofIdx + 4).trim();

  const vars = varsPart.split(",").map((v) => v.trim());
  const itemVar = vars[0];
  const indexVar = vars.length > 1 ? vars[1] : null;

  return { itemVar, indexVar, listExpr };
}

export function For({ rawArgs, children, className }: ForProps) {
  const variables = useStoryStore((s) => s.variables);
  const temporary = useStoryStore((s) => s.temporary);
  const parentLocals = useContext(LocalsContext);

  // Merge parent locals for expression evaluation
  const mergedVars = { ...variables };
  const mergedTemps = { ...temporary };
  for (const [key, val] of Object.entries(parentLocals)) {
    if (key.startsWith("$")) mergedVars[key.slice(1)] = val;
    else if (key.startsWith("_")) mergedTemps[key.slice(1)] = val;
  }

  let parsed: ReturnType<typeof parseForArgs>;
  try {
    parsed = parseForArgs(rawArgs);
  } catch (err) {
    return (
      <span class="error" title={String(err)}>
        {`{for error: ${(err as Error).message}}`}
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
      <span class="error" title={String(err)}>
        {`{for error: ${(err as Error).message}}`}
      </span>
    );
  }

  const content = list.map((item, i) => {
    const locals = { ...parentLocals, [itemVar]: item };
    if (indexVar) locals[indexVar] = i;

    return (
      <LocalsContext.Provider key={i} value={locals}>
        {renderNodes(children)}
      </LocalsContext.Provider>
    );
  });

  if (className) return <span class={className}>{content}</span>;
  return <>{content}</>;

}
