import { useState, useEffect } from 'preact/hooks';
import { renderNodes } from '../../markup/render';
import { parseDelay } from '../../utils/parse-delay';
import type { ASTNode, Branch } from '../../markup/ast';

interface TimedProps {
  rawArgs: string;
  children: ASTNode[];
  branches: Branch[];
  className?: string;
  id?: string;
}

export function Timed({
  rawArgs,
  children,
  branches,
  className,
  id,
}: TimedProps) {
  // Section 0 = initial children, sections 1..N = {next} branches
  // Each section has its own delay
  const sections: { delay: number; nodes: ASTNode[] }[] = [];

  // Initial content with the timed delay
  sections.push({ delay: parseDelay(rawArgs), nodes: children });

  // {next} branches
  for (const branch of branches) {
    const delay = branch.rawArgs ? parseDelay(branch.rawArgs) : 0;
    sections.push({ delay, nodes: branch.children });
  }

  const [visibleIndex, setVisibleIndex] = useState(-1);

  useEffect(() => {
    if (visibleIndex >= sections.length - 1) return;

    const nextIndex = visibleIndex + 1;
    const delay = sections[nextIndex].delay;

    const timer = setTimeout(() => {
      setVisibleIndex(nextIndex);
    }, delay);

    return () => clearTimeout(timer);
  }, [visibleIndex, sections.length]);

  if (visibleIndex < 0) return null;

  const content = renderNodes(sections[visibleIndex].nodes);

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
