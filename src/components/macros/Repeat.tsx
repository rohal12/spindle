import { createContext } from 'preact';
import { defineMacro } from '../../define-macro';
import { DELAY_PARAMETER } from './macro-args';
import { OutgoingContext } from '../../hooks/use-story-fields';

export const RepeatContext = createContext<{ stop: () => void }>({
  stop: () => {},
});

defineMacro({
  name: 'repeat',
  block: true,
  interpolate: true,
  parameters: [DELAY_PARAMETER],
  render({ children = [] }, ctx) {
    const { useState, useEffect, useCallback, useContext } = ctx.hooks;

    const delay = ctx.args.delay ?? 0;
    const [count, setCount] = useState(0);
    const [stopped, setStopped] = useState(false);

    const hasLeft = useContext(OutgoingContext);

    const stop = useCallback(() => setStopped(true), []);

    useEffect(() => {
      if (stopped) return;
      const interval = setInterval(() => {
        // The passage was left: its body must not run again (#410)
        if (hasLeft?.()) return;
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
