import { useStoryStore } from '../../store';
import { defineMacro } from '../../define-macro';
import { CodeSyntaxError, parseReferencePath } from '../../js-lexer';
import type { ReferencePath } from '../../js-lexer';
import { useRunOnce } from './MacroError';

/** What `name` is as a variable reference, or null if it is no reference. */
function referencePath(name: string): ReferencePath | null {
  try {
    return parseReferencePath(name);
  } catch (error) {
    if (error instanceof CodeSyntaxError) return null;
    throw error;
  }
}

defineMacro({
  name: 'unset',
  parameters: [{ name: 'variable', type: 'variable', required: true }],
  render({ rawArgs }, ctx) {
    return useRunOnce('unset', rawArgs, () => {
      const state = useStoryStore.getState();
      const name = ctx.args.variable ?? '';
      const path = referencePath(name);

      if (!path) {
        throw new Error(
          `{unset} expects a variable ($name, _name, %name, or @name, or a field of one such as $name.field or $name["field"]), got "${name}"`,
        );
      } else if (path.nested) {
        // A field of a variable: delete it as mutation code does, which
        // resolves the path in every namespace
        ctx.mutate(`delete ${name}`);
      } else if (path.sigil === '$') {
        state.deleteVariable(path.name);
      } else if (path.sigil === '_') {
        state.deleteTemporary(path.name);
      } else if (path.sigil === '%') {
        state.deleteTransient(path.name);
      } else {
        // Throws outside a locals scope ({for}, widget, {link}, {button})
        ctx.update(path.name, undefined);
      }
    });
  },
});
