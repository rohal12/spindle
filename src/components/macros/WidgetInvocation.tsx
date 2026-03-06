import { useContext } from 'preact/hooks';
import { LocalsContext, renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { evaluate } from '../../expression';
import type { ASTNode } from '../../markup/ast';

interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
}

/**
 * Split rawArgs by commas, respecting parentheses, brackets, braces, and strings.
 */
function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let inString: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;

    if (inString) {
      current += ch;
      if (ch === inString && raw[i - 1] !== '\\') inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
      continue;
    }

    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  const last = current.trim();
  if (last) args.push(last);
  return args;
}

export function WidgetInvocation({
  body,
  params,
  rawArgs,
}: WidgetInvocationProps) {
  const parentLocals = useContext(LocalsContext);
  const [mergedVars, mergedTemps] = useMergedLocals();

  if (params.length === 0 || !rawArgs) {
    return <>{renderNodes(body)}</>;
  }

  const argExprs = splitArgs(rawArgs);
  const locals: Record<string, unknown> = { ...parentLocals };

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const expr = argExprs[i];
    let value: unknown;
    if (expr !== undefined) {
      try {
        value = evaluate(expr, mergedVars, mergedTemps);
      } catch {
        value = undefined;
      }
    }
    locals[param] = value;
  }

  return (
    <LocalsContext.Provider value={locals}>
      {renderNodes(body)}
    </LocalsContext.Provider>
  );
}
