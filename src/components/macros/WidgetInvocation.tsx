import { useMemo } from 'preact/hooks';
import { WidgetChildrenContext, renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { evaluate } from '../../expression';
import type { ASTNode } from '../../markup/ast';
import { splitArgs } from './arg-utils';
import { createNamespace } from '../../utils/namespace';
import { useRenderOptions } from '../../hooks/use-render-options';
import { LocalsScope } from './locals-scope';

export { splitArgs };

interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
  invocationChildren?: ASTNode[];
}

export function WidgetInvocation({
  body,
  params,
  rawArgs,
  invocationChildren,
}: WidgetInvocationProps) {
  const renderOptions = useRenderOptions();
  const parentValues = renderOptions.locals;
  const [mergedVars, mergedTemps, mergedLocals, mergedTrans] =
    useMergedLocals();

  const childrenValue = invocationChildren?.length ? invocationChildren : null;

  // Parameterized widgets always get their own local scope, even when invoked
  // without arguments: missing parameters shadow outer locals as undefined.
  if (params.length === 0) {
    return (
      <WidgetChildrenContext.Provider value={childrenValue}>
        {renderNodes(body, renderOptions)}
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
    const keys = createNamespace();
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
      <LocalsScope
        body={body}
        parentValues={parentValues}
        ownKeys={ownKeys}
      />
    </WidgetChildrenContext.Provider>
  );
}
