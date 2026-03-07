import { useLayoutEffect, useContext } from 'preact/hooks';
import { RepeatContext } from './Repeat';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Stop(_props: MacroProps) {
  const { stop } = useContext(RepeatContext);

  useLayoutEffect(() => {
    stop();
  }, [stop]);

  return null;
}

registerMacro('stop', Stop);
