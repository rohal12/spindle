/**
 * E2E tests for how author HTML is parsed, in a real browser: happy-dom
 * neither loads images nor runs inline handlers, and constructs custom
 * elements in every document, so it can't show whether parsing is inert.
 *
 * Each test boots a story built from dist/format.js (the global setup builds
 * it) with its own <tw-storydata>.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dirname!, '../..');
const STORY_URL = 'http://spindle.test/story.html';

let browser: Browser;
let page: Page;
let template: string;

/** Escape passage text as Twine and Tweego write it into story data. */
function encode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface StoryOptions {
  /** Passage name → its <tw-passagedata> content, as written into the HTML. */
  passages: Record<string, string>;
  script?: string;
}

/**
 * Boot a story in a new page, its start passage the first one, and wait for
 * the passage.
 */
async function boot({ passages, script = '' }: StoryOptions) {
  await page?.close();
  page = await browser.newPage();
  const all = { ...passages, StoryVariables: '' };
  const data =
    '<tw-storydata name="Probe" startnode="1" ifid="00000000-0000-4000-8000-000000000000" format="spindle" format-version="0">' +
    `<script role="script" id="twine-user-script" type="text/twine-javascript">${script}</script>` +
    Object.entries(all)
      .map(
        ([name, content], i) =>
          `<tw-passagedata pid="${i + 1}" name="${name}" tags="">${content}</tw-passagedata>`,
      )
      .join('') +
    '</tw-storydata>';
  const html = template
    .replace('{{STORY_NAME}}', () => 'Probe')
    .replace('{{STORY_DATA}}', () => data);
  await page.route(STORY_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(STORY_URL);
  await page.waitForSelector('[data-passage]');
}

beforeAll(async () => {
  const formatJs = readFileSync(resolve(projectRoot, 'dist/format.js'), 'utf8');
  const json = formatJs.slice(
    formatJs.indexOf('(') + 1,
    formatJs.lastIndexOf(')'),
  );
  template = (JSON.parse(json) as { source: string }).source;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

describe('HTML in markdown output is parsed inertly', () => {
  /**
   * Passage markup parses every tag itself, so raw HTML reaches micromark's
   * output from text nodes a custom macro renders: `{raw …}` renders its
   * arguments as such a text node.
   */
  const RAW_MACRO = `
    Story.defineMacro({ name: 'raw', render: (props, ctx) =>
      ctx.renderNodes([{ type: 'text', value: props.rawArgs }]) });`;

  it('constructs a custom element only when it is rendered', async () => {
    await boot({
      passages: { Start: encode('{raw **Probe** <x-probe a.b>}') },
      script: `${RAW_MACRO}
        window.constructed = 0;
        customElements.define('x-probe', class extends HTMLElement {
          constructor() { super(); window.constructed++; }
        });`,
    });
    await page.waitForSelector('x-probe', { state: 'attached' });
    const { constructed, rendered } = await page.evaluate(() => ({
      constructed: (window as unknown as { constructed: number }).constructed,
      rendered: document.querySelectorAll('x-probe').length,
    }));
    expect(rendered).toBe(1);
    expect(constructed).toBe(rendered);
  });

  it('runs an inline handler only on the rendered element', async () => {
    await boot({
      passages: {
        Start: encode(
          '{raw **Probe** <img src="data:," a.b onerror="seen(this)">}',
        ),
      },
      script: `${RAW_MACRO}
        window.runs = { live: 0, detached: 0 };
        window.seen = (el) => el.isConnected ? runs.live++ : runs.detached++;`,
    });
    await page.waitForFunction(
      () => (window as unknown as { runs: { live: number } }).runs.live > 0,
    );
    const runs = await page.evaluate(
      () => (window as unknown as { runs: unknown }).runs,
    );
    expect(runs).toEqual({ live: 1, detached: 0 });
  });
});

describe('passage data', () => {
  /**
   * The value of `attribute` on the element with `id` in the passage shown.
   * Not encoded, the passage data holds such an element too.
   */
  const attributeOf = (id: string, attribute: string) =>
    page.getAttribute(`[data-passage] #${id}`, attribute, { timeout: 2000 });

  it('reads a no-break space as U+00A0', async () => {
    await boot({
      passages: {
        Start: encode(
          '{set _s = "a b"}<span id="n">{print _s === "a\\u00A0b"}</span>',
        ),
      },
    });
    expect(await page.textContent('[data-passage] #n')).toBe('true');
  });

  it('keeps quotes in attribute values of HTML that is not encoded', async () => {
    await boot({
      passages: {
        // As a compiler that doesn't HTML-escape passage text writes it
        Start:
          `<i id="a" title='say "hi"'>a</i>` +
          `<i id="b" title="it's &quot;x&quot;">b</i>` +
          `<i id="c" title="{print 'p' + &quot;q&quot;} it's">c</i>`,
      },
    });
    expect(await attributeOf('a', 'title')).toBe('say "hi"');
    expect(await attributeOf('b', 'title')).toBe(`it's "x"`);
    expect(await attributeOf('c', 'title')).toBe(`pq it's`);
  });
});
