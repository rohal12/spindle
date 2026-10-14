import { evaluateDisplay } from '../../expression';
import { DisplayOnlyContext } from '../../display-only';
import { useContext } from 'preact/hooks';
import { MacroError } from './MacroError';
import { useInterpolate } from '../../hooks/use-interpolate';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { display, wrapContent } from './display';
import type { ExpressionNode } from '../../markup/ast';

/** An expression display: `{$hp + 1}`. */
export function ExprDisplay({ node }: { node: ExpressionNode }) {
  const { expression } = node;
  const displayOnly = useContext(DisplayOnlyContext);
  const resolve = useInterpolate();
  const className = resolve(node.className);
  const id = resolve(node.id);
  const [variables, temporary, localsValues, transient] = useMergedLocals();

  let text: string;
  try {
    text = display(
      evaluateDisplay(
        expression,
        [variables, temporary, localsValues, transient],
        displayOnly,
      ),
    );
  } catch (error) {
    return wrapContent(
      className,
      id,
      <MacroError
        macro={expression}
        error={error}
      />,
    );
  }
  return wrapContent(className, id, text);
}
