import { useLayoutEffect, useContext } from 'preact/hooks';
import { RepeatContext } from './Repeat';

export function Stop() {
  const { stop } = useContext(RepeatContext);

  useLayoutEffect(() => {
    stop();
  }, [stop]);

  return null;
}
