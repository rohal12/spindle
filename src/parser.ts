import { tokenize } from './markup/tokenizer';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';

export interface Passage {
  pid: number;
  name: string;
  tags: string[];
  metadata: Record<string, string>;
  content: string;
}

export interface StoryData {
  name: string;
  startNode: number;
  ifid: string;
  format: string;
  formatVersion: string;
  passages: Map<string, Passage>;
  passagesById: Map<number, Passage>;
  userCSS: string;
  userScript: string;
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** HTML elements written without content or end tag, as innerHTML does. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * The passage markup in the nodes of passage data.
 *
 * A compiler that HTML-escapes passage text (Twine, Tweego) leaves a text
 * node whose text is the markup; a no-break space in it is U+00A0, which
 * innerHTML writes as `&nbsp;`. One that doesn't escape it leaves the
 * browser's parse of it, whose elements are written back as markup here.
 * innerHTML did that too, but its escaping can't be undone: a `"` in an
 * attribute value is written `&quot;`, and decoding that ends the value
 * early, while text it leaves unescaped (in `<style>`, comments) would be
 * decoded wrongly.
 */
function passageMarkup(parent: ParentNode): string {
  let markup = '';
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      markup += (node as Text).data;
    } else if (node.nodeType === Node.COMMENT_NODE) {
      markup += `<!--${(node as Comment).data}-->`;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      markup += elementMarkup(node as Element);
    }
  }
  return markup;
}

/** An element of passage data as markup (see passageMarkup). */
function elementMarkup(el: Element): string {
  const name = el.localName;
  let markup = `<${name}`;
  for (const attr of Array.from(el.attributes)) {
    markup += ` ${attr.name}=${quoteAttribute(attr.name, attr.value)}`;
  }
  markup += '>';
  if (el.namespaceURI === HTML_NAMESPACE && VOID_ELEMENTS.has(name)) {
    return markup;
  }
  const content =
    name === 'template' ? (el as HTMLTemplateElement).content : el;
  return `${markup}${passageMarkup(content)}</${name}>`;
}

/**
 * An attribute value quoted so that the passage tokenizer reads it back:
 * in double quotes, else single ones, else with the double quotes in its
 * text written as `&quot;`, which rendering decodes. Quotes inside markup in
 * the value (`{print "a"}`) are code, and don't end it.
 */
function quoteAttribute(name: string, value: string): string {
  const code = isCodeAttribute(name);
  const probe = code ? 'on' : 'a';
  const readsBack = (quoted: string) => {
    const tokens = tokenize(`<i ${probe}=${quoted}>`);
    const tag = tokens[0];
    return (
      tokens.length === 1 &&
      tag?.type === 'html' &&
      tag.attributes[probe] === quoted.slice(1, -1)
    );
  };
  return (
    [`"${value}"`, `'${value}'`].find(readsBack) ??
    `"${escapeTextQuotes(value, code)}"`
  );
}

/**
 * `value` with the double quotes in its text written as `&quot;`, but not
 * those in markup (`{print "a"}`) or, in a code attribute, in sigil
 * references (see splitSigilTemplate), which are code.
 */
function escapeTextQuotes(value: string, code: boolean): string {
  const escape = (text: string) => text.replace(/"/g, '&quot;');
  if (code) {
    return splitSigilTemplate(value)
      .map((part) =>
        'text' in part
          ? escape(part.text)
          : 'expr' in part
            ? `{${part.expr}}`
            : part.verbatim,
      )
      .join('');
  }
  return tokenize(value, { text: true })
    .map((token) => {
      const source = value.slice(token.start, token.end);
      return token.type === 'text' ? escape(source) : source;
    })
    .join('');
}

/**
 * Parse <tw-storydata> and all <tw-passagedata> elements from the DOM.
 *
 * Passage content is read with passageMarkup instead of textContent, so
 * that HTML tags inside passage markup (e.g. <div> inside {button}) are
 * preserved whether or not the compiler HTML-encoded them.
 */
export function parseStoryData(): StoryData {
  const storyEl = document.querySelector('tw-storydata');
  if (!storyEl) {
    throw new Error(
      'spindle: No <tw-storydata> element found in the document.',
    );
  }

  const name = storyEl.getAttribute('name') || 'Untitled';
  const startNode = parseInt(storyEl.getAttribute('startnode') || '1', 10);
  const ifid = storyEl.getAttribute('ifid') || '';
  const format = storyEl.getAttribute('format') || '';
  const formatVersion = storyEl.getAttribute('format-version') || '';

  const cssEl = storyEl.querySelector('[type="text/twine-css"]');
  const userCSS = cssEl?.textContent || '';

  const jsEl = storyEl.querySelector('[type="text/twine-javascript"]');
  const userScript = jsEl?.textContent || '';

  const passages = new Map<string, Passage>();
  const passagesById = new Map<number, Passage>();

  for (const el of storyEl.querySelectorAll('tw-passagedata')) {
    const pid = parseInt(el.getAttribute('pid') || '0', 10);
    const passageName = el.getAttribute('name') || '';
    const tags = (el.getAttribute('tags') || '')
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const content = passageMarkup(el);

    const metadata: Record<string, string> = {};
    const skipAttrs = new Set(['pid', 'name', 'tags']);
    for (const attr of el.attributes) {
      if (!skipAttrs.has(attr.name)) {
        metadata[attr.name] = attr.value;
      }
    }

    const passage: Passage = {
      pid,
      name: passageName,
      tags,
      metadata,
      content,
    };
    passages.set(passageName, passage);
    passagesById.set(pid, passage);
  }

  return {
    name,
    startNode,
    ifid,
    format,
    formatVersion,
    passages,
    passagesById,
    userCSS,
    userScript,
  };
}
