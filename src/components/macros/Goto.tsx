import { useLayoutEffect } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';

interface GotoProps {
  rawArgs: string;
}

export function Goto({ rawArgs }: GotoProps) {
  useLayoutEffect(() => {
    const state = useStoryStore.getState();
    let passageName: string;
    try {
      const result = evaluate(rawArgs, state.variables, state.temporary);
      passageName = String(result);
    } catch {
      passageName = rawArgs.replace(/^["']|["']$/g, '');
    }
    state.navigate(passageName);
  }, []);

  return null;
}
