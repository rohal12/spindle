import { defineMacro } from '../../define-macro';
import { DELAY_PARAMETER } from './macro-args';

/**
 * The clip-path that shows the first `count` characters of `root`'s text in
 * reading order: the boxes the browser laid out for them, each wrapped line
 * as far as its last revealed character, as one path in the coordinates of
 * `inner`'s box. Undefined where there is no layout to measure.
 */
function revealedPath(
  root: HTMLElement,
  inner: HTMLElement,
  count: number,
): string | undefined {
  const range = document.createRange();
  if (!range.getClientRects) return undefined;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = count;
  let end: { node: Node; offset: number } | undefined;
  for (let n = walker.nextNode(); n && left > 0; n = walker.nextNode()) {
    const length = n.nodeValue?.length ?? 0;
    end = { node: n, offset: Math.min(left, length) };
    left -= length;
  }
  if (!end) return 'inset(0 100% 0 0)';
  range.setStart(root, 0);
  range.setEnd(end.node, end.offset);
  const rects = range.getClientRects();
  if (rects.length === 0) return undefined;
  const origin = inner.getBoundingClientRect();
  let path = '';
  for (const r of Array.from(rects)) {
    if (r.width === 0 && r.height === 0) continue;
    const x = (r.left - origin.left).toFixed(2);
    const y = (r.top - origin.top).toFixed(2);
    path += `M${x} ${y}h${r.width.toFixed(2)}v${r.height.toFixed(2)}h-${r.width.toFixed(2)}z`;
  }
  return path ? `path("${path}")` : undefined;
}

defineMacro({
  name: 'type',
  block: true,
  interpolate: true,
  parameters: [DELAY_PARAMETER],
  render({ children = [] }, ctx) {
    const { useState, useEffect, useLayoutEffect, useRef } = ctx.hooks;
    const speed = ctx.args.delay ?? 0;
    const containerRef = useRef<HTMLSpanElement>(null);
    const innerRef = useRef<HTMLSpanElement>(null);
    const [clip, setClip] = useState<string | undefined>();
    // Null until the content has been measured: zero characters is then a
    // result (nothing to animate), not a pending measurement.
    const [measured, setMeasured] = useState<number | null>(null);
    const totalChars = measured ?? 0;
    const [visibleChars, setVisibleChars] = useState(0);
    const visibleCharsRef = useRef(0);
    visibleCharsRef.current = visibleChars;

    // Measure after every render: reactive content can become nonempty (or
    // change length) after mounting. Setting an equal count is a no-op.
    useEffect(() => {
      if (containerRef.current) {
        const text = containerRef.current.textContent || '';
        setMeasured(text.length);
      }
    });

    // Typewriter interval
    useEffect(() => {
      if (totalChars === 0) return;
      if (visibleCharsRef.current >= totalChars) return;

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

    // Empty text can still become reactive text later, which restarts typing
    const done = measured !== null && visibleChars >= totalChars;

    // Clip to the characters revealed so far, as laid out: remeasured when
    // the count changes and when the width the text wraps in does.
    useLayoutEffect(() => {
      const root = containerRef.current;
      const inner = innerRef.current;
      if (!root || !inner || totalChars === 0 || done) {
        setClip(undefined);
        return;
      }
      const measure = () => setClip(revealedPath(root, inner, visibleChars));
      measure();
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }, [visibleChars, totalChars, done]);

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
      >
        <span
          ref={innerRef}
          class="macro-type-inner"
          style={{
            display: 'inline',
            visibility: measured === null ? 'hidden' : 'visible',
            clipPath: clip,
          }}
        >
          {ctx.renderNodes(children, { inline: true })}
        </span>
        {!done && totalChars > 0 && <span class="macro-type-cursor" />}
      </span>
    );
  },
});
