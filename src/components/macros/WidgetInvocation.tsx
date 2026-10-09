import { useContext, useMemo } from 'preact/hooks';
import { WidgetChildrenContext, renderNodes } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { evaluate } from '../../expression';
import type { ASTNode } from '../../markup/ast';
import { splitArgs } from './arg-utils';
import { createNamespace } from '../../utils/namespace';
import { useRenderOptions } from '../../hooks/use-render-options';
import { LocalsScope } from './locals-scope';
import { useInterpolate } from '../../hooks/use-interpolate';
import { wrapContent } from './display';
import { widgetChildrenOf } from '../../interpolation';

export { splitArgs };

interface WidgetInvocationProps {
  body: ASTNode[];
  params: string[];
  rawArgs?: string;
  invocationChildren?: ASTNode[];
  className?: string;
  id?: string;
}

export function WidgetInvocation(props: WidgetInvocationProps) {
  const resolve = useInterpolate();
  // Invocation selectors (`{.badge#hero Stats}`) need an element to land on;
  // dynamic ones (`{.{$theme} Stats}`) follow the state like a built-in
  // macro's.
  return wrapContent(
    resolve(props.className),
    resolve(props.id),
    <WidgetContent {...props} />,
  );
}

function WidgetContent({
  body,
  params,
  rawArgs,
  invocationChildren,
}: WidgetInvocationProps) {
  const renderOptions = useRenderOptions();
  const parentValues = renderOptions.locals;
  const [mergedVars, mergedTemps, mergedLocals, mergedTrans] =
    useMergedLocals();

  const outerChildren = useContext(WidgetChildrenContext);
  const childrenValue = useMemo(
    () => widgetChildrenOf(invocationChildren, outerChildren),
    [invocationChildren, outerChildren],
  );

  // Every widget gets its own local scope, even when it declares no
  // parameters or is invoked without arguments: missing parameters shadow
  // outer locals as undefined, and the body's own locals stay in the widget.
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
