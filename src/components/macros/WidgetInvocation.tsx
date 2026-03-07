import {
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'preact/hooks';
import {
  LocalsValuesContext,
  LocalsUpdateContext,
  renderNodes,
} from '../../markup/render';
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

function WidgetBody({
  body,
  parentValues,
  ownKeys,
}: {
  body: ASTNode[];
  parentValues: Record<string, unknown>;
  ownKeys: Record<string, unknown>;
}) {
  const [localState, setLocalState] = useState<Record<string, unknown>>(() => ({
    ...parentValues,
    ...ownKeys,
  }));

  const valuesRef = useRef(localState);
  valuesRef.current = localState;

  const getValues = useCallback(() => valuesRef.current, []);
  const update = useCallback((key: string, value: unknown) => {
    setLocalState((prev) => ({ ...prev, [key]: value }));
  }, []);
  const updater = useMemo(() => ({ update, getValues }), [update, getValues]);

  return (
    <LocalsUpdateContext.Provider value={updater}>
      <LocalsValuesContext.Provider value={localState}>
        {renderNodes(body)}
      </LocalsValuesContext.Provider>
    </LocalsUpdateContext.Provider>
  );
}

export function WidgetInvocation({
  body,
  params,
  rawArgs,
}: WidgetInvocationProps) {
  const parentValues = useContext(LocalsValuesContext);
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  if (params.length === 0 || !rawArgs) {
    return <>{renderNodes(body)}</>;
  }

  const argExprs = splitArgs(rawArgs);
  const ownKeys: Record<string, unknown> = {};

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const expr = argExprs[i];
    let value: unknown;
    if (expr !== undefined) {
      try {
        value = evaluate(expr, mergedVars, mergedTemps, mergedLocals);
      } catch {
        value = undefined;
      }
    }
    ownKeys[param.startsWith('@') ? param.slice(1) : param] = value;
  }

  return (
    <WidgetBody
      body={body}
      parentValues={parentValues}
      ownKeys={ownKeys}
    />
  );
}
