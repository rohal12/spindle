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
  InlineContext,
  WidgetChildrenContext,
  renderNodes,
} from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { evaluate } from '../../expression';
import type { ASTNode } from '../../markup/ast';
import { endsWithOperator, isWhitespace, splitTopLevel } from './arg-utils';

interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
  invocationChildren?: ASTNode[];
}

/**
 * Check whether a whitespace-delimited token looks like a standalone value
 * (not an operator or partial expression): it starts like a value and does
 * not end with an operator still waiting for its operand.
 */
function isStandaloneValue(token: string): boolean {
  return startsLikeValue(token) && !endsWithOperator(token);
}

function startsLikeValue(token: string): boolean {
  const first = token[0]!;
  // Quoted string
  if (first === '"' || first === "'" || first === '`') return true;
  // Variable ($var, _var, @var, %var), but not the modulo operator in `$a % 2`
  if (/^[$_@]\w|^%[A-Za-z_]/.test(token)) return true;
  // Number literal
  if (/\d/.test(first)) return true;
  // Signed number (-1, +2)
  if (
    (first === '-' || first === '+') &&
    token.length > 1 &&
    /\d/.test(token[1]!)
  )
    return true;
  // Grouped expression or collection literal
  if (first === '(' || first === '[' || first === '{') return true;
  // Boolean / null / undefined, alone or leading an expression (true||$x)
  if (/^(?:true|false|null|undefined)(?![\w$])/.test(token)) return true;
  // Negation (!$flag, !true), but not the operators != and !==
  if (first === '!' && token.length > 1 && token[1] !== '=') return true;
  return false;
}

/**
 * Try to split a raw string on whitespace at depth 0 (respecting strings,
 * template literals, parentheses, brackets, and braces). Each resulting token
 * must pass `isStandaloneValue()` or the split is rejected and `null` is
 * returned.
 */
function trySplitOnWhitespace(raw: string): string[] | null {
  const args = splitTopLevel(raw, isWhitespace).filter(Boolean);

  // Need 2+ tokens
  if (args.length < 2) return null;

  // Every token must be a standalone value (not an operator)
  for (const arg of args) {
    if (!isStandaloneValue(arg)) return null;
  }

  return args;
}

/**
 * Split rawArgs by commas, respecting parentheses, brackets, braces, and
 * strings. When no top-level commas are present, also supports adjacent quoted
 * string literals separated by whitespace (e.g. `"Label" "target"`).
 */
export function splitArgs(raw: string): string[] {
  const args = splitTopLevel(raw, (ch) => ch === ',').map((a) => a.trim());
  const hasComma = args.length > 1;
  if (args[args.length - 1] === '') args.pop();

  // If no commas were found and we got a single expression, try splitting
  // on whitespace at depth 0 (e.g. "Label" "target", $var "text", $x $y).
  if (!hasComma && args.length === 1) {
    const split = trySplitOnWhitespace(args[0]!);
    if (split) return split;
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
  const inline = useContext(InlineContext);
  const [localMutations, setLocalMutations] = useState<Record<string, unknown>>(
    {},
  );

  const localState = useMemo(
    () => ({ ...parentValues, ...ownKeys, ...localMutations }),
    [parentValues, ownKeys, localMutations],
  );

  const valuesRef = useRef(localState);
  valuesRef.current = localState;

  const getValues = useCallback(() => valuesRef.current, []);
  const update = useCallback((key: string, value: unknown) => {
    // Apply synchronously so later macros in the same render pass (e.g. a
    // second {set}) read the new value via getValues(); the state update
    // then re-renders consumers of LocalsValuesContext.
    valuesRef.current = { ...valuesRef.current, [key]: value };
    setLocalMutations((prev) => ({ ...prev, [key]: value }));
  }, []);
  const updater = useMemo(() => ({ update, getValues }), [update, getValues]);

  return (
    <LocalsUpdateContext.Provider value={updater}>
      <LocalsValuesContext.Provider value={localState}>
        {renderNodes(body, { nobr, inline, locals: localState })}
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
  const inline = useContext(InlineContext);
  const [mergedVars, mergedTemps, mergedLocals, mergedTrans] =
    useMergedLocals();

  const childrenValue = invocationChildren?.length ? invocationChildren : null;

  // Parameterized widgets always get their own local scope, even when invoked
  // without arguments: missing parameters shadow outer locals as undefined.
  if (params.length === 0) {
    return (
      <WidgetChildrenContext.Provider value={childrenValue}>
        {renderNodes(body, { nobr, inline, locals: parentValues })}
      </WidgetChildrenContext.Provider>
    );
  }

  const argExprs = rawArgs ? splitArgs(rawArgs) : [];
  const values: unknown[] = [];

  for (let i = 0; i < params.length; i++) {
    const expr = argExprs[i];
    let value: unknown;
    if (expr !== undefined) {
      try {
        value = evaluate(
          expr,
          mergedVars,
          mergedTemps,
          mergedLocals,
          mergedTrans,
        );
      } catch {
        value = undefined;
      }
    }
    values.push(value);
  }

  const ownKeys = useMemo(() => {
    const keys: Record<string, unknown> = {};
    for (let i = 0; i < params.length; i++) {
      keys[params[i]!.startsWith('@') ? params[i]!.slice(1) : params[i]!] =
        values[i];
    }
    return keys;
    // params is stable per widget instance; values tracks evaluated args
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, values);

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
