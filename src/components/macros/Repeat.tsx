import { createContext } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { renderNodes } from '../../markup/render';
import { parseDelay } from '../../utils/parse-delay';
import { hasInterpolation, interpolate } from '../../interpolation';
import { useStoryStore } from '../../store';
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

export function Repeat({
  rawArgs,
  children,
  className: rawClassName,
  id: rawId,
}: RepeatProps) {
  const [className, id] = useMemo(() => {
    const resolveOnce = (s: string | undefined) => {
      if (!s || !hasInterpolation(s)) return s;
      const st = useStoryStore.getState();
      return interpolate(s, st.variables, st.temporary, {});
    };
    return [resolveOnce(rawClassName), resolveOnce(rawId)];
  }, [rawClassName, rawId]);

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
      <span key={count}>{renderNodes(children)}</span>
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
