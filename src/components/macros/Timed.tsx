import { parseDelay } from '../../utils/parse-delay';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'timed',
  subMacros: ['next'],
  interpolate: true,
  render({ branches = [] }, ctx) {
    const { useState, useEffect, useMemo } = ctx.hooks;

    const sections = useMemo(() => {
      return branches.map((branch) => ({
        delay: branch.rawArgs ? parseDelay(branch.rawArgs) : 0,
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
        setVisibleIndex(nextIndex);
      }, delay);

      return () => clearTimeout(timer);
    }, [visibleIndex, sections]);

    if (visibleIndex < 0) return null;

    const section = sections[visibleIndex]!;
    const content = ctx.renderNodes(section.nodes);
    const sectionClass = ctx.resolve!(section.className);
    const sectionId = ctx.resolve!(section.id);

    if (sectionClass || sectionId)
      return (
        <span
          id={sectionId}
          class={sectionClass}
        >
          {content}
        </span>
      );
    return <>{content}</>;
  },
});
