import { useState, useEffect, useMemo } from 'preact/hooks';
import { renderNodes } from '../../markup/render';
import { parseDelay } from '../../utils/parse-delay';
import { useInterpolate } from '../../hooks/use-interpolate';
import { registerMacro, registerSubMacro } from '../../registry';
import type { MacroProps } from '../../registry';

export function Timed({ branches = [] }: MacroProps) {
  const resolve = useInterpolate();
  // For branching blocks, className/id from the opening tag goes on branches[0],
  // so the component-level className/id is unused. Each branch carries its own.
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
  const content = renderNodes(section.nodes);
  const sectionClass = resolve(section.className);
  const sectionId = resolve(section.id);

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
}

registerMacro('timed', Timed);
registerSubMacro('next');
