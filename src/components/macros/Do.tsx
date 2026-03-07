import { useLayoutEffect, useContext } from 'preact/hooks';
import { LocalsUpdateContext } from '../../markup/render';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';
import { collectText } from '../../utils/extract-text';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Do({ children = [] }: MacroProps) {
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

registerMacro('do', Do);
