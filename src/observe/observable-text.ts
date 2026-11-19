import {
  composedChildNodes,
  composedElements,
  composedParent,
  isHidden,
  isRendered,
} from '../utils/element-visibility';
import { getAction } from '../action-registry';
import { SvgInstances } from './svg-instances';

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

function selectedLabels(el: HTMLSelectElement): string | string[] {
  const labels = Array.from(el.options)
    .filter((option) => option.selected)
    .map(
      (option) =>
        // An empty label attribute falls back to the option's text.
        option.getAttribute('label') ||
        (option.textContent ?? '').trim().replace(/\s+/g, ' '),
    );
  return el.multiple ? labels : (labels[0] ?? '');
}

/** What a control shows: its type, optional action variable and live value. */
function controlMarker(el: Element): string {
  const own = el as Partial<HTMLInputElement>;
  const action = getAction(el.getAttribute('data-action') ?? '');
  const type =
    action?.type ?? el.getAttribute('type')?.toLowerCase() ?? el.localName;
  const isCheckbox = type === 'checkbox';
  const value =
    action?.value !== undefined
      ? action.value
      : isCheckbox
        ? !!own.checked
        : el.localName === 'select' && !el.hasAttribute('data-action')
          ? selectedLabels(el as HTMLSelectElement)
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
  if ((type === 'radiobutton' || type === 'radio') && own.value !== undefined) {
    const selected =
      action?.value !== undefined ? action.value === own.value : !!own.checked;
    const state = selected ? 'selected' : 'unselected';
    return `[${type}${name ? ` ${name}` : ''} = ${formatValue(own.value)}: ${state}]`;
  }
  return `[${type}${name ? ` ${name}` : ''}: ${shown}]`;
}

/**
 * The text a reader sees in the element, as lines: blocks and `<br>` break
 * lines, hidden elements are left out, and a native or action-associated control
 * becomes a marker such as `[textbox $name: "Alice"]`. Elements inside `el`
 * that match `skip` are left out with their content. `visibilityRoot` bounds
 * ancestor checks when reading StoryContext inside its hidden host.
 */
export function observableText(
  el: Element,
  skip?: string,
  visibilityRoot?: Element,
): string {
  let out = '';
  const endLine = () => {
    if (out !== '' && !out.endsWith('\n')) out += '\n';
  };

  // A use element has no DOM children for its rendered instance tree. Follow
  // local references at that position, never unused definitions or external
  // documents. Bound both depth and total work for cyclic or expanding graphs.
  const references = new Set<Element>();
  const instances = new SvgInstances();
  let instanceNodes = 10_000;
  const localTarget = (use: Element): Element | undefined => {
    use = instances.source(use);
    const href =
      use.getAttribute('href') ??
      use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href?.startsWith('#') || href.length === 1) return;
    let id: string;
    try {
      id = decodeURIComponent(href.slice(1));
    } catch {
      return;
    }
    const root = use.getRootNode() as Document | ShadowRoot | Element;
    return 'getElementById' in root
      ? (root.getElementById(id) ?? undefined)
      : [root, ...root.querySelectorAll('[id]')].find((node) => node.id === id);
  };

  const walk = (node: Node, inPre: boolean, instanceRoot?: Element) => {
    if (instanceRoot && --instanceNodes < 0) return;
    if (node.nodeType === 3) {
      const parent =
        (node as Text).assignedSlot ??
        node.parentElement ??
        (node.getRootNode() as ShadowRoot).host;
      if (parent && !isRendered(parent, instanceRoot ?? visibilityRoot)) return;
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
    if (
      isHidden(child, child === instanceRoot) ||
      (skip && child !== el && child.matches(skip))
    )
      return;
    if (
      child.namespaceURI === 'http://www.w3.org/2000/svg' &&
      child.localName === 'use'
    ) {
      // Visibility is inherited by the instance and can be overridden inside
      // it; unlike display:none, it does not hide the entire subtree.
      if (!isRendered(child, instanceRoot ?? visibilityRoot, false)) return;
      const target = localTarget(child);
      if (
        !target ||
        target.namespaceURI !== child.namespaceURI ||
        references.has(target) ||
        references.size >= 32
      )
        return;
      references.add(target);
      const instance = instances.expand(child, target);
      if (instance) walk(instance, inPre, instance);
      references.delete(target);
      return;
    }
    if (
      child.matches('input, textarea, select') ||
      (child.hasAttribute('data-action') &&
        getAction(child.getAttribute('data-action')!)?.type === 'cycle')
    ) {
      if (child.matches('input[type="hidden" i]')) return;
      if (!isRendered(child, instanceRoot ?? visibilityRoot)) return;
      out += controlMarker(child);
      return;
    }
    if (child.tagName === 'BR') {
      if (isRendered(child, instanceRoot ?? visibilityRoot)) out += '\n';
      return;
    }
    const block = BLOCKS.has(child.tagName);
    if (block) endLine();
    const closedDetails =
      child.tagName === 'DETAILS' && !child.hasAttribute('open');
    const rendered = composedChildNodes(child);
    const children = closedDetails
      ? rendered.filter((c) => c.nodeType === 1 && !isHidden(c as Element))
      : rendered;
    for (const c of children) {
      walk(c, inPre || child.tagName === 'PRE', instanceRoot);
    }
    if (child.tagName === 'TD' || child.tagName === 'TH') out += '\t';
    if (block) endLine();
  };

  try {
    walk(el, false);
  } finally {
    instances.dispose();
  }
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
export function observableErrors(
  el: Element,
  skip?: string,
  visibilityRoot?: Element,
): string[] {
  const left = (e: Element) => {
    for (let at: Element | null = e; at; at = composedParent(at)) {
      if (isHidden(at)) return true;
      if (at === el) return false;
      if (skip && at.matches(skip)) return true;
    }
    return false;
  };
  return [...composedElements(el)]
    .filter(
      (e) => e.matches('.error') && !left(e) && isRendered(e, visibilityRoot),
    )
    .map((e) => observableText(e, skip, visibilityRoot).trim());
}
