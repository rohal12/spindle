import { createContext } from 'preact';
import { parseDelay } from '../../utils/parse-delay';
import { defineMacro } from '../../define-macro';

export const RepeatContext = createContext<{ stop: () => void }>({
  stop: () => {},
});

defineMacro({
  name: 'repeat',
  block: true,
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { useState, useEffect, useCallback } = ctx.hooks;

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

    const content = (
      <RepeatContext.Provider value={{ stop }}>
        <span key={count}>{ctx.renderNodes(children)}</span>
      </RepeatContext.Provider>
    );

    if (ctx.className || ctx.id)
      return (
        <span
          id={ctx.id}
          class={ctx.cls}
        >
          {content}
        </span>
      );
    return content;
  },
});
