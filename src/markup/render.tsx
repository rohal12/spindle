import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { VarDisplay } from '../components/macros/VarDisplay';
import { ExprDisplay } from '../components/macros/ExprDisplay';
import { WidgetInvocation } from '../components/macros/WidgetInvocation';
import { getWidget } from '../widgets/widget-registry';
import { getMacro, isSubMacro } from '../registry';
import { markdownToHtml } from './markdown';
import { h } from 'preact';
import type { ASTNode, HtmlNode, MacroNode } from './ast';
import { useInterpolate } from '../hooks/use-interpolate';
import { splitTemplate } from '../interpolation';

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
 * stands in the markdown source as `<span data-tw=NONCE:INDEX></span>`.
 * The per-call random nonce means author text that merely looks like a
 * placeholder (e.g. decoded from `&lt;span data-tw=...&gt;`) is never
 * swapped for a component. The attribute value is unquoted so a placeholder
 * can sit inside a quoted markdown link title or image alt text.
 */
interface Placeholders {
  nonce: string;
  components: preact.ComponentChildren[];
  /**
   * Per placeholder, the node as attribute text (image alt, link title):
   * variables and expressions as interpolations, HTML elements as the text
   * of their children. Macros have no text form and are dropped there, the
   * way markdown drops tags from alt text.
   */
  texts: AttributePart[][];
}

/** An attribute value as literal text and `{…}` interpolations. */
type AttributePart = { literal: string } | { interpolation: string };

function placeholderHtml(nonce: string, index: number): string {
  return `<span data-tw=${nonce}:${index}></span>`;
}

const SCOPE_SIGILS = {
  variable: '$',
  temporary: '_',
  local: '@',
  transient: '%',
} as const;

/** A node's text for use in an attribute value. */
function attributeText(node: ASTNode): AttributePart[] {
  switch (node.type) {
    case 'text':
      return [{ literal: node.value }];
    case 'variable':
      if (node.scope === 'local' && node.name === 'children') return [];
      return [{ interpolation: `{${SCOPE_SIGILS[node.scope]}${node.name}}` }];
    case 'expression':
      return [{ interpolation: `{${node.expression}}` }];
    case 'html':
      return node.children.flatMap(attributeText);
    default:
      return [];
  }
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
  /(?:(?<=\\)\uE000)?<span data-tw=([0-9a-z]+):(\d+)><\/span>/g;

/**
 * Emitted between author text ending in a backslash and a placeholder, so
 * the backslash cannot escape the placeholder's `<` and leak it as text. A
 * backslash before a non-punctuation character stays literal in CommonMark,
 * matching what the author wrote. Removed again when converting text nodes.
 */
const ESCAPE_GUARD = '\uE000';

/**
 * Split text into literal strings and the indexes of this call's
 * placeholders in it.
 */
function splitPlaceholderText(
  text: string,
  ph: Placeholders,
): (string | number)[] {
  if (!text.includes('<span data-tw=')) return [text];
  const parts: (string | number)[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_TEXT_RE)) {
    if (m[1] !== ph.nonce) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(parseInt(m[2]!, 10));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Split text into literal parts and the components its placeholders name. */
function expandPlaceholderText(
  text: string,
  ph: Placeholders,
): preact.ComponentChildren[] {
  return splitPlaceholderText(text, ph).map((part) =>
    typeof part === 'number' ? ph.components[part] : part,
  );
}

/**
 * An element whose attributes contain placeholders (a variable in image alt
 * text or a link title). The interpolations resolve against the store and
 * locals, so the attribute follows the variable as the component would.
 */
function PlaceholderAttributes({
  tag,
  props,
  attributes,
  children,
}: {
  tag: string;
  props: Record<string, string>;
  attributes: Record<string, AttributePart[]>;
  children: preact.ComponentChildren[];
}) {
  const resolve = useInterpolate();
  const resolved: Record<string, string> = { ...props };
  for (const [name, parts] of Object.entries(attributes)) {
    resolved[name] = parts
      .map((p) =>
        'literal' in p ? p.literal : (resolve(p.interpolation) ?? ''),
      )
      .join('');
  }
  return h(tag, resolved, ...children);
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
    const props: Record<string, string> = {};
    let withPlaceholders: Record<string, AttributePart[]> | undefined;
    for (const attr of Array.from(el.attributes)) {
      const parts = splitPlaceholderText(attr.value, ph);
      if (parts.every((part) => typeof part === 'string')) {
        props[attr.name] = attr.value;
        continue;
      }
      withPlaceholders ??= {};
      withPlaceholders[attr.name] = parts.flatMap((part) =>
        typeof part === 'string' ? [{ literal: part }] : ph.texts[part]!,
      );
    }

    // Convert children recursively
    const children = Array.from(el.childNodes).map((child, i) =>
      convertDomNode(child, i, ph),
    );

    if (withPlaceholders) {
      return (
        <PlaceholderAttributes
          key={key}
          tag={tag}
          props={props}
          attributes={withPlaceholders}
          children={children}
        />
      );
    }
    return h(tag, { ...props, key }, ...children);
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
 * Attributes that Preact keeps as DOM properties on author HTML elements:
 * the live state of form controls and media, which then follows its
 * variable even after the reader changed it. Boolean ones written bare or
 * as `=""` are passed as `true`, since '' is falsy (#177); one that only
 * resolves to '' through an interpolation stays ''.
 */
const LIVE_PROPERTIES = new Set(['value', 'checked', 'selected', 'muted']);

/**
 * HTML boolean attributes: present means on. Written bare or with a value
 * they are present, as in HTML; one whose interpolation resolves to ''
 * (`disabled="{$locked ? 'disabled' : ''}"`) is left out, so a variable can
 * switch it off.
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

/** Names Preact consumes instead of setting (case-sensitive). */
const PREACT_RESERVED = new Set([
  'key',
  'ref',
  'children',
  'dangerouslySetInnerHTML',
]);

/** Attribute names setAttribute accepts (`@click` is parsed, not settable). */
const SETTABLE_NAME = /^[A-Za-z_:][\w:.-]*$/;

/**
 * Set an attribute exactly as written, also one whose name setAttribute
 * rejects but the HTML parser accepts: such an attribute is parsed and its
 * node copied over.
 */
function setRawAttribute(el: Element, name: string, value: string) {
  if (SETTABLE_NAME.test(name)) {
    el.setAttribute(name, value);
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = `<i ${name}=""></i>`;
  const parsed = (template.content.firstChild as Element).attributes[0];
  if (!parsed) return;
  const attr = parsed.cloneNode() as Attr;
  attr.value = value;
  el.setAttributeNode(attr);
}

/**
 * Split author attributes into Preact props and attributes to set directly.
 *
 * Author HTML means attributes, but as props Preact assigns names of DOM
 * properties to the property (so `draggable="false"` and
 * `spellcheck="false"` meant true), registers `on…` as event listeners (an
 * `onclick="…"` string threw) and consumes `key`, `ref` (a string threw),
 * `children` and `dangerouslySetInnerHTML`; preact/compat, which spindle
 * loads, also drops an empty `class` and `translate="no"`.
 *
 * On HTML elements an upper-case prop name avoids all of these, and
 * setAttribute lower-cases it back. Names compat matches in any case
 * (`on…`, `translate`), names setAttribute rejects, and on SVG elements,
 * whose names are case-sensitive, Preact's reserved names are set directly
 * instead.
 */
function splitAttributes(
  attributes: [name: string, value: string, written: string][],
  svg: boolean,
): { props: Record<string, unknown>; direct: [string, string][] } {
  const props: Record<string, unknown> = {};
  const direct: [string, string][] = [];
  for (const [name, value, written] of attributes) {
    const lower = name.toLowerCase();
    if (BOOLEAN_ATTRIBUTES.has(lower) && written !== '' && value === '') {
      continue;
    } else if (!svg && LIVE_PROPERTIES.has(lower)) {
      props[lower] = lower !== 'value' && written === '' ? true : value;
    } else if (
      !SETTABLE_NAME.test(name) ||
      lower.startsWith('on') ||
      lower === 'translate' ||
      (svg && (PREACT_RESERVED.has(name) || name === '__proto__'))
    ) {
      direct.push([name, value]);
    } else {
      props[svg ? name : name.toUpperCase()] = value;
    }
  }
  return { props, direct };
}

const decodedAttributeText = new Map<string, string>();

/**
 * Decode character references (`&amp;`, `&#123;`) in attribute text the way
 * the HTML parser decodes an attribute value, by letting it parse one.
 */
function decodeAttributeText(text: string): string {
  if (!text.includes('&')) return text;
  let decoded = decodedAttributeText.get(text);
  if (decoded === undefined) {
    const template = document.createElement('template');
    template.innerHTML = `<i title="${text.replace(/"/g, '&quot;')}"></i>`;
    decoded =
      (template.content.firstChild as Element).getAttribute('title') ?? text;
    decodedAttributeText.set(text, decoded);
  }
  return decoded;
}

/**
 * An author-written attribute value with its `{…}` interpolations resolved
 * and the character references in its literal text decoded. A reference
 * that decodes to a brace (`&#123;$x}`) stays literal, not an interpolation.
 */
function resolveAttributeValue(
  value: string,
  resolve: (s: string | undefined) => string | undefined,
): string {
  if (!value.includes('&')) return resolve(value) ?? value;
  return splitTemplate(value)
    .map((part) =>
      'text' in part
        ? decodeAttributeText(part.text)
        : (resolve(`{${part.expr}}`) ?? ''),
    )
    .join('');
}

function HtmlNodeRenderer({ node }: { node: HtmlNode }) {
  const resolve = useInterpolate();
  const nobr = useContext(NobrContext);
  const locals = useContext(LocalsValuesContext);
  const inSvg = useContext(SvgContext);
  const parentInline = useContext(InlineContext);
  const resolved = Object.entries(node.attributes).map(
    ([k, v]): [string, string, string] => [
      k,
      resolveAttributeValue(v, resolve),
      v,
    ],
  );
  const isSvgRoot = node.tag.toLowerCase() === 'svg';
  const { props, direct } = splitAttributes(resolved, inSvg || isSvgRoot);
  const elementRef = useRef<Element>(null);
  const directKey = JSON.stringify(direct);
  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el || direct.length === 0) return;
    for (const [name, value] of direct) setRawAttribute(el, name, value);
    return () => {
      for (const [name] of direct) el.removeAttribute(name);
    };
  }, [directKey]);
  if (direct.length > 0) props.ref = elementRef;
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
  const element = h(node.tag, props, children);
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
  /[*_`#|~\[>\\\-+=]|!\[|\d+[.)]|&#?[a-zA-Z0-9]+;| {2}\n/;
const BLANK_LINE_RE = /\n\s*\n/;
const PLACEHOLDER_STRIP_RE = /<span data-tw=[0-9a-z]+:\d+><\/span>/g;

/** Whitespace that markdown strips at the start and end of a paragraph. */
const LEADING_WS_RE = /^[ \t\r\n]*/;
const TRAILING_WS_RE = /[ \t\r\n]*$/;

/**
 * Build Preact vnodes from a combined string that contains only plain text
 * and placeholders. No micromark, no innerHTML. The text is the content of
 * one paragraph, so like micromark it drops spaces and tabs around line
 * endings; its edges are already split off by the caller.
 */
function buildPlainTextVnodes(
  core: string,
  ph: Placeholders,
  unwrapParagraphs?: boolean,
): preact.ComponentChildren {
  const children = expandPlaceholderText(
    core.replace(/[ \t]*\n[ \t]*/g, '\n'),
    ph,
  ).filter((part) => part !== '');
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
    texts: [],
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
    ph.texts.push(attributeText(node));
    if (combined.endsWith('\\')) combined += ESCAPE_GUARD;
    combined += placeholderHtml(ph.nonce, phIdx);
  }

  // Fast path: skip micromark + innerHTML when text has no markdown syntax.
  // This eliminates ~655 innerHTML calls on plain UI text like "ALMA",
  // "▸ Crew", "Activate" that pass through the full pipeline only to
  // produce the same text they started with (issue #145).
  // Inline content (inside <span> etc.) never gets <p> wrappers (#220).
  const unwrapParagraphs = !!(options?.nobr || options?.inline);

  // Markdown strips whitespace at paragraph edges. Without <p> wrappers that
  // whitespace separates this content from its neighbours (as in
  // `<span>*HP*: </span>{$hp}`), so it is kept around the output there.
  const lead = LEADING_WS_RE.exec(combined)![0];
  const trail =
    lead.length === combined.length ? '' : TRAILING_WS_RE.exec(combined)![0];
  const core = combined.slice(lead.length, combined.length - trail.length);
  const edges = (content: preact.ComponentChildren) =>
    unwrapParagraphs && (lead || trail) ? (
      <>
        {lead}
        {content}
        {trail}
      </>
    ) : (
      content
    );

  const textOnly = combined.replace(PLACEHOLDER_STRIP_RE, '');
  if (!MARKDOWN_SYNTAX_RE.test(textOnly) && !BLANK_LINE_RE.test(textOnly)) {
    return edges(buildPlainTextVnodes(core, ph, unwrapParagraphs));
  }

  // Run combined text through markdown
  const html = markdownToHtml(combined, { inline: options?.inline });

  // Convert HTML to Preact VNodes, replacing placeholders with components
  return edges(htmlToPreact(html, ph, unwrapParagraphs));
}
