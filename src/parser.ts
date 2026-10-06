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

/**
 * The character references the HTML serializer writes (innerHTML): `&amp;`,
 * `&nbsp;` (U+00A0), `&lt;` and `&gt;` in text, and `&quot;` in attribute
 * values. `&#39;` is kept for compilers that write it.
 */
const SERIALIZED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

/**
 * Undo innerHTML's escaping. One pass, so `&amp;lt;` becomes `&lt;`, not
 * `<`.
 */
function decodeHtmlEntities(html: string): string {
  return html.replace(
    /&(amp|nbsp|lt|gt|quot|#39);/g,
    (_, name: string) => SERIALIZED_ENTITIES[name]!,
  );
}

/**
 * Parse <tw-storydata> and all <tw-passagedata> elements from the DOM.
 *
 * Uses innerHTML + entity decoding instead of textContent so that HTML
 * tags inside passage markup (e.g. <div> inside {button}) are preserved
 * regardless of whether the compiler HTML-encoded them.
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
    const content = decodeHtmlEntities(el.innerHTML);

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
