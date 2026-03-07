import { useLayoutEffect, useContext } from 'preact/hooks';
import type { ASTNode } from '../../markup/ast';
import { LocalsContext } from '../../markup/render';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';

interface DoProps {
  children: ASTNode[];
}

/**
 * Concatenate text children into a single JS string for execution.
 */
function collectText(nodes: ASTNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.value : '')).join('');
}

export function Do({ children }: DoProps) {
  const code = collectText(children);
  const scope = useContext(LocalsContext);
  const [, , mergedLocals] = useMergedLocals();

  useLayoutEffect(() => {
    try {
      executeMutation(code, mergedLocals, scope.update);
    } catch (err) {
      console.error(`spindle: Error in {do}${currentSourceLocation()}:`, err);
    }
  }, []);

  return null;
}
