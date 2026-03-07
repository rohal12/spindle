import { useLayoutEffect, useContext } from 'preact/hooks';
import type { ASTNode } from '../../markup/ast';
import { LocalsUpdateContext } from '../../markup/render';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';
import { collectText } from '../../utils/extract-text';

interface DoProps {
  children: ASTNode[];
}

export function Do({ children }: DoProps) {
  const code = collectText(children);
  const { update, getValues } = useContext(LocalsUpdateContext);

  useLayoutEffect(() => {
    try {
      executeMutation(code, getValues(), update);
    } catch (err) {
      console.error(`spindle: Error in {do}${currentSourceLocation()}:`, err);
    }
  }, []);

  return null;
}
