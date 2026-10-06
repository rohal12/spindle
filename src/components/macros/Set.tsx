import { defineMacro } from '../../define-macro';
import { useRunOnce } from './MacroError';

defineMacro({
  name: 'set',
  parameters: [{ name: 'code', type: 'expression', required: true }],
  render({ rawArgs }, ctx) {
    return useRunOnce('set', rawArgs, () => ctx.mutate(rawArgs));
  },
});
