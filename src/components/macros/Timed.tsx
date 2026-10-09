import { defineMacro } from '../../define-macro';
import { DELAY_PARAMETER, parseMacroArgs } from './macro-args';
import { wrapContent } from './display';
import { OutgoingContext } from '../../hooks/use-story-fields';

/** The parameters of {timed} and of each {next}: the delay before it shows. */
const TIMED_PARAMETERS = [DELAY_PARAMETER] as const;

defineMacro({
  name: 'timed',
  subMacros: ['next'],
  interpolate: true,
  parameters: TIMED_PARAMETERS,
  render({ branches = [] }, ctx) {
    const { useState, useEffect, useMemo, useContext } = ctx.hooks;
    const hasLeft = useContext(OutgoingContext);

    const sections = useMemo(() => {
      return branches.map((branch) => ({
        delay: parseMacroArgs(branch.rawArgs, TIMED_PARAMETERS).delay ?? 0,
        nodes: branch.children,
        className: branch.className,
        id: branch.id,
      }));
    }, [branches]);

    const [visibleIndex, setVisibleIndex] = useState(-1);

    useEffect(() => {
      if (visibleIndex >= sections.length - 1) return;

      const nextIndex = visibleIndex + 1;
      const delay = sections[nextIndex]!.delay;

      const timer = setTimeout(() => {
        // The passage was left: its body must not run (#410)
        if (hasLeft?.()) return;
        setVisibleIndex(nextIndex);
      }, delay);

      return () => clearTimeout(timer);
    }, [visibleIndex, sections]);

    if (visibleIndex < 0) return ctx.wrap(null);

    const section = sections[visibleIndex]!;
    return ctx.wrap(
      wrapContent(
        ctx.resolve!(section.className),
        ctx.resolve!(section.id),
        ctx.renderNodes(section.nodes),
      ),
    );
  },
});
