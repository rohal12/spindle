import {
  useState,
  useCallback,
  useContext,
  useRef,
  useMemo,
} from 'preact/hooks';
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
 * Render `body` in a new locals scope: the locals of the enclosing scope,
 * with `ownKeys` (an iteration's loop variables, a widget's parameters) on
 * top. Locals the body assigns are kept in this scope.
 */
export function LocalsScope({
  body,
  ownKeys,
}: {
  body: ASTNode[];
  ownKeys: Record<string, unknown>;
}) {
  const options = useRenderOptions();
  const [localMutations, setLocalMutations] = useState<Record<string, unknown>>(
    {},
  );

  // The enclosing scope as it is now: a local assigned before this scope
  // renders is in it, while the context value only gains it in the re-render
  // that follows (and the body may have acted on its absence by then).
  const enclosing = useContext(LocalsUpdateContext).getValues();
  const parentValues = useContext(LocalsValuesContext);
  const localState = useMemo(
    () => createNamespace(enclosing, ownKeys, localMutations),
    // `parentValues` renews the scope when the enclosing one re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enclosing, parentValues, ownKeys, localMutations],
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
