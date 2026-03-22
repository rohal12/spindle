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
  NobrContext,
  WidgetChildrenContext,
  renderNodes,
} from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { evaluate } from '../../expression';
import type { ASTNode } from '../../markup/ast';

interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
  invocationChildren?: ASTNode[];
}

/**
 * Try to split a raw string into adjacent quoted string literals separated by
 * whitespace. Returns the individual quoted strings if the entire input is
 * consumed, or `null` if any non-quote/non-whitespace content is found.
 */
function trySplitAdjacentQuotes(raw: string): string[] | null {
  const args: string[] = [];
  let i = 0;

  while (i < raw.length) {
    // skip whitespace between quoted strings
    while (i < raw.length && /\s/.test(raw[i]!)) i++;
    if (i >= raw.length) break;

    const quote = raw[i]!;
    if (quote !== '"' && quote !== "'") return null;

    // consume the quoted string
    let str = quote;
    i++;
    while (i < raw.length) {
      const ch = raw[i]!;
      str += ch;
      i++;
      if (ch === quote && raw[i - 2] !== '\\') break;
    }

    // must be properly closed
    if (str.length < 2 || str[str.length - 1] !== quote) return null;

    args.push(str);
  }

  // only use this path when there are 2+ adjacent quoted strings
  return args.length > 1 ? args : null;
}

/**
 * Split rawArgs by commas, respecting parentheses, brackets, braces, and
 * strings. When no top-level commas are present, also supports adjacent quoted
 * string literals separated by whitespace (e.g. `"Label" "target"`).
 */
export function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let inString: string | null = null;
  let hasComma = false;

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
      hasComma = true;
      args.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  const last = current.trim();
  if (last) args.push(last);

  // If no commas were found and we got a single expression, try splitting
  // it as adjacent quoted string literals (e.g. "Label" "target").
  if (!hasComma && args.length === 1) {
    const quoted = trySplitAdjacentQuotes(args[0]!);
    if (quoted) return quoted;
  }

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
  const nobr = useContext(NobrContext);
  const [localMutations, setLocalMutations] = useState<Record<string, unknown>>(
    {},
  );

  // Recomputed every render — picks up new ownKeys from parent
  const localState = { ...parentValues, ...ownKeys, ...localMutations };

  const valuesRef = useRef(localState);
  valuesRef.current = localState;

  const getValues = useCallback(() => valuesRef.current, []);
  const update = useCallback((key: string, value: unknown) => {
    setLocalMutations((prev) => ({ ...prev, [key]: value }));
  }, []);
  const updater = useMemo(() => ({ update, getValues }), [update, getValues]);

  return (
    <LocalsUpdateContext.Provider value={updater}>
      <LocalsValuesContext.Provider value={localState}>
        {renderNodes(body, { nobr, locals: localState })}
      </LocalsValuesContext.Provider>
    </LocalsUpdateContext.Provider>
  );
}

export function WidgetInvocation({
  body,
  params,
  rawArgs,
  invocationChildren,
}: WidgetInvocationProps) {
  const parentValues = useContext(LocalsValuesContext);
  const nobr = useContext(NobrContext);
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  const childrenValue = invocationChildren?.length ? invocationChildren : null;

  if (params.length === 0 || !rawArgs) {
    return (
      <WidgetChildrenContext.Provider value={childrenValue}>
        {renderNodes(body, { nobr, locals: parentValues })}
      </WidgetChildrenContext.Provider>
    );
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
    <WidgetChildrenContext.Provider value={childrenValue}>
      <WidgetBody
        body={body}
        parentValues={parentValues}
        ownKeys={ownKeys}
      />
    </WidgetChildrenContext.Provider>
  );
}
