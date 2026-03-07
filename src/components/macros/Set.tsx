import { useRef, useContext } from 'preact/hooks';
import { LocalsUpdateContext } from '../../markup/render';
import { executeMutation } from '../../execute-mutation';
import { currentSourceLocation } from '../../utils/source-location';

interface SetProps {
  rawArgs: string;
}

export function Set({ rawArgs }: SetProps) {
  const { update, getValues } = useContext(LocalsUpdateContext);
  const ran = useRef(false);

  if (!ran.current) {
    ran.current = true;

    try {
      executeMutation(rawArgs, getValues(), update);
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
