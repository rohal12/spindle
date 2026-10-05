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
  RawTextContext,
  renderNodes,
} from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { evaluate } from '../../expression';
import type { ASTNode } from '../../markup/ast';
import { splitArgs } from './arg-utils';

export { splitArgs };

interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
  invocationChildren?: ASTNode[];
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
  const raw = useContext(RawTextContext);
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
        {renderNodes(body, { nobr, inline, raw, locals: localState })}
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
  const raw = useContext(RawTextContext);
  const [mergedVars, mergedTemps, mergedLocals, mergedTrans] =
    useMergedLocals();

  const childrenValue = invocationChildren?.length ? invocationChildren : null;

  // Parameterized widgets always get their own local scope, even when invoked
  // without arguments: missing parameters shadow outer locals as undefined.
  if (params.length === 0) {
    return (
      <WidgetChildrenContext.Provider value={childrenValue}>
        {renderNodes(body, { nobr, inline, raw, locals: parentValues })}
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
