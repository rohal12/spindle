import {
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'preact/hooks';
import { evaluate } from '../../expression';
import {
  LocalsValuesContext,
  LocalsUpdateContext,
  renderNodes,
} from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { useInterpolate } from '../../hooks/use-interpolate';
import { currentSourceLocation } from '../../utils/source-location';
import type { ASTNode } from '../../markup/ast';

interface ForProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

/**
 * Parse for-loop args: "@item, @i of $list" or "@item of $list"
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

  if (!itemVar.startsWith('@')) {
    throw new Error(`{for} loop variable must use @ prefix: got "${itemVar}"`);
  }
  if (indexVar && !indexVar.startsWith('@')) {
    throw new Error(
      `{for} index variable must use @ prefix: got "${indexVar}"`,
    );
  }

  return {
    itemVar: itemVar.slice(1),
    indexVar: indexVar ? indexVar.slice(1) : null,
    listExpr,
  };
}

function ForIteration({
  parentValues,
  ownKeys,
  initialValues,
  children,
}: {
  parentValues: Record<string, unknown>;
  ownKeys: Record<string, unknown>;
  initialValues: Record<string, unknown>;
  children: ASTNode[];
}) {
  const [localState, setLocalState] = useState<Record<string, unknown>>(() => ({
    ...parentValues,
    ...ownKeys,
    ...initialValues,
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
        {renderNodes(children)}
      </LocalsValuesContext.Provider>
    </LocalsUpdateContext.Provider>
  );
}

export function For({ rawArgs, children, className, id }: ForProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const parentValues = useContext(LocalsValuesContext);
  const [mergedVars, mergedTemps, mergedLocals] = useMergedLocals();

  let parsed: ReturnType<typeof parseForArgs>;
  try {
    parsed = parseForArgs(rawArgs);
  } catch (err) {
    return (
      <span
        class="error"
        title={String(err)}
      >
        {`{for error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }

  const { itemVar, indexVar, listExpr } = parsed;

  let list: unknown[];
  try {
    const result = evaluate(listExpr, mergedVars, mergedTemps, mergedLocals);
    if (!Array.isArray(result)) {
      return (
        <span class="error">
          {`{for error${currentSourceLocation()}: expression did not evaluate to an array}`}
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
        {`{for error${currentSourceLocation()}: ${err instanceof Error ? err.message : String(err)}}`}
      </span>
    );
  }

  const content = list.map((item, i) => {
    const ownKeys: Record<string, unknown> = {
      [itemVar]: item,
      ...(indexVar ? { [indexVar]: i } : undefined),
    };

    return (
      <ForIteration
        key={i}
        parentValues={parentValues}
        ownKeys={ownKeys}
        initialValues={{}}
        children={children}
      />
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
