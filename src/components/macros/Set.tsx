import { useRef, useContext } from 'preact/hooks';
import { LocalsContext } from '../../markup/render';
import { stripLocalsPrefix } from '../../hooks/use-merged-locals';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';

interface SetProps {
  rawArgs: string;
}

export function Set({ rawArgs }: SetProps) {
  const scope = useContext(LocalsContext);
  const ran = useRef(false);

  if (!ran.current) {
    ran.current = true;

    try {
      executeMutation(rawArgs, stripLocalsPrefix(scope.values), scope.update);
    } catch (err) {
      console.error(
        `spindle: Error in {set ${rawArgs}}${currentSourceLocation()}:`,
        err,
      );
      return null;
    }
  }

  return null;
}
