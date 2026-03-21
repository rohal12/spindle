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
 * Decode the HTML entities that browsers use when serializing innerHTML.
 * &amp; is decoded last to avoid double-decoding (e.g. &amp;lt; → &lt;, not <).
 */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
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
