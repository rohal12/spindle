import { isHidden } from '../utils/element-visibility';
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

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unprintable value]';
    }
  }
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
  // A radio is one choice of its variable: its own value, and whether it is
  // the one selected (the action's value is the variable's, shared by all)
  if (type === 'radiobutton' && own.value !== undefined) {
    const state = action?.value === own.value ? 'selected' : 'unselected';
    return `[${type}${name ? ` ${name}` : ''} = ${formatValue(own.value)}: ${state}]`;
  }
  return `[${type}${name ? ` ${name}` : ''}: ${shown}]`;
}

/**
 * The text a reader sees in the element, as lines: blocks and `<br>` break
 * lines, hidden elements are left out, and a control with a `data-action`
 * becomes a marker such as `[textbox $name: "Alice"]`. Elements inside `el`
 * that match `skip` are left out with their content.
 */
export function observableText(el: Element, skip?: string): string {
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
    if (isHidden(child) || (skip && child !== el && child.matches(skip)))
      return;
    if (
      child.hasAttribute('data-action') &&
      (child.matches('input, textarea, select') ||
        getAction(child.getAttribute('data-action')!)?.type === 'cycle')
    ) {
      out += controlMarker(child);
      return;
    }
    if (child.tagName === 'BR') {
      out += '\n';
      return;
    }
    const block = BLOCKS.has(child.tagName);
    if (block) endLine();
    const closedDetails =
      child.tagName === 'DETAILS' && !child.hasAttribute('open');
    const children = closedDetails
      ? Array.from(child.children).filter((c) => !isHidden(c))
      : Array.from(child.childNodes);
    for (const c of children) {
      walk(c, inPre || child.tagName === 'PRE');
    }
    if (child.tagName === 'TD' || child.tagName === 'TH') out += '\t';
    if (block) endLine();
  };

  walk(el, false);
  return (
    out
      .split('\n')
      // Not trimStart: a <pre> line keeps its indentation, and no other line
      // starts with whitespace
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\s+$/g, '')
  );
}

/**
 * The trimmed text of each error shown in the element, leaving out those
 * the reader can't see (inside a hidden element, as observableText() does)
 * and those inside an element within `el` that matches `skip`.
 */
export function observableErrors(el: Element, skip?: string): string[] {
  const left = (e: Element) => {
    for (let at: Element | null = e; at; at = at.parentElement) {
      if (isHidden(at)) return true;
      if (at === el) return false;
      if (skip && at.matches(skip)) return true;
    }
    return false;
  };
  return Array.from(el.querySelectorAll('.error'))
    .filter((e) => !left(e))
    .map((e) => (e.textContent ?? '').trim());
}
