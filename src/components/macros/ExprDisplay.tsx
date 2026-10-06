import { evaluate } from '../../expression';
import { useInterpolate } from '../../hooks/use-interpolate';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { display, wrapContent } from './display';
import type { ExpressionNode } from '../../markup/ast';

/** An expression display: `{$hp + 1}`. */
export function ExprDisplay({ node }: { node: ExpressionNode }) {
  const { expression } = node;
  const resolve = useInterpolate();
  const className = resolve(node.className);
  const id = resolve(node.id);
  const [variables, temporary, localsValues, transient] = useMergedLocals();

  let text: string;
  try {
    text = display(
      evaluate(expression, variables, temporary, localsValues, transient),
    );
  } catch {
    text = `{error: ${expression}}`;
  }
  return wrapContent(className, id, text);
}
