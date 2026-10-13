import { getAction } from '../action-registry';

/** Elements that start and end a line. */
const BLOCKS = new Set([
  'P',
  'DIV',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
]);

/** Elements whose content is never text the reader reads. */
const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Whether the reader can't see the element. Headless DOMs compute no layout,
 * so only what the markup says counts: the `hidden` attribute, an inline
 * `display: none` and `aria-hidden="true"`.
 */
function isHidden(el: Element): boolean {
  return (
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true' ||
    /(^|;)\s*display\s*:\s*none\b/i.test(el.getAttribute('style') ?? '') ||
    NOT_TEXT.has(el.tagName)
  );
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}

/** What a control with an action shows: its type, variable and value. */
function controlMarker(el: Element): string {
  const own = el as Partial<HTMLInputElement>;
  const action = getAction(el.getAttribute('data-action') ?? '');
  const type = action?.type ?? el.getAttribute('type') ?? el.localName;
  const isCheckbox = type === 'checkbox';
  const value =
    action?.value !== undefined
      ? action.value
      : isCheckbox
        ? !!own.checked
        : (own.value ?? '');
  const shown = isCheckbox
    ? value
      ? 'checked'
      : 'unchecked'
    : formatValue(value);
  const variable = action?.variable;
  const name =
    variable && !variable.startsWith('$') ? `$${variable}` : variable;
  return `[${type}${name ? ` ${name}` : ''}: ${shown}]`;
}

/**
 * The text a reader sees in the element, as lines: blocks and `<br>` break
 * lines, hidden elements are left out, and a control with a `data-action`
 * becomes a marker such as `[textbox $name: "Alice"]`.
 */
export function observableText(el: Element): string {
  let out = '';
  const endLine = () => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };

  const walk = (node: Node, inPre: boolean) => {
    if (node.nodeType === 3) {
      const data = node.textContent ?? '';
      if (inPre) out += data;
      else {
        // Source whitespace between blocks isn't a line of its own
        const collapsed = data.replace(/\s+/g, ' ');
        out +=
          out === '' || out.endsWith('\n') ? collapsed.trimStart() : collapsed;
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (isHidden(child)) return;
    if (child.hasAttribute('data-action')) {
      out += controlMarker(child);
      return;
    }
    if (child.tagName === 'BR') {
      out += '\n';
      return;
    }
    const block = BLOCKS.has(child.tagName);
    if (block) endLine();
    for (const c of Array.from(child.childNodes)) {
      walk(c, inPre || child.tagName === 'PRE');
    }
    if (block) endLine();
  };

  walk(el, false);
  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The trimmed text of each error shown in the element. */
export function observableErrors(el: Element): string[] {
  return Array.from(el.querySelectorAll('.error'), (e) =>
    (e.textContent ?? '').trim(),
  );
}
