import { parseDelay } from '../../utils/parse-delay';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'type',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const { useState, useEffect, useRef } = ctx.hooks;
    const speed = parseDelay(rawArgs);
    const containerRef = useRef<HTMLSpanElement>(null);
    const [totalChars, setTotalChars] = useState(0);
    const [visibleChars, setVisibleChars] = useState(0);

    useEffect(() => {
      if (containerRef.current) {
        const text = containerRef.current.textContent || '';
        setTotalChars(text.length);
      }
    }, []);

    // Typewriter interval
    useEffect(() => {
      if (totalChars === 0) return;
      if (visibleChars >= totalChars) return;

      const timer = setInterval(() => {
        setVisibleChars((c) => {
          if (c >= totalChars) {
            clearInterval(timer);
            return c;
          }
          return c + 1;
        });
      }, speed);

      return () => clearInterval(timer);
    }, [totalChars, speed]);

    const done = visibleChars >= totalChars && totalChars > 0;

    const cls = [
      'macro-type',
      done ? 'macro-type-done' : '',
      ctx.className || '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <span
        id={ctx.id}
        class={cls}
        ref={containerRef}
        style={{
          clipPath: totalChars > 0 && !done ? undefined : undefined,
        }}
      >
        <span
          class="macro-type-inner"
          style={{
            display: 'inline',
            visibility: totalChars === 0 ? 'hidden' : 'visible',
            clipPath:
              totalChars > 0 && !done
                ? `inset(0 ${((totalChars - visibleChars) / totalChars) * 100}% 0 0)`
                : undefined,
          }}
        >
          {ctx.renderInlineNodes(children)}
        </span>
        {!done && totalChars > 0 && <span class="macro-type-cursor" />}
      </span>
    );
  },
});
