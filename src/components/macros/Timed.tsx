import { useState, useEffect, useMemo } from 'preact/hooks';
import { renderNodes } from '../../markup/render';
import { parseDelay } from '../../utils/parse-delay';
import { useInterpolate } from '../../hooks/use-interpolate';
import { registerMacro, registerSubMacro } from '../../registry';
import type { MacroProps } from '../../registry';
import type { ASTNode } from '../../markup/ast';

export function Timed({
  rawArgs,
  children = [],
  branches = [],
  className,
  id,
}: MacroProps) {
  const resolve = useInterpolate();
  const firstBranch = branches[0];
  className = resolve(className ?? firstBranch?.className);
  id = resolve(id ?? firstBranch?.id);
  // Section 0 = initial children, sections 1..N = {next} branches
  // Each section has its own delay
  const sections = useMemo(() => {
    const result: { delay: number; nodes: ASTNode[] }[] = [];
    result.push({ delay: parseDelay(rawArgs), nodes: children });
    for (const branch of branches) {
      const delay = branch.rawArgs ? parseDelay(branch.rawArgs) : 0;
      result.push({ delay, nodes: branch.children });
    }
    return result;
  }, [rawArgs, children, branches]);

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

  const content = renderNodes(sections[visibleIndex]!.nodes);

  if (className || id)
    return (
      <span
        id={id}
        class={className}
      >
        {content}
      </span>
    );
  return <>{content}</>;
}

registerMacro('timed', Timed);
registerSubMacro('next');
