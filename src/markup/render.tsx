import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { VarDisplay } from '../components/macros/VarDisplay';
import { ExprDisplay } from '../components/macros/ExprDisplay';
import { WidgetInvocation } from '../components/macros/WidgetInvocation';
import { getWidget } from '../widgets/widget-registry';
import { getMacro, isSubMacro } from '../registry';
import { markdownToHtml } from './markdown';
import { h } from 'preact';
import type { ASTNode, HtmlNode, MacroNode } from './ast';
import { useInterpolate } from '../hooks/use-interpolate';

export interface LocalsUpdater {
  update: (key: string, value: unknown) => void;
  getValues: () => Record<string, unknown>;
}

const defaultUpdater: LocalsUpdater = {
  update: (key: string) => {
    throw new Error(
      `Cannot set @${key} — local variables require a {for}, widget, {link}, or {button} scope`,
    );
  },
  getValues: () => ({}),
};

export const LocalsValuesContext = createContext<Record<string, unknown>>({});
export const LocalsUpdateContext = createContext<LocalsUpdater>(defaultUpdater);
export const NobrContext = createContext(false);
/**
 * True while rendering inside an inline HTML element (e.g. `<span>`), where
 * block-level markdown and `<p>` wrappers would produce invalid HTML (#220).
 * Macro and widget bodies read it so their content stays inline too.
 */
export const InlineContext = createContext(false);
export const SvgContext = createContext(false);
export const WidgetChildrenContext = createContext<ASTNode[] | null>(null);

/**
 * Components rendered for the non-text nodes of one renderNodes() call. Each
 * stands in the markdown source as `<span data-tw="NONCE:INDEX"></span>`.
 * The per-call random nonce means author text that merely looks like a
 * placeholder (e.g. decoded from `&lt;span data-tw=...&gt;`) is never
 * swapped for a component.
 */
interface Placeholders {
  nonce: string;
  components: preact.ComponentChildren[];
}

function placeholderHtml(nonce: string, index: number): string {
  return `<span data-tw="${nonce}:${index}"></span>`;
}

/**
 * A placeholder as text. micromark escapes placeholders in code (a code span
 * of any backtick length, or a fenced code block), so they reach the DOM as
 * literal text and are swapped for the live component there, keeping it
 * subscribed (#223). Letting micromark decide what is code keeps this exact,
 * with no CommonMark re-implementation to drift from it. Also consumes an
 * ESCAPE_GUARD in front of the placeholder.
 */
const PLACEHOLDER_TEXT_RE =
  /(?:(?<=\\)\uE000)?<span data-tw="([0-9a-z]+):(\d+)"><\/span>/g;

/**
 * Emitted between author text ending in a backslash and a placeholder, so
 * the backslash cannot escape the placeholder's `<` and leak it as text. A
 * backslash before a non-punctuation character stays literal in CommonMark,
 * matching what the author wrote. Removed again when converting text nodes.
 */
const ESCAPE_GUARD = '\uE000';

/** Split text into literal parts and the components its placeholders name. */
function expandPlaceholderText(
  text: string,
  ph: Placeholders,
): preact.ComponentChildren[] {
  if (!text.includes('<span data-tw="')) return [text];
  const parts: preact.ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_TEXT_RE)) {
    if (m[1] !== ph.nonce) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(ph.components[parseInt(m[2]!, 10)]);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The component index of a placeholder element of this call, or -1. */
function placeholderIndex(node: Node | null, ph: Placeholders): number {
  if (node == null || node.nodeType !== Node.ELEMENT_NODE) return -1;
  const value = (node as Element).getAttribute('data-tw');
  const prefix = `${ph.nonce}:`;
  if (value == null || !value.startsWith(prefix)) return -1;
  return parseInt(value.slice(prefix.length), 10);
}

/**
 * Convert an HTML string (from micromark) to Preact VNodes,
 * replacing placeholder elements with pre-rendered components.
 * With `unwrapParagraphs` (nobr or inline content), top-level <p> wrappers are
 * replaced by their children.
 */
function htmlToPreact(
  html: string,
  ph: Placeholders,
  unwrapParagraphs = false,
): preact.ComponentChildren {
  const temp = document.createElement('div');
  temp.innerHTML = html.trim();
  if (unwrapParagraphs) {
    for (const p of Array.from(temp.querySelectorAll(':scope > p'))) {
      p.replaceWith(...Array.from(p.childNodes));
    }
  }
  const children = Array.from(temp.childNodes).map((child, i) =>
    convertDomNode(child, i, ph),
  );
  return <>{children}</>;
}

function convertDomNode(
  node: Node,
  key: number,
  ph: Placeholders,
): preact.ComponentChildren {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.textContent ?? '';
    // Drop the escape guard in front of a placeholder element.
    if (
      text.endsWith(`\\${ESCAPE_GUARD}`) &&
      placeholderIndex(node.nextSibling, ph) !== -1
    ) {
      text = text.slice(0, -1);
    }
    const parts = expandPlaceholderText(text, ph);
    return parts.length === 1 ? parts[0] : parts;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const tag = el.localName;

    // Check if it's a placeholder for a Twine component
    const idx = placeholderIndex(el, ph);
    if (idx !== -1) {
      return ph.components[idx];
    }

    // Convert attributes
    const props: Record<string, string | number> = { key };
    for (const attr of Array.from(el.attributes)) {
      props[attr.name] = attr.value;
    }

    // Convert children recursively
    const children = Array.from(el.childNodes).map((child, i) =>
      convertDomNode(child, i, ph),
    );

    return h(tag, props, ...children);
  }
  return null;
}

/** Inline elements where block-level markdown (lists, headings) is invalid. */
const INLINE_ELEMENTS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'i',
  'kbd',
  'label',
  'mark',
  'meter',
  'output',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
]);

/**
 * HTML boolean attributes. Their presence means "on", but a parsed bare or
 * `=""` attribute has the value '', which Preact would assign to the DOM
 * property as a falsy value — so present ones are passed as `true` (#177).
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

function isPresentBooleanAttribute(name: string, value: string): boolean {
  return value === '' && BOOLEAN_ATTRIBUTES.has(name.toLowerCase());
}

function HtmlNodeRenderer({ node }: { node: HtmlNode }) {
  const resolve = useInterpolate();
  const nobr = useContext(NobrContext);
  const locals = useContext(LocalsValuesContext);
  const inSvg = useContext(SvgContext);
  const parentInline = useContext(InlineContext);
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.attributes)) {
    attrs[k] = isPresentBooleanAttribute(k, v) ? true : (resolve(v) ?? v);
  }
  const isSvgRoot = node.tag.toLowerCase() === 'svg';
  const isInline = INLINE_ELEMENTS.has(node.tag.toLowerCase());
  // Inside SVG, skip markdown processing entirely — markdown wraps content
  // in <p> tags which break the SVG namespace.
  // Inside inline elements, disable block-level markdown (lists, headings,
  // blockquotes) and <p> wrappers since those produce invalid HTML inside
  // inline containers. The inline flag reaches nested macro/widget bodies via
  // InlineContext; a block element nested inside resets it.
  let children: preact.ComponentChildren = undefined;
  if (node.children.length > 0) {
    if (inSvg || isSvgRoot) {
      children = renderInlineNodes(node.children);
    } else {
      children = renderNodes(node.children, { nobr, locals, inline: isInline });
      if (isInline !== parentInline) {
        children = (
          <InlineContext.Provider value={isInline}>
            {children}
          </InlineContext.Provider>
        );
      }
    }
  }
  const element = h(node.tag, attrs, children);
  return isSvgRoot ? (
    <SvgContext.Provider value={true}>{element}</SvgContext.Provider>
  ) : (
    element
  );
}

function ChildrenSlot() {
  const childrenAST = useContext(WidgetChildrenContext);
  const nobr = useContext(NobrContext);
  const inline = useContext(InlineContext);
  const locals = useContext(LocalsValuesContext);
  if (!childrenAST || childrenAST.length === 0) return null;
  return <>{renderNodes(childrenAST, { nobr, locals, inline })}</>;
}

/**
 * Stable per-node keys. Keying rendered children by AST node identity (not
 * by position) makes Preact remount components when different content
 * occupies the same slot — e.g. when an {if}/{switch} branch or an included
 * passage changes — so mount-only macros like {set} and {do} run for the new
 * content, while re-rendering the same AST keeps existing instances (#175).
 */
const nodeKeys = new WeakMap<ASTNode, string>();
let nextNodeKey = 0;

function nodeKey(node: ASTNode): string {
  let key = nodeKeys.get(node);
  if (key === undefined) {
    key = `n${nextNodeKey++}`;
    nodeKeys.set(node, key);
  }
  return key;
}

function renderMacro(node: MacroNode, key: string) {
  if (isSubMacro(node.name)) return null;

  const widget = getWidget(node.name);
  if (widget) {
    return (
      <WidgetInvocation
        key={key}
        body={widget.body}
        params={widget.params}
        rawArgs={node.rawArgs}
        invocationChildren={node.children}
      />
    );
  }

  const Component = getMacro(node.name);
  if (Component) {
    return (
      <Component
        key={key}
        rawArgs={node.rawArgs}
        className={node.className}
        id={node.id}
        children={node.children}
        branches={node.branches}
      />
    );
  }

  return (
    <span
      key={key}
      class="error"
    >
      {`{unknown macro: ${node.name}}`}
    </span>
  );
}

/**
 * Render a non-text AST node to a Preact element.
 */
function renderSingleNode(node: ASTNode): preact.ComponentChildren {
  if (node.type === 'text') return node.value;
  const key = nodeKey(node);
  switch (node.type) {
    case 'variable':
      if (node.scope === 'local' && node.name === 'children') {
        return <ChildrenSlot key={key} />;
      }
      return (
        <VarDisplay
          key={key}
          name={node.name}
          scope={node.scope}
          className={node.className}
          id={node.id}
        />
      );

    case 'expression':
      return (
        <ExprDisplay
          key={key}
          expression={node.expression}
          className={node.className}
          id={node.id}
        />
      );

    case 'macro':
      return renderMacro(node, key);

    case 'html':
      return (
        <HtmlNodeRenderer
          key={key}
          node={node}
        />
      );

    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

/**
 * Render AST nodes without markdown processing.
 * Used for inline containers (button labels, link text) where block-level
 * markdown (lists, headers) would misinterpret content like "-" or "+".
 */
export function renderInlineNodes(nodes: ASTNode[]): preact.ComponentChildren {
  if (nodes.length === 0) return null;
  return nodes.map((node) => renderSingleNode(node));
}

/**
 * Characters/patterns that trigger CommonMark or GFM transformations.
 * Any match → fall through to the full micromark pipeline.
 * False positives (e.g. `-` used as text, not list) just use the slower path.
 * Includes character references (`&amp;`, `&#123;`) and two-space hard line
 * breaks, which micromark decodes / turns into <br> (#171).
 */
const MARKDOWN_SYNTAX_RE =
  /[*_`#|~\[>\\\-+=]|!\[|\d+\.|&#?[a-zA-Z0-9]+;| {2}\n/;
const BLANK_LINE_RE = /\n\s*\n/;
const PLACEHOLDER_STRIP_RE = /<span data-tw="[0-9a-z]+:\d+"><\/span>/g;

/**
 * Build Preact vnodes from a combined string that contains only plain text
 * and placeholders. No micromark, no innerHTML.
 */
function buildPlainTextVnodes(
  combined: string,
  ph: Placeholders,
  unwrapParagraphs?: boolean,
): preact.ComponentChildren {
  const children = expandPlaceholderText(combined, ph).filter(
    (part) => part !== '',
  );
  return unwrapParagraphs ? <>{children}</> : h('p', null, ...children);
}

/**
 * Render AST nodes with full CommonMark markdown support.
 *
 * Combines all nodes into a single markdown document, using placeholder
 * elements (see Placeholders) for non-text nodes (variables, macros, links,
 * HTML). This allows
 * markdown syntax to span across Twine tokens — e.g., markdown tables can
 * contain {$variables} and {macros} in their cells.
 *
 * After micromark processes the combined string, the HTML is parsed back into
 * Preact VNodes with placeholders replaced by the real rendered components.
 * Placeholders that micromark escaped as code text are swapped back too (see
 * PLACEHOLDER_TEXT_RE), so variables in code stay live components.
 */
export function renderNodes(
  nodes: ASTNode[],
  options?: {
    nobr?: boolean;
    /** Unused: components read locals from LocalsValuesContext. Kept for API compatibility. */
    locals?: Record<string, unknown>;
    inline?: boolean;
  },
): preact.ComponentChildren {
  if (nodes.length === 0) return null;

  // Skip the markdown pipeline when text nodes contain only whitespace.
  // This eliminates ~97 redundant micromark + innerHTML calls per render
  // in {for} loops over HTML + macro content (issue #143).
  // However, don't skip if any text node contains blank lines (\n\n), as those
  // have markdown semantics (paragraph separation).
  const needsMarkdown = nodes.some(
    (n) =>
      n.type === 'text' && (n.value.trim() !== '' || /\n\s*\n/.test(n.value)),
  );
  if (!needsMarkdown) {
    return nodes.map((node) => renderSingleNode(node));
  }

  // Build combined markdown string with placeholders for non-text nodes
  const components: preact.ComponentChildren[] = [];
  const ph: Placeholders = {
    nonce: Math.random().toString(36).slice(2, 10) || '0',
    components,
  };
  let combined = '';

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === 'text') {
      combined += node.value;
      continue;
    }
    const phIdx = components.length;
    components.push(renderSingleNode(node));
    if (combined.endsWith('\\')) combined += ESCAPE_GUARD;
    combined += placeholderHtml(ph.nonce, phIdx);
  }

  // Fast path: skip micromark + innerHTML when text has no markdown syntax.
  // This eliminates ~655 innerHTML calls on plain UI text like "ALMA",
  // "▸ Crew", "Activate" that pass through the full pipeline only to
  // produce the same text they started with (issue #145).
  // Inline content (inside <span> etc.) never gets <p> wrappers (#220).
  const unwrapParagraphs = !!(options?.nobr || options?.inline);
  const textOnly = combined.replace(PLACEHOLDER_STRIP_RE, '');
  if (!MARKDOWN_SYNTAX_RE.test(textOnly) && !BLANK_LINE_RE.test(textOnly)) {
    return buildPlainTextVnodes(combined, ph, unwrapParagraphs);
  }

  // Run combined text through markdown
  const html = markdownToHtml(combined, { inline: options?.inline });

  // Convert HTML to Preact VNodes, replacing placeholders with components
  return htmlToPreact(html, ph, unwrapParagraphs);
}
