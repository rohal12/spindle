import { createContext, type RefObject } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { VarDisplay } from '../components/macros/VarDisplay';
import { ExprDisplay } from '../components/macros/ExprDisplay';
import { WidgetInvocation } from '../components/macros/WidgetInvocation';
import { getWidget } from '../widgets/widget-registry';
import { getMacro, isSubMacro } from '../registry';
import { markdownToHtml } from './markdown';
import { h } from 'preact';
import type { ASTNode, HtmlNode, MacroNode } from './ast';
import { useTextScope } from '../hooks/use-interpolate';
import type { WidgetChildren } from '../interpolation';
import { useRenderOptions } from '../hooks/use-render-options';
import {
  hasInterpolation,
  interpolateCode,
  mapTextNodes,
  parseText,
  renderText,
  type ParsedText,
  type TextError,
  type TextScope,
} from '../interpolation';
import { MacroError } from '../components/macros/MacroError';
import { isCodeAttribute } from './code-attributes';
import { errorMessage } from '../utils/error-message';
import { EMPTY_NAMESPACE } from '../utils/namespace';

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
  getValues: () => EMPTY_NAMESPACE,
};

export const LocalsValuesContext =
  createContext<Record<string, unknown>>(EMPTY_NAMESPACE);
export const LocalsUpdateContext = createContext<LocalsUpdater>(defaultUpdater);
export const NobrContext = createContext(false);
/** Whether the markup is the story interface, which stays mounted (#419). */
export const InterfaceContext = createContext(false);
/**
 * True while rendering inside an inline HTML element (e.g. `<span>`), where
 * block-level markdown and `<p>` wrappers would produce invalid HTML (#220).
 * Macro and widget bodies read it so their content stays inline too.
 */
export const InlineContext = createContext(false);
/**
 * True while rendering the content of a structural HTML element (see
 * STRUCTURAL_ELEMENTS) whose own children are all elements: macro and widget
 * bodies read it so the elements they produce (the rows of a `{for}`) stay
 * its direct children (#436). An element resets it for its own content.
 */
export const StructuralContext = createContext(false);
/**
 * True while rendering inside an element whose content is not markdown: SVG
 * (whose namespace `<p>` wrappers would break) and the preformatted `<pre>`
 * `<textarea>` and `<style>`, whose text (indentation, `#`, `*`, ...) is literal.
 * Macro and widget bodies read it so their content stays literal too.
 */
export const RawTextContext = createContext(false);

/**
 * The view content is rendered in: '' for the story interface, and an id of
 * its own for each passage and dialog on display (see useViewScope). The
 * radiobuttons of a variable form a native group within their view only:
 * one group across views would let a dialog's checked button uncheck the
 * passage's when it mounts (#396).
 */
export const ViewScopeContext = createContext('');

let viewScopes = 0;

/** A new view scope (see ViewScopeContext), kept while mounted. */
export function useViewScope(): string {
  return useState(() => `v${++viewScopes}`)[0];
}

/**
 * True inside an `<svg>` element. SVG attributes are case-sensitive and have
 * no live form properties, so they are set as written (see splitAttributes).
 */
const SvgContext = createContext(false);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Elements whose children must be elements of particular types: markdown
 * paragraphs between them would pull the children out of the structure (#423).
 * Text between the children, when it is only whitespace, is dropped.
 */
const STRUCTURAL_ELEMENTS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'colgroup',
  'ul',
  'ol',
  'menu',
  'dl',
  'select',
  'optgroup',
  'datalist',
]);

/** Elements whose content is literal text, not markdown. */
const PREFORMATTED_ELEMENTS = new Set(['pre', 'textarea', 'style']);
export const WidgetChildrenContext = createContext<WidgetChildren | null>(null);

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
   * Per placeholder, its node, for use in an attribute (image alt text, a
   * link title), where it stands for its text (see interpolation.ts).
   */
  nodes: ASTNode[];
}

function placeholderHtml(nonce: string, index: number): string {
  return `<span data-tw=${nonce}:${index}></span>`;
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

/** An attribute: its name, value and value as written (see splitAttributes). */
type Attribute = [name: string, value: string, written: string];

/**
 * An element of markdown output whose attributes contain placeholders (a
 * variable in image alt text or a link title). Each such attribute is
 * evaluated as text against the store and locals, so it follows its
 * variables as the component would.
 */
function PlaceholderAttributes({
  tag,
  attributes,
  placeholders,
  svg,
  children,
}: {
  tag: string;
  attributes: Attribute[];
  placeholders: Record<string, ASTNode[]>;
  svg: boolean;
  children: preact.ComponentChildren[];
}) {
  const scope = useTextScope();
  const errors: AttributeError[] = [];
  const resolved = attributes.map(([name, value, written]): Attribute => {
    const nodes = placeholders[name];
    if (!nodes) return [name, value, written];
    const result = renderText(nodes, scope);
    for (const error of result.errors) errors.push([name, error]);
    return [name, result.text, written];
  });
  const { props, direct } = splitAttributes(resolved, svg);
  const ref = useDirectAttributes(direct);
  return withAttributeErrors(
    errors,
    h(tag, ref ? { ...props, ref } : props, ...children),
  );
}

/** An element of markdown output with attributes to set directly. */
function DirectAttributes({
  tag,
  props,
  direct,
  children,
}: {
  tag: string;
  props: Record<string, unknown>;
  direct: [string, string][];
  children: preact.ComponentChildren[];
}) {
  const ref = useDirectAttributes(direct);
  return h(tag, { ...props, ref }, ...children);
}

/** An error met while evaluating the named attribute. */
type AttributeError = [attribute: string, error: TextError];

/**
 * Show the errors met in an element's attributes in front of it, the way a
 * failing macro shows its error in passage text.
 */
function withAttributeErrors(
  errors: AttributeError[],
  element: preact.ComponentChildren,
): preact.ComponentChildren {
  if (errors.length === 0) return element;
  return (
    <>
      {errors.map(([name, { macro, error }], i) => (
        <MacroError
          key={i}
          macro={macro}
          error={new Error(`in attribute "${name}": ${errorMessage(error)}`)}
        />
      ))}
      {element}
    </>
  );
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
 * Parse HTML into nodes without side effects. The content of a `<template>`
 * belongs to a document with no browsing context, so parsing it fetches no
 * images and media, runs no inline event handlers (`<img onerror>`) and
 * constructs no custom elements. A detached `<div>` belongs to the page's
 * document, which does all of these while parsing.
 */
export function parseHtmlInert(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
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
  const content = parseHtmlInert(html.trim());
  if (unwrapParagraphs) {
    for (const child of Array.from(content.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && child.nodeName === 'P') {
        (child as Element).replaceWith(...Array.from(child.childNodes));
      }
    }
  }
  const children = Array.from(content.childNodes).map((child, i) =>
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

    // Convert attributes, as author HTML's (see splitAttributes): markdown
    // output holds raw HTML from text nodes (a custom macro's, or comments)
    const svg = el.namespaceURI === SVG_NAMESPACE;
    const attributes: Attribute[] = [];
    let placeholders: Record<string, ASTNode[]> | undefined;
    for (const { name, value } of Array.from(el.attributes)) {
      attributes.push([name, value, value]);
      const parts = splitPlaceholderText(value, ph);
      if (parts.every((part) => typeof part === 'string')) continue;
      placeholders ??= {};
      placeholders[name] = parts.map((part): ASTNode =>
        typeof part === 'string'
          ? { type: 'text', value: part }
          : ph.nodes[part]!,
      );
    }

    // Convert children recursively
    const children = Array.from(el.childNodes).map((child, i) =>
      convertDomNode(child, i, ph),
    );

    if (placeholders) {
      return (
        <PlaceholderAttributes
          key={key}
          tag={tag}
          attributes={attributes}
          placeholders={placeholders}
          svg={svg}
          children={children}
        />
      );
    }
    const { props, direct } = splitAttributes(attributes, svg);
    if (direct.length > 0) {
      return (
        <DirectAttributes
          key={key}
          tag={tag}
          props={props}
          direct={direct}
          children={children}
        />
      );
    }
    return h(tag, { ...props, key }, ...children);
  }
  return null;
}

/**
 * Elements whose content is phrasing content only, so block-level markdown
 * (lists, headings, paragraphs) is invalid in them: inline elements, and
 * block elements such as headings and buttons that only take inline children.
 */
const INLINE_ELEMENTS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'button',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'i',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'kbd',
  'label',
  'legend',
  'mark',
  'meter',
  'option',
  'output',
  'p',
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
  'summary',
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

/** Names set directly on SVG elements (see splitAttributes). */
const SVG_DIRECT = new Set([...PREACT_RESERVED, 'class', 'className']);

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
  const parsed = (parseHtmlInert(`<i ${name}=""></i>`).firstChild as Element)
    .attributes[0];
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
 * whose names are case-sensitive, Preact's reserved names and the `class`
 * and `className` compat rewrites (dropping an empty `class`, turning
 * `className` into `class`) are set directly instead.
 */
function splitAttributes(
  attributes: Attribute[],
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
      (svg && (SVG_DIRECT.has(name) || name === '__proto__'))
    ) {
      direct.push([name, value]);
    } else {
      props[svg ? name : name.toUpperCase()] = value;
    }
  }
  return { props, direct };
}

/**
 * Set the attributes `splitAttributes` leaves to set directly on the element
 * given the returned ref (none if there are none), and remove them again
 * when they change.
 */
function useDirectAttributes(
  direct: [string, string][],
): RefObject<Element | null> | undefined {
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
  return direct.length > 0 ? elementRef : undefined;
}

const decodedText = new Map<string, string>();
const decodedAttributeText = new Map<string, string>();

/**
 * Decode character references (`&amp;`, `&#123;`) in `text` the way the HTML
 * parser decodes them, by letting it parse them: in an attribute value, or
 * else in element text.
 */
function decodeReferences(
  text: string,
  cache: Map<string, string>,
  parse: (text: string) => string | null,
): string {
  if (!text.includes('&')) return text;
  let decoded = cache.get(text);
  if (decoded === undefined) {
    decoded = parse(text) ?? text;
    cache.set(text, decoded);
  }
  return decoded;
}

function decodeAttributeText(text: string): string {
  return decodeReferences(text, decodedAttributeText, (t) => {
    const html = `<i title="${t.replace(/"/g, '&quot;')}"></i>`;
    return (parseHtmlInert(html).firstChild as Element).getAttribute('title');
  });
}

/** Literal text outside markdown (preformatted and SVG elements). */
function decodeText(text: string): string {
  return decodeReferences(text, decodedText, (t) => {
    const html = `<i>${t.replace(/</g, '&lt;')}</i>`;
    return parseHtmlInert(html).firstChild!.textContent;
  });
}

/** A `{` and a sigil starting a reference, in a code attribute. */
const SIGIL_REFERENCE = /\{[$_@%]\w/;

const attributeNodes = new Map<string, ParsedText>();
const ATTRIBUTE_CACHE_LIMIT = 2000;

/**
 * Parse an author-written attribute value as text-only markup, with the
 * character references in its literal text decoded (macro bodies included).
 * Decoding follows parsing, so a reference that decodes to a brace
 * (`&#123;$x}`) stays literal, and a variable's value is never decoded.
 */
function parseAttributeValue(value: string): ParsedText {
  let parsed = attributeNodes.get(value);
  if (parsed === undefined) {
    parsed = parseText(value);
    if ('nodes' in parsed && value.includes('&')) {
      parsed = { nodes: mapTextNodes(parsed.nodes, decodeAttributeText) };
    }
    if (attributeNodes.size >= ATTRIBUTE_CACHE_LIMIT) attributeNodes.clear();
    attributeNodes.set(value, parsed);
  }
  return parsed;
}

/**
 * An author-written attribute value with its markup evaluated (see
 * interpolation.ts) and its character references decoded. Errors are added
 * to `errors`; a value whose markup doesn't parse is kept as written. The
 * value of a code attribute (`onclick`, see isCodeAttribute) only has its
 * sigil references resolved.
 */
function resolveAttributeValue(
  name: string,
  value: string,
  scope: TextScope,
  errors: AttributeError[],
): string {
  if (isCodeAttribute(name)) {
    // As before #225: without a character reference, a value with no sigil
    // reference is taken as written.
    if (!value.includes('&') && !SIGIL_REFERENCE.test(value)) return value;
    const result = interpolateCode(value, scope, decodeAttributeText);
    for (const error of result.errors) errors.push([name, error]);
    return result.text;
  }
  if (!hasInterpolation(value)) return decodeAttributeText(value);
  const parsed = parseAttributeValue(value);
  if ('error' in parsed) {
    errors.push([name, { macro: 'markup', error: parsed.error }]);
    return decodeAttributeText(value);
  }
  const result = renderText(parsed.nodes, scope);
  for (const error of result.errors) errors.push([name, error]);
  return result.text;
}

/** Whether a node shows nothing as text: whitespace, or a closed HTML comment. */
function isBlankText(n: ASTNode): boolean {
  return n.type === 'text' && (n.comment === true || n.value.trim() === '');
}

/**
 * The element a container must open with, to stay its direct child: the
 * summary of a details element (#382), the legend of a fieldset (#475), whose
 * first legend exempts the controls in it from the fieldset's `disabled`.
 */
const LEADING_PARTS: Record<string, string> = {
  details: 'summary',
  fieldset: 'legend',
};

/**
 * The index of the node opening `nodes` as the leading part of the `tag`
 * container, or -1 when none does: the element itself, or a macro, which may
 * render it ({if}, {include}, a widget: #474).
 */
function leadingPartIndex(tag: string, nodes: ASTNode[]): number {
  const part = LEADING_PARTS[tag];
  const at = nodes.findIndex((n) => !isBlankText(n));
  const first = nodes[at];
  return part &&
    (first?.type === 'macro' ||
      (first?.type === 'html' && first.tag.toLowerCase() === part))
    ? at
    : -1;
}

function HtmlNodeRenderer({ node }: { node: HtmlNode }) {
  const scope = useTextScope();
  const {
    nobr,
    locals,
    raw: inRaw,
    inline: parentInline,
    structural: parentStructural,
  } = useRenderOptions();
  const inSvg = useContext(SvgContext);
  const tag = node.tag.toLowerCase();
  const isSvgRoot = tag === 'svg';
  // The content of a foreignObject is HTML again (see below)
  const isHtmlRoot = inSvg && tag === 'foreignobject';
  const rawContent = inRaw && !isHtmlRoot;
  const isRawRoot = !inRaw && (isSvgRoot || PREFORMATTED_ELEMENTS.has(tag));
  const errors: AttributeError[] = [];
  const resolved = Object.entries(node.attributes).map(([k, v]): Attribute => [
    k,
    resolveAttributeValue(k, v, scope, errors),
    v,
  ]);
  const { props, direct } = splitAttributes(resolved, inSvg || isSvgRoot);
  const ref = useDirectAttributes(direct);
  if (ref) props.ref = ref;
  const isInline = INLINE_ELEMENTS.has(tag);
  // Inside SVG and preformatted elements, skip markdown processing entirely
  // (see RawTextContext).
  // Inside inline elements, disable block-level markdown (lists, headings,
  // blockquotes) and <p> wrappers since those produce invalid HTML inside
  // inline containers. The inline flag reaches nested macro/widget bodies via
  // InlineContext; a block element nested inside resets it.
  let children: preact.ComponentChildren = undefined;
  let structural = false;
  if (node.children.length > 0) {
    if (tag === 'style') {
      // A raw-text element: its CSS keeps character-reference lookalikes
      // (`?a=1&notch=2`) as written (#453)
      children = node.children.map((n) =>
        n.type === 'text' ? n.value : renderSingleNode(n),
      );
    } else if (rawContent || isRawRoot) {
      children = renderInlineNodes(node.children);
    } else {
      // The summary of a details element and the legend of a fieldset stay
      // its direct children: rendered apart from the markdown of the rest of
      // the content.
      const leadAt = leadingPartIndex(tag, node.children);
      const body = (nodes: ASTNode[]) =>
        renderNodes(nodes, { nobr, locals, inline: isInline });
      structural =
        STRUCTURAL_ELEMENTS.has(tag) &&
        node.children.every((n) => n.type !== 'text' || isBlankText(n));
      children = structural ? (
        node.children
          .filter((n) => n.type !== 'text')
          .map((n) => renderSingleNode(n))
      ) : leadAt === -1 ? (
        body(node.children)
      ) : (
        <>
          {body(node.children.slice(0, leadAt))}
          {renderSingleNode(node.children[leadAt]!)}
          {body(node.children.slice(leadAt + 1))}
        </>
      );
      if (isInline !== parentInline) {
        children = (
          <InlineContext.Provider value={isInline}>
            {children}
          </InlineContext.Provider>
        );
      }
      if (structural !== parentStructural) {
        children = (
          <StructuralContext.Provider value={structural}>
            {children}
          </StructuralContext.Provider>
        );
      }
    }
  }
  // The content of a foreignObject is HTML again: HTML attributes, and
  // markdown, for the content of macros and widgets in it too (#477)
  if (isHtmlRoot && children) {
    children = (
      <SvgContext.Provider value={false}>
        <RawTextContext.Provider value={false}>
          {children}
        </RawTextContext.Provider>
      </SvgContext.Provider>
    );
  }
  let element = h(node.tag, props, children);
  if (isSvgRoot && !inSvg) {
    element = <SvgContext.Provider value={true}>{element}</SvgContext.Provider>;
  }
  return withAttributeErrors(
    errors,
    isRawRoot ? (
      <RawTextContext.Provider value={true}>{element}</RawTextContext.Provider>
    ) : (
      element
    ),
  );
}

function ChildrenSlot() {
  const children = useContext(WidgetChildrenContext);
  const renderOptions = useRenderOptions();
  if (!children) return null;
  // The children render with the widget's locals, but a {@children} among
  // them forwards the enclosing widget's children (#386).
  return (
    <WidgetChildrenContext.Provider value={children.outer}>
      {renderNodes(children.nodes, renderOptions)}
    </WidgetChildrenContext.Provider>
  );
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

  // What an invocation passes on to a widget and to a built-in macro alike
  const invocation = {
    rawArgs: node.rawArgs,
    className: node.className,
    id: node.id,
  };

  const widget = getWidget(node.name);
  if (widget) {
    return (
      <WidgetInvocation
        key={key}
        {...invocation}
        body={widget.body}
        params={widget.params}
        invocationChildren={node.children}
      />
    );
  }

  const Component = getMacro(node.name);
  if (Component) {
    return (
      <Component
        key={key}
        {...invocation}
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
  // Authored text outside markdown still has its character references decoded
  if (node.type === 'text') return node.comment ? null : decodeText(node.value);
  const key = nodeKey(node);
  switch (node.type) {
    case 'variable':
      if (node.scope === 'local' && node.name === 'children') {
        return <ChildrenSlot key={key} />;
      }
      return (
        <VarDisplay
          key={key}
          node={node}
        />
      );

    case 'expression':
      return (
        <ExprDisplay
          key={key}
          node={node}
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
 * breaks, which micromark decodes / turns into <br> (#171), and the openers
 * of raw HTML comments, processing instructions, CDATA sections and
 * declarations (`<!`, `<?`), which micromark passes through as HTML. A CR
 * line ending (`\r\n` or `\r`) also takes the full pipeline, which reads
 * it as micromark does.
 */
const MARKDOWN_SYNTAX_RE =
  /[*_`#|~\[>\\\-+=\r]|!\[|\d+[.)]|&#?[a-zA-Z0-9]+;| {2}\n|<[!?]/;
/** Two line endings (LF, CRLF or CR) with only whitespace between them. */
const BLANK_LINE_RE = /(?:\r\n|\r(?!\n)|\n)\s*[\r\n]/;
const PLACEHOLDER_STRIP_RE = /<span data-tw=[0-9a-z]+:\d+><\/span>/g;

/** Whitespace that markdown strips at the start and end of a paragraph. */
const EDGE_WS = ' \t\r\n';

/**
 * Index of the first character from `from` on (`step` 1) or before `from`
 * (`step` -1) that is not in `chars`, or where the run of them ends. A loop,
 * not a regex: `/[ \t]*$/` and the like try each position of a whitespace
 * run, taking quadratic time on a long run in the middle of a passage.
 */
function skipChars(s: string, from: number, step: 1 | -1, chars: string) {
  let i = from;
  if (step === 1) {
    while (i < s.length && chars.includes(s[i]!)) i++;
  } else {
    while (i > 0 && chars.includes(s[i - 1]!)) i--;
  }
  return i;
}

/**
 * Drop the spaces and tabs around line endings, as markdown does within a
 * paragraph.
 */
function trimLineEdges(text: string): string {
  if (!text.includes('\n')) return text;
  return text
    .split('\n')
    .map((line, k, lines) => {
      const start = k === 0 ? 0 : skipChars(line, 0, 1, ' \t');
      const end =
        k === lines.length - 1
          ? line.length
          : skipChars(line, line.length, -1, ' \t');
      return line.slice(start, Math.max(start, end));
    })
    .join('\n');
}

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
  const children = expandPlaceholderText(trimLineEdges(core), ph).filter(
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
    /** Literal content (see RawTextContext): no markdown processing. */
    raw?: boolean;
    /** Content of a structural element (see StructuralContext). */
    structural?: boolean;
  },
): preact.ComponentChildren {
  if (nodes.length === 0) return null;
  if (options?.raw) return renderInlineNodes(nodes);
  // Only elements and macros between the children of a table, a list...:
  // paragraphs would pull the elements they produce out of it (#436)
  if (
    options?.structural &&
    nodes.every((n) => n.type !== 'text' || isBlankText(n))
  ) {
    return nodes.filter((n) => n.type !== 'text').map(renderSingleNode);
  }

  // Skip the markdown pipeline when text nodes contain only whitespace.
  // This eliminates ~97 redundant micromark + innerHTML calls per render
  // in {for} loops over HTML + macro content (issue #143).
  // However, don't skip if any text node contains blank lines (\n\n), as those
  // have markdown semantics (paragraph separation).
  const needsMarkdown = nodes.some(
    (n) =>
      n.type === 'text' &&
      (n.value.trim() !== '' || BLANK_LINE_RE.test(n.value)),
  );
  if (!needsMarkdown) {
    return nodes.map((node) => renderSingleNode(node));
  }

  // Build combined markdown string with placeholders for non-text nodes
  const components: preact.ComponentChildren[] = [];
  const ph: Placeholders = {
    nonce: Math.random().toString(36).slice(2, 10) || '0',
    components,
    nodes: [],
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
    ph.nodes.push(node);
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
  const lead = combined.slice(0, skipChars(combined, 0, 1, EDGE_WS));
  const trail =
    lead.length === combined.length
      ? ''
      : combined.slice(skipChars(combined, combined.length, -1, EDGE_WS));
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
