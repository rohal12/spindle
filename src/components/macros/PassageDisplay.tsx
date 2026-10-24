import {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
} from 'preact/hooks';
import { useStoryStore, type StoryState } from '../../store';
import {
  useStoryFields,
  FrozenStateContext,
  OutgoingContext,
} from '../../hooks/use-story-fields';
import { Passage, renderPassageContent } from '../Passage';
import { defineMacro } from '../../define-macro';
import { resolveTransition, type ResolvedTransition } from '../../transition';
import { skipString } from './arg-utils';

/** Input types whose `value` is not what the user sees or edits. */
const VALUELESS_INPUTS = new Set([
  'checkbox',
  'radio',
  'file', // its value can not be set
  'hidden',
  'button',
  'submit',
  'reset',
  'image',
]);

/**
 * Copy the live state cloneNode drops from `source` into its clone: the
 * pixels of each canvas, the state of form controls (cloneNode keeps
 * attributes only, and a canvas's bitmap is not one), and the visible frame
 * and position of media. Source and clone have the same structure, so
 * elements pair up by position. Best effort: a canvas or video that can not
 * be drawn from stays as cloned.
 */
function copyLiveState(source: ParentNode, clone: ParentNode): void {
  const pairs = <T extends Element>(
    selector: string,
    each: (a: T, b: T) => void,
  ) => {
    const from = source.querySelectorAll<T>(selector);
    const to = clone.querySelectorAll<T>(selector);
    from.forEach((el, i) => to[i] && each(el, to[i]!));
  };

  pairs<HTMLCanvasElement>('canvas', (from, to) => {
    if (!from.width || !from.height) return;
    try {
      if (to.width !== from.width) to.width = from.width;
      if (to.height !== from.height) to.height = from.height;
      to.getContext('2d')?.drawImage(from, 0, 0);
    } catch {
      // tainted, lost or foreign-context canvas: the snapshot shows it blank
    }
  });

  pairs<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
    (from, to) => {
      if (from instanceof HTMLSelectElement) {
        // `select.value` is the first selected option only: it loses the other
        // selections of a multiple select (and the pick among options of one
        // value), so a multiple select goes option by option
        const select = to as HTMLSelectElement;
        if (!from.multiple) {
          select.selectedIndex = from.selectedIndex;
        } else {
          for (let i = 0; i < from.options.length; i++) {
            const option = select.options[i];
            if (option) option.selected = from.options[i]!.selected;
          }
        }
      } else if (from instanceof HTMLInputElement) {
        const input = to as HTMLInputElement;
        input.checked = from.checked;
        input.indeterminate = from.indeterminate;
        if (from.type === 'file') input.files = from.files;
        if (!VALUELESS_INPUTS.has(from.type)) input.value = from.value;
      } else {
        to.value = from.value;
      }
    },
  );

  pairs<HTMLMediaElement>('audio, video', (from, to) => {
    // The snapshot is a picture: silent, still, and not started by autoplay
    to.pause?.();
    to.muted = true;
    to.removeAttribute('autoplay');
    try {
      // Applied once the metadata is there: the progress of native controls
      to.currentTime = from.currentTime;
    } catch {
      // no such position yet: the snapshot shows the start
    }
    if (!(from instanceof HTMLVideoElement && to instanceof HTMLVideoElement)) {
      return;
    }
    // A fresh clone decodes nothing, so it would show its first frame (or
    // the poster). Draw the frame on screen now into the poster, which is
    // shown at once and needs no load or seek to finish.
    if (from.readyState < 2 || !from.videoWidth || !from.videoHeight) return;
    try {
      const frame = document.createElement('canvas');
      frame.width = from.videoWidth;
      frame.height = from.videoHeight;
      frame.getContext('2d')?.drawImage(from, 0, 0);
      to.setAttribute('poster', frame.toDataURL('image/jpeg', 0.92));
    } catch {
      // a cross-origin video without CORS taints the canvas: keeps its poster
    }
  });
}

type ScrollOffset = [element: Element, top: number, left: number];

/**
 * Scroll offsets of the elements of `source` (itself included) that are
 * scrolled, keyed by the matching element of `clone`. Applied once the clone
 * is in the page: a detached element has nothing to scroll.
 */
function scrollOffsets(source: ParentNode, clone: ParentNode): ScrollOffset[] {
  const from = [
    ...(source instanceof Element ? [source] : []),
    ...source.querySelectorAll('*'),
  ];
  const to = [
    ...(clone instanceof Element ? [clone] : []),
    ...clone.querySelectorAll('*'),
  ];
  const offsets: ScrollOffset[] = [];
  from.forEach((el, i) => {
    if (to[i] && (el.scrollTop || el.scrollLeft)) {
      offsets.push([to[i]!, el.scrollTop, el.scrollLeft]);
    }
    if (el.shadowRoot && to[i]?.shadowRoot) {
      offsets.push(...scrollOffsets(el.shadowRoot, to[i]!.shadowRoot!));
    }
  });
  return offsets;
}

const pendingScrolls = new WeakMap<Element, ScrollOffset[]>();
const snapshotStyleCleanup = new WeakMap<Element, () => void>();

/** Add `snapshot` to `container`, scrolled as what it shows was. */
function appendSnapshot(container: Element, snapshot: HTMLElement): void {
  container.appendChild(snapshot);
  for (const [el, top, left] of pendingScrolls.get(snapshot) ?? []) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  pendingScrolls.delete(snapshot);
}

function copyComputedStyle(
  style: CSSStyleDeclaration,
  target: CSSStyleDeclaration,
  ids: ReadonlyMap<string, string>,
): void {
  for (let i = 0; i < style.length; i++) {
    const name = style[i]!;
    target.setProperty(
      name,
      snapshotUrls(style.getPropertyValue(name), ids),
      'important',
    );
  }
}

let snapshotFragmentId = 0;

/** SVG definitions need local targets without sharing IDs with live passages. */
function snapshotIds(root: ParentNode): Map<string, string> {
  const ids = new Map<string, string>();
  if (root instanceof Element && root.id) ids.set(root.id, '');
  for (const element of root.querySelectorAll('[id]')) {
    ids.set(element.id, '');
  }
  for (const original of ids.keys()) {
    let id: string;
    do {
      id = `spindle-snapshot-${++snapshotFragmentId}`;
    } while (ids.has(id) || document.getElementById(id));
    ids.set(original, id);
  }
  return ids;
}

/** Rewrite only fragments in this document; external SVG URLs stay external. */
function snapshotFragment(value: string, ids: ReadonlyMap<string, string>) {
  try {
    const url = new URL(value, document.baseURI);
    const current = new URL(document.URL);
    if (url.href.split('#')[0] !== current.href.split('#')[0]) return value;
    let fragment = url.hash.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // Browsers also resolve authored IDs containing a literal percent sign.
    }
    const id = ids.get(fragment);
    return id ? `#${id}` : value;
  } catch {
    return value;
  }
}

/** URL-valued presentation attributes, inline CSS and computed CSS alike. */
function snapshotUrls(
  value: string,
  ids: ReadonlyMap<string, string>,
  base?: string,
) {
  return value.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,
    (match, double, single, bare) => {
      const original: string = double ?? single ?? bare;
      try {
        const resolved = base ? new URL(original, base).href : original;
        const rewritten = snapshotFragment(resolved, ids);
        return original === rewritten ? match : `url("${rewritten}")`;
      } catch {
        return match;
      }
    },
  );
}

/** Keep SVG's specified CSS: a use instance inherits from its use element,
 * rather than from the definition's original parent. Computed defaults on
 * definitions would replace that inheritance (and resolve currentColor).
 */
const snapshotSvgRules = new WeakSet<CSSRule>();

/** A detached style element has no sheet yet. Carry its CSSOM, including
 * script-inserted rules and imported styles, into the passive tree.
 */
function copySnapshotSheet(
  source: CSSStyleSheet,
  ids: ReadonlyMap<string, string>,
  onOpaque?: () => void,
): CSSStyleSheet {
  const seen = new Set<CSSStyleSheet>();
  const textOf = (sheet: CSSStyleSheet): string => {
    if (seen.has(sheet)) return '';
    seen.add(sheet);
    let rules: CSSRule[];
    try {
      rules = [...sheet.cssRules];
    } catch {
      // Imported cross-origin CSS is opaque to the CSSOM. It must not
      // prevent an otherwise valid passage from navigating.
      onOpaque?.();
      return '';
    }
    return rules
      .filter((rule) => !snapshotSvgRules.has(rule))
      .map((rule) => {
        if (rule instanceof CSSImportRule && rule.styleSheet) {
          let css = textOf(rule.styleSheet);
          if (rule.layerName !== null) css = `@layer ${rule.layerName}{${css}}`;
          if (rule.supportsText)
            css = `@supports (${rule.supportsText}){${css}}`;
          if (rule.media.mediaText)
            css = `@media ${rule.media.mediaText}{${css}}`;
          return css;
        }
        return snapshotUrls(rule.cssText, ids, sheet.href ?? document.baseURI);
      })
      .join('\n');
  };
  const copy = new CSSStyleSheet({
    media: source.media.mediaText,
    disabled: source.disabled,
  });
  copy.replaceSync(textOf(source));
  return copy;
}

function installSnapshotSvgStyles(
  root: Document | ShadowRoot,
  ids: ReadonlyMap<string, string>,
  marker: string,
  targetSheets: readonly CSSStyleSheet[] = [
    ...root.styleSheets,
    ...root.adoptedStyleSheets,
  ],
): () => void {
  if (!root.querySelector('svg')) return () => {};
  const customTags = new Set(
    [
      ...(root instanceof ShadowRoot ? [root.host] : []),
      ...root.querySelectorAll('*'),
    ]
      .filter((element) => element.localName.includes('-'))
      .map((element) => element.localName),
  );
  const identity =
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[(?:\\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\]"'\\])*\]|([#.])?((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-]|[^\x00-\x7f])+)/g;
  const selectorOf = (selector: string, scoped = true) => {
    const rewritten = selector.replace(
      identity,
      (written, sigil, escaped, at) => {
        if (!escaped)
          return written.replace(
            /^\[\s*id(?=[\s~|^$*=\]])/,
            '[data-spindle-snapshot-original-id',
          );
        const name = escaped.replace(
          /\\([0-9a-fA-F]{1,6})\s?|\\(.)/g,
          (_: string, hex: string, char: string) =>
            hex ? String.fromCodePoint(parseInt(hex, 16)) : char,
        );
        if (sigil === '.' && name === 'passage')
          return ':is(.passage,.passage-snapshot)';
        if (!sigil && customTags.has(name) && selector[at - 1] !== ':')
          return `:is(${CSS.escape(name)},:where([data-spindle-snapshot-tag="${name}"]))`;
        const id = sigil === '#' && ids.get(name);
        return id
          ? `:is(#${id},:where([data-spindle-snapshot-id="${id}"]))`
          : written;
      },
    );
    if (!scoped) return rewritten;
    // Keep each selector's specificity, including lists with unequal members.
    const selectors: string[] = [];
    let start = 0;
    let depth = 0;
    for (let i = 0; i <= rewritten.length; i++) {
      const ch = rewritten[i];
      if (ch === '\\') i++;
      else if (ch === '"' || ch === "'") i = skipString(rewritten, i) - 1;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (i === rewritten.length || (ch === ',' && depth === 0)) {
        selectors.push(
          `:where([data-spindle-snapshot-svg="${marker}"]):is(${rewritten.slice(start, i)})`,
        );
        start = i + 1;
      }
    }
    return selectors.join(',');
  };
  const rulesOf = (rules: Iterable<CSSRule>, base: string): string[] => {
    const result: string[] = [];
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const css = snapshotUrls(rule.style.cssText, ids, base);
        result.push(`${selectorOf(rule.selectorText)}{${css}}`);
        if (rule.cssRules.length) {
          // Keep the parent selector as the native nesting context. Only
          // declaration targets get the snapshot marker, so an HTML parent
          // can still select an SVG descendant.
          result.push(
            `${selectorOf(rule.selectorText, false)}{${rulesOf(rule.cssRules, base).join('\n')}}`,
          );
        }
      } else if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) {
        const contents = rulesOf((rule as CSSGroupingRule).cssRules, base);
        result.push(
          `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${contents.join('\n')}}`,
        );
      }
    }
    return result;
  };
  type RuleContainer = CSSStyleSheet | CSSGroupingRule;
  const inserted: [RuleContainer, CSSRule][] = [];
  const sheets = new Set<CSSStyleSheet>();
  const sheetRules = (sheet: CSSStyleSheet) => {
    if (
      sheets.has(sheet) ||
      sheet.disabled ||
      !matchMedia(sheet.media.mediaText || 'all').matches
    )
      return;
    sheets.add(sheet);
    try {
      visit(sheet, sheet.href ?? document.baseURI);
    } catch {
      // Cross-origin sheets cannot be inspected. Their unchanged selectors
      // still apply to the passive SVG tree.
    }
  };
  const visit = (parent: RuleContainer, base: string) => {
    for (const rule of [...parent.cssRules]) {
      if (snapshotSvgRules.has(rule)) continue;
      if (rule instanceof CSSStyleRule) {
        let index = [...parent.cssRules].indexOf(rule) + 1;
        for (const css of rulesOf([rule], base)) {
          parent.insertRule(css, index);
          const insertedRule = parent.cssRules[index++]!;
          inserted.push([parent, insertedRule]);
          snapshotSvgRules.add(insertedRule);
        }
      } else if (rule instanceof CSSImportRule) {
        if (
          rule.styleSheet &&
          matchMedia(rule.media.mediaText || 'all').matches
        )
          sheetRules(rule.styleSheet);
      } else if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) {
        visit(rule as CSSGroupingRule, base);
      }
    }
  };
  // Adjacent aliases keep the original layer identity and cascade order,
  // including anonymous layers. They match snapshot elements only.
  for (const sheet of targetSheets) sheetRules(sheet);
  return () => {
    for (const [parent, rule] of inserted) {
      const index = [...parent.cssRules].indexOf(rule);
      if (index >= 0) parent.deleteRule(index);
      snapshotSvgRules.delete(rule);
    }
  };
}

function installSnapshotStyles(
  root: Document | ShadowRoot,
  rules: string[],
): (() => void) | undefined {
  if (!rules.length) return;
  // A style element would change :last-child and other structural selectors.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(rules.join('\n'));
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  return () => {
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
      (current) => current !== sheet,
    );
  };
}

let snapshotPseudoId = 0;

/**
 * Build a visual tree without cloning upgraded custom elements: cloneNode
 * runs their constructors, and insertion runs their connection callbacks.
 * Autonomous elements become styled spans; customized built-ins are created
 * as ordinary native elements, without an `is` option (even if the original
 * has since removed its `is` attribute).
 */
function cloneSnapshotTree(
  source: Element,
  ids: ReadonlyMap<string, string>,
  pseudoRules: string[] = [],
  svgMarker = String(++snapshotPseudoId),
  cleanups: (() => void)[] = [],
): Element {
  const html = source.namespaceURI === 'http://www.w3.org/1999/xhtml';
  const svg = source.namespaceURI === 'http://www.w3.org/2000/svg';
  const custom = html && source.localName.includes('-');
  const clone = document.createElementNS(
    source.namespaceURI,
    custom ? 'span' : source.localName,
  );
  for (const attr of [...source.attributes]) {
    if (
      attr.name === 'id' ||
      attr.name === 'data-action' ||
      attr.name === 'is' ||
      attr.name.toLowerCase().startsWith('on')
    )
      continue;
    const value =
      svg && attr.localName === 'href'
        ? snapshotFragment(attr.value, ids)
        : svg || attr.localName === 'style'
          ? snapshotUrls(attr.value, ids)
          : attr.value;
    if (attr.namespaceURI)
      clone.setAttributeNS(attr.namespaceURI, attr.name, value);
    else clone.setAttribute(attr.name, value);
  }
  if (svg && source.id) {
    clone.id = ids.get(source.id)!;
  }
  if (source.id)
    clone.setAttribute('data-spindle-snapshot-id', ids.get(source.id)!);
  if (source.id)
    clone.setAttribute('data-spindle-snapshot-original-id', source.id);
  if (custom) clone.setAttribute('data-spindle-snapshot-tag', source.localName);
  if (svg) clone.setAttribute('data-spindle-snapshot-svg', svgMarker);
  // IDs and the passage class are removed, and custom tags become spans.
  // Freeze native and custom content before those selectors stop matching.
  const computed = getComputedStyle(source);
  if (!svg) copyComputedStyle(computed, (clone as HTMLElement).style, ids);
  // Generated content needs CSS rules in the same document or shadow root.
  // A unique selector keeps simultaneous snapshots from styling each other.
  let pseudoId: string | undefined;
  for (const pseudo of ['::before', '::after', '::marker']) {
    const style = getComputedStyle(source, pseudo);
    const nativeMarker =
      pseudo === '::marker' && computed.display === 'list-item';
    if (
      !nativeMarker &&
      (!style.content || ['none', 'normal'].includes(style.content))
    )
      continue;
    pseudoId ??= String(++snapshotPseudoId);
    clone.setAttribute('data-spindle-snapshot-pseudo', pseudoId);
    const target = document.createElement('span').style;
    copyComputedStyle(style, target, ids);
    pseudoRules.push(
      `[data-spindle-snapshot-pseudo="${pseudoId}"]${pseudo}{${target.cssText}}`,
    );
  }
  // Recreated scripts must remain inert when inserted, just like the
  // already-executed script nodes that cloneNode used to produce.
  if (source.localName === 'script')
    clone.setAttribute('type', 'application/x-spindle-snapshot');
  const from = source instanceof HTMLTemplateElement ? source.content : source;
  const to = clone instanceof HTMLTemplateElement ? clone.content : clone;
  const copyChildren = (
    from: ParentNode,
    to: ParentNode,
    rules = pseudoRules,
    localIds = ids,
  ) => {
    for (const node of from.childNodes) {
      to.appendChild(
        node instanceof Element
          ? cloneSnapshotTree(node, localIds, rules, svgMarker, cleanups)
          : node.cloneNode(false),
      );
    }
  };
  copyChildren(
    from,
    to,
    pseudoRules,
    source instanceof HTMLTemplateElement ? snapshotIds(from) : ids,
  );
  if (source instanceof HTMLStyleElement && source.sheet) {
    const root = source.getRootNode() as Document | ShadowRoot;
    if (root.querySelector('svg')) {
      let opaque = false;
      const copy = copySnapshotSheet(source.sheet, ids, () => {
        opaque = true;
      });
      // A real style element can retain opaque @imports; constructed sheets
      // discard them. Serialize the original CSSOM with aliases in that case.
      const sheet = opaque ? source.sheet : copy;
      const dispose = installSnapshotSvgStyles(root, ids, svgMarker, [sheet]);
      clone.textContent = snapshotUrls(
        [...sheet.cssRules].map((rule) => rule.cssText).join('\n'),
        ids,
        source.sheet.href ?? document.baseURI,
      );
      dispose();
      if (source.sheet.disabled) clone.setAttribute('media', 'not all');
    }
  }
  if (source.shadowRoot) {
    const shadow = clone.attachShadow({ mode: 'open' });
    const rules: string[] = [];
    const shadowIds = snapshotIds(source.shadowRoot);
    copyChildren(source.shadowRoot, shadow, rules, shadowIds);
    shadow.adoptedStyleSheets = source.shadowRoot.adoptedStyleSheets.map(
      (sheet) => copySnapshotSheet(sheet, shadowIds),
    );
    copyLiveState(source.shadowRoot, shadow);
    cleanups.push(
      installSnapshotSvgStyles(
        source.shadowRoot,
        shadowIds,
        svgMarker,
        shadow.adoptedStyleSheets,
      ),
    );
    installSnapshotStyles(shadow, rules);
  }
  return clone;
}

/** Replace browsing contexts throughout the snapshot, including shadow trees. */
function replaceEmbeddedContexts(source: ParentNode, clone: ParentNode): void {
  const originals = source.querySelectorAll('*');
  const copies = clone.querySelectorAll('*');
  copies.forEach((embedded, i) => {
    const original = originals[i];
    if (!original) return;
    if (original.shadowRoot && embedded.shadowRoot) {
      replaceEmbeddedContexts(original.shadowRoot, embedded.shadowRoot);
    }
    if (!embedded.matches('iframe, object, embed')) return;
    const placeholder = document.createElement('div');
    for (const name of ['class', 'style', 'width', 'height']) {
      const value = embedded.getAttribute(name);
      if (value !== null) placeholder.setAttribute(name, value);
    }
    const rect = original.getBoundingClientRect();
    // Unlike an iframe, an empty inline div does not honor width and height.
    if (getComputedStyle(original).display === 'inline')
      placeholder.style.display = 'inline-block';
    // The measured dimensions already include any copied border and padding.
    placeholder.style.removeProperty('inline-size');
    placeholder.style.removeProperty('block-size');
    placeholder.style.setProperty('box-sizing', 'border-box', 'important');
    placeholder.style.setProperty('width', `${rect.width}px`, 'important');
    placeholder.style.setProperty('height', `${rect.height}px`, 'important');
    embedded.replaceWith(placeholder);
  });
}

/**
 * Create a snapshot clone of a .passage element for outgoing transitions.
 * - Strips authored IDs, action associations and event handlers; SVG IDs and
 *   their fragment references receive snapshot-local names
 * - Disables interaction (pointer-events, user-select, inert, aria-hidden)
 * - Pauses/mutes any <audio>/<video>
 * - Copies what cloneNode leaves behind: canvas pixels, the state of form
 *   controls, the visible frame of videos (#512, #525, #536) and, through
 *   `appendSnapshot`, scroll offsets
 * - Adds `.passage-snapshot` class and `data-transition` attribute
 */
function createSnapshot(
  passageEl: Element,
  transitionType: string,
): HTMLElement {
  const pseudoRules: string[] = [];
  const cleanups: (() => void)[] = [];
  const ids = snapshotIds(passageEl);
  const svgMarker = String(++snapshotPseudoId);
  const clone = cloneSnapshotTree(
    passageEl,
    ids,
    pseudoRules,
    svgMarker,
    cleanups,
  ) as HTMLElement;
  // These belong to the outgoing transition and container, not its frozen
  // visual content. In particular, copied entrance animation must not win.
  clone.style.removeProperty('animation');
  clone.style.removeProperty('grid-area');
  for (const name of ['opacity', 'transform']) {
    // Normal declarations let the outgoing keyframes animate these values.
    clone.style.setProperty(name, clone.style.getPropertyValue(name));
  }
  copyLiveState(passageEl, clone);
  pendingScrolls.set(clone, scrollOffsets(passageEl, clone));

  // A cloned browsing context would reload and execute scripts on insertion.
  // Keep its authored size/style as a passive placeholder instead.
  replaceEmbeddedContexts(passageEl, clone);
  const root = passageEl.getRootNode() as Document | ShadowRoot;
  cleanups.push(installSnapshotSvgStyles(root, ids, svgMarker));
  const cleanup = installSnapshotStyles(root, pseudoRules);
  if (cleanup) cleanups.push(cleanup);
  snapshotStyleCleanup.set(clone, () =>
    cleanups.forEach((dispose) => dispose()),
  );

  // Disable interaction
  clone.style.pointerEvents = 'none';
  clone.style.userSelect = 'none';
  // Visual only: out of the tab order and the accessibility tree, and its
  // controls cannot be activated
  clone.setAttribute('inert', '');
  clone.setAttribute('aria-hidden', 'true');

  // Mark as snapshot
  clone.classList.remove('passage');
  clone.classList.add('passage-snapshot');
  clone.setAttribute('data-transition', transitionType);

  return clone;
}

/**
 * Set CSS custom properties for transition durations on the container element.
 */
function setCSSProperties(el: HTMLElement, config: ResolvedTransition): void {
  el.style.setProperty('--passage-in-duration', `${config.duration / 1000}s`);
  el.style.setProperty('--passage-out-duration', `${config.duration / 1000}s`);
  el.style.setProperty('--passage-pause', `${config.pause / 1000}s`);
}

/**
 * Set up `containerEl` for an outgoing transition and snapshot the passage
 * it shows, or return null if there is no container or passage.
 */
function snapshotPassage(
  containerEl: HTMLElement | null,
  config: ResolvedTransition,
): HTMLElement | null {
  if (!containerEl) return null;
  setCSSProperties(containerEl, config);
  const passageEl = containerEl.querySelector('.passage');
  return passageEl ? createSnapshot(passageEl, config.type) : null;
}

/**
 * Remove all snapshot elements and crossfading class from a container.
 */
function cleanupSnapshots(containerEl: Element | null): void {
  if (!containerEl) return;
  containerEl.classList.remove('passage-container--crossfading');
  const snapshots = containerEl.querySelectorAll('.passage-snapshot');
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i]!;
    snapshotStyleCleanup.get(snapshot)?.();
    snapshotStyleCleanup.delete(snapshot);
    snapshot.remove();
  }
}

/**
 * The navigation each mounted passage display last committed to the page,
 * or null while it shows StoryLoading or is between the passages of a
 * transition (#430).
 */
const shownNavigations = new Map<symbol, number | null>();
const shownListeners = new Set<() => void>();

/**
 * Resolves once every passage display shows the current navigation's
 * passage: after the render deferral ends and any transition has mounted
 * the destination. Immediately when there is no passage display.
 */
export function passageShown(): Promise<void> {
  const settled = () => {
    const { navigationId, renderDeferred } = useStoryStore.getState();
    return (
      !renderDeferred &&
      [...shownNavigations.values()].every((id) => id === navigationId)
    );
  };
  if (settled()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!settled()) return;
      shownListeners.delete(check);
      resolve();
    };
    shownListeners.add(check);
  });
}

/** Scroll the displayed passage's beginning into view if it is above it. */
function scrollToPassageStart(containerEl: Element | null): void {
  const el = containerEl?.querySelector('.passage');
  if (el && el.getBoundingClientRect().top < 0) {
    el.scrollIntoView?.({ block: 'start' });
  }
}

/**
 * `config` for players who prefer reduced motion: the CSS shortens the
 * animations (see styles.css), so the waits that follow them shrink too,
 * leaving no empty passage area before the next passage.
 */
function reduceMotion(config: ResolvedTransition): ResolvedTransition {
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return config;
  }
  return { ...config, duration: Math.min(config.duration, 10), pause: 0 };
}

defineMacro({
  name: 'passage',
  interpolate: true,
  render(_props, ctx) {
    const { currentPassage, navigationId, storyData, renderDeferred } =
      useStoryFields(
        'currentPassage',
        'navigationId',
        'storyData',
        'renderDeferred',
      );

    // Render-gating: displayed controls which passage is visually shown.
    // The store updates immediately, but the visual swap is deferred by the
    // transition state machine. Identity is the navigation id, not the passage
    // name, so revisiting/restarting/loading the same passage remounts it.
    const [displayed, setDisplayed] = useState({
      passage: currentPassage,
      id: navigationId,
    });
    const displayedPassage = displayed.passage;
    const setDisplayedPassage = (passage: string) =>
      setDisplayed({ passage, id: navigationId });

    // Track the resolved transition type for the data-transition prop
    const resolvedTypeRef = useRef<string>('fade');

    const displayedId = displayed.id;
    const isOutgoing = useCallback(
      (state: StoryState) => state.navigationId !== displayedId,
      [displayedId],
    );
    // Read live: a timer asks it before the outgoing tree has unmounted
    const hasLeft = useCallback(
      () => isOutgoing(useStoryStore.getState()),
      [isOutgoing],
    );
    const lastElement = useRef<preact.VNode | null>(null);

    // Container ref for snapshot insertion
    const containerRef = useRef<HTMLDivElement>(null);

    // Track in-progress transition timeouts for cancellation
    const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    // The scroll to the new passage's beginning waits for the removal of an
    // outgoing snapshot that holds the passage down in the page (#431)
    const scrollAfterCleanup = useRef(false);

    /** Cancel any in-progress transition. */
    const cancelTransition = useCallback(() => {
      for (const t of timeoutsRef.current) clearTimeout(t);
      timeoutsRef.current = [];
      scrollAfterCleanup.current = false;
      cleanupSnapshots(containerRef.current);
    }, []);

    // A transition still running on unmount must not fire into it.
    useEffect(() => {
      const container = containerRef.current;
      return () => {
        cancelTransition();
        // The ref may already be cleared when the display unmounts.
        cleanupSnapshots(container);
      };
    }, [cancelTransition]);

    // State machine effect — triggers on every navigation
    useEffect(() => {
      const store = useStoryStore.getState();
      const { replacementNavigationId, transitionConfig } = store;

      const isFirstLoad = !displayedPassage;
      const isReplacement = navigationId === replacementNavigationId;

      // Already showing this navigation (initial render)
      if (navigationId === displayed.id) {
        return;
      }

      // One-shot, used up by the first navigation, whatever we do with it
      // (not by the initial render, which no navigation caused)
      const next = store.consumeNextTransition();

      // Cancel any in-progress transition
      cancelTransition();

      // Get the target passage
      const targetPassage = storyData?.passages.get(currentPassage);
      if (!targetPassage) {
        // Passage not found — show immediately
        resolvedTypeRef.current = 'none';
        setDisplayedPassage(currentPassage);
        return;
      }

      // First load, restart, or load → use simple fade (no outgoing phase)
      if (isFirstLoad || isReplacement) {
        resolvedTypeRef.current = 'fade';
        setDisplayedPassage(currentPassage);
        return;
      }

      // Resolve transition from tags → nextTransition → store default → built-in
      const config = reduceMotion(
        resolveTransition(targetPassage.tags, next, transitionConfig),
      );

      resolvedTypeRef.current = config.type;

      const containerEl = containerRef.current;

      // ---- State machine by type ----

      if (config.type === 'none') {
        // idle → mount new (no animation) → idle
        setDisplayedPassage(currentPassage);
        return;
      }

      if (config.type === 'fade') {
        // idle → mount new → incoming (CSS fade in) → idle
        if (containerEl) setCSSProperties(containerEl, config);
        setDisplayedPassage(currentPassage);
        return;
      }

      // The outgoing transitions start from a snapshot of the current passage
      const snapshot =
        config.type === 'fade-through' || config.type === 'crossfade'
          ? snapshotPassage(containerEl, config)
          : null;
      if (!containerEl || !snapshot) {
        // Fallback: unknown type or nothing to snapshot, just mount
        setDisplayedPassage(currentPassage);
        return;
      }

      if (config.type === 'fade-through') {
        // idle → outgoing (fade out snapshot) → paused → incoming (mount new, fade in) → idle
        appendSnapshot(containerEl, snapshot);

        // Hide the current passage during outgoing phase by setting empty key
        setDisplayedPassage('');

        // After outgoing duration + pause, mount the new passage
        const incomingDelay = config.duration + config.pause;
        const t1 = setTimeout(() => {
          setDisplayedPassage(currentPassage);
        }, incomingDelay);

        // After full transition, clean up snapshot
        const cleanupDelay = incomingDelay + config.duration;
        const t2 = setTimeout(() => {
          cleanupSnapshots(containerEl);
          if (scrollAfterCleanup.current) scrollToPassageStart(containerEl);
          scrollAfterCleanup.current = false;
        }, cleanupDelay);

        timeoutsRef.current = [t1, t2];
        return;
      }

      // crossfade: idle → crossfading (mount new + fade in, simultaneously
      // fade out snapshot) → idle

      // Use CSS grid stacking for crossfade
      containerEl.classList.add('passage-container--crossfading');
      appendSnapshot(containerEl, snapshot);

      // Mount new passage immediately alongside snapshot
      setDisplayedPassage(currentPassage);

      // After duration, clean up snapshot and remove crossfading class
      const t1 = setTimeout(() => {
        cleanupSnapshots(containerEl);
      }, config.duration);

      timeoutsRef.current = [t1];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigationId]);

    // A new passage opens at its beginning, not where the previous one was
    // scrolled to (#354). The page keeps its position on first display
    // (a refresh restores it) and when the beginning is already in view.
    const shownId = displayedPassage && !renderDeferred ? displayed.id : null;
    const lastShownId = useRef(shownId);
    useLayoutEffect(() => {
      if (shownId === null) return; // between passages of a transition
      const previous = lastShownId.current;
      lastShownId.current = shownId;
      if (previous === null || previous === shownId) return;
      const container = containerRef.current;
      // An in-flow snapshot (fade-through) still sits above the passage
      scrollAfterCleanup.current =
        !!container?.querySelector('.passage-snapshot') &&
        !container.classList.contains('passage-container--crossfading');
      if (!scrollAfterCleanup.current) scrollToPassageStart(container);
    }, [shownId]);

    const displayKey = useRef(Symbol('passage-display')).current;
    useLayoutEffect(() => {
      shownNavigations.set(displayKey, shownId);
      [...shownListeners].forEach((check) => check());
    }, [shownId]);
    useLayoutEffect(
      () => () => {
        shownNavigations.delete(displayKey);
        [...shownListeners].forEach((check) => check());
      },
      [],
    );

    // When render is deferred, show StoryLoading passage or nothing
    const effectivePassage = renderDeferred
      ? (storyData?.passages.get('StoryLoading') ?? null)
      : displayedPassage
        ? storyData?.passages.get(displayedPassage)
        : null;

    if (!effectivePassage && displayedPassage && !renderDeferred) {
      return (
        <div class="error">
          Error: Passage &ldquo;{displayedPassage}&rdquo; not found.
        </div>
      );
    }

    const readyPassage = storyData?.passages.get('PassageReady');

    // Between a navigation and the commit of its passage, the old passage is
    // still mounted. It must not execute against the destination's state, so
    // it keeps the element and the state it last rendered with (#352).
    const outgoing = !renderDeferred && displayed.id !== navigationId;
    const passageElement =
      outgoing && lastElement.current
        ? lastElement.current
        : effectivePassage && (
            <Passage
              passage={effectivePassage}
              key={renderDeferred ? 'loading' : `nav-${displayed.id}`}
              dataTransition={renderDeferred ? 'none' : resolvedTypeRef.current}
              navigationId={renderDeferred ? undefined : displayed.id}
            />
          );
    lastElement.current = passageElement || null;

    return (
      <div
        id={ctx.id ?? 'story'}
        class={ctx.className ?? 'story'}
      >
        {!renderDeferred && readyPassage && (
          <div
            key={`ready-${navigationId}`}
            hidden
          >
            {renderPassageContent(readyPassage)}
          </div>
        )}
        <div
          class="passage-container"
          ref={containerRef}
        >
          {passageElement && (
            <FrozenStateContext.Provider value={isOutgoing}>
              <OutgoingContext.Provider value={hasLeft}>
                {passageElement}
              </OutgoingContext.Provider>
            </FrozenStateContext.Provider>
          )}
        </div>
      </div>
    );
  },
});
