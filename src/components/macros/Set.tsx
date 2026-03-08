import { currentSourceLocation } from '../../utils/source-location';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'set',
  render({ rawArgs }, ctx) {
    const ran = ctx.hooks.useRef(false);

    if (!ran.current) {
      ran.current = true;

      try {
        ctx.mutate(rawArgs);
      } catch (err) {
        console.error(
          `spindle: Error in {set ${rawArgs}}${currentSourceLocation()}:`,
          err,
        );
        return null;
      }
    }

    return null;
  },
});
