import { useLayoutEffect } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { useMergedLocals } from '../../hooks/use-merged-locals';

interface GotoProps {
  rawArgs: string;
}

export function Goto({ rawArgs }: GotoProps) {
  const [variables, temporary, locals] = useMergedLocals();

  useLayoutEffect(() => {
    let passageName: string;
    try {
      const result = evaluate(rawArgs, variables, temporary, locals);
      passageName = String(result);
    } catch {
      passageName = rawArgs.replace(/^["']|["']$/g, '');
    }
    useStoryStore.getState().navigate(passageName);
  }, []);

  return null;
}
