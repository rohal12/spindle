import { useLayoutEffect } from 'preact/hooks';
import { useStoryStore } from '../../store';
import { evaluate } from '../../expression';
import { useMergedLocals } from '../../hooks/use-merged-locals';
import { registerMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Goto({ rawArgs }: MacroProps) {
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

registerMacro('goto', Goto);
