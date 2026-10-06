import { useState, useCallback, useRef, useMemo } from 'preact/hooks';
import {
  LocalsValuesContext,
  LocalsUpdateContext,
  renderNodes,
} from '../../markup/render';
import type { ASTNode } from '../../markup/ast';
import { useRenderOptions } from '../../hooks/use-render-options';
import {
  checkVariableName,
  createNamespace,
  withEntry,
} from '../../utils/namespace';

/**
 * Render `body` in a new locals scope: the locals of `parentValues`, with
 * `ownKeys` (an iteration's loop variables, a widget's parameters) on top.
 * Locals the body assigns are kept in this scope.
 */
export function LocalsScope({
  body,
  parentValues,
  ownKeys,
}: {
  body: ASTNode[];
  parentValues: Record<string, unknown>;
  ownKeys: Record<string, unknown>;
}) {
  const options = useRenderOptions();
  const [localMutations, setLocalMutations] = useState<Record<string, unknown>>(
    {},
  );

  const localState = useMemo(
    () => createNamespace(parentValues, ownKeys, localMutations),
    [parentValues, ownKeys, localMutations],
  );

  const valuesRef = useRef(localState);
  valuesRef.current = localState;

  const getValues = useCallback(() => valuesRef.current, []);
  const update = useCallback((key: string, value: unknown) => {
    // Apply synchronously so later macros in the same render pass (e.g. a
    // second {set}) read the new value via getValues(); the state update
    // then re-renders consumers of LocalsValuesContext.
    checkVariableName(key, `@${key}`);
    valuesRef.current = withEntry(valuesRef.current, key, value);
    setLocalMutations((prev) => ({ ...prev, [key]: value }));
  }, []);
  const updater = useMemo(() => ({ update, getValues }), [update, getValues]);

  return (
    <LocalsUpdateContext.Provider value={updater}>
      <LocalsValuesContext.Provider value={localState}>
        {renderNodes(body, { ...options, locals: localState })}
      </LocalsValuesContext.Provider>
    </LocalsUpdateContext.Provider>
  );
}
