import { createContext } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { renderNodes } from '../../markup/render';
import { parseDelay } from '../../utils/parse-delay';
import { useInterpolate } from '../../hooks/use-interpolate';
import type { ASTNode } from '../../markup/ast';

export const RepeatContext = createContext<{ stop: () => void }>({
  stop: () => {},
});

interface RepeatProps {
  rawArgs: string;
  children: ASTNode[];
  className?: string;
  id?: string;
}

export function Repeat({ rawArgs, children, className, id }: RepeatProps) {
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);
  const delay = parseDelay(rawArgs);
  const [count, setCount] = useState(0);
  const [stopped, setStopped] = useState(false);

  const stop = useCallback(() => setStopped(true), []);

  useEffect(() => {
    if (stopped) return;
    const interval = setInterval(() => {
      setCount((c) => c + 1);
    }, delay);
    return () => clearInterval(interval);
  }, [delay, stopped]);

  if (count === 0 && !stopped) return null;

  const cls = className ? `macro-repeat ${className}` : undefined;

  const content = (
    <RepeatContext.Provider value={{ stop }}>
      {renderNodes(children)}
    </RepeatContext.Provider>
  );

  if (cls || id)
    return (
      <span
        id={id}
        class={cls}
      >
        {content}
      </span>
    );
  return content;
}
