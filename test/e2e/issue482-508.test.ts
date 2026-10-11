/**
 * E2E tests of #482, #483 and #506-#508 in a real browser, with the issues'
 * own stories (Tab order and focus in dialogs):
 * - #482: Tab follows the positive tabindexes of an iframe in a dialog;
 * - #483: focus returns to a focusable SVG opener when the dialog closes;
 * - #506: Tab steps through the segments of a date input in an iframe;
 * - #507: an explicit tabindex on a contenteditable="false" element is a stop;
 * - #508: Escape closes the dialog from a nested frame.
 *
 * Compiles its own stories with the built format (global setup builds it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'http';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { compileToFile } from '@rohal12/twee-ts';

const projectRoot = resolve(import.meta.dirname!, '../..');

const header = (ifid: string) => `:: StoryTitle
Regression

:: StoryData
{"ifid":"${ifid}","format":"spindle","format-version":"0.1.0","start":"Start"}

`;

const dialogStory = (n: number, popup: string) =>
  `${header(`${n}00000-0000-4000-8000-000000000${n}`)}:: StoryVariables

:: Start
{dialog "Open"}Popup{/dialog}

:: Popup
${popup}
`;

const stories: Record<string, string> = {
  frameTabindex: dialogStory(
    482,
    `<button id="before">Before</button>
<iframe id="frame" srcdoc="<button id='later' tabindex='2'>Later</button><button id='first' tabindex='1'>First</button><button id='last'>Last</button>"></iframe>
<button id="after">After</button>`,
  ),
  svgOpener: `${header('48300000-0000-4000-8000-000000000483')}:: StoryVariables

:: Start
<svg width="200" height="80">
  <a id="open" href="#" onclick="Story.openDialog('Popup')">
    <text x="10" y="40">Open</text>
  </a>
</svg>

:: Popup
<input id="name">
`,
  frameDate: dialogStory(
    506,
    `<iframe id="frame" srcdoc="<input id='birth' type='date'>"></iframe>
<button id="after">After</button>`,
  ),
  frameDateLast: dialogStory(
    506,
    `<iframe id="frame" srcdoc="<input id='birth' type='date'>"></iframe>`,
  ),
  readonlyStop: dialogStory(
    507,
    `<button id="before">Before</button>
<div id="readonly" contenteditable="false" tabindex="0">Readonly text</div>
<button id="after">After</button>`,
  ),
  nestedTab: dialogStory(
    508,
    `<button id="before">Before</button>
<iframe id="outer" srcdoc="<iframe id='inner' srcdoc='<button id=&quot;deep1&quot; tabindex=&quot;2&quot;>One</button><button id=&quot;deep2&quot; tabindex=&quot;1&quot;>Two</button>'></iframe><button id='tail'>Tail</button>"></iframe>
<button id="after">After</button>`,
  ),
  nestedFrame: dialogStory(
    508,
    `<iframe id="outer" srcdoc="<iframe id='inner' srcdoc='<button id=&quot;deep&quot;>Deep</button>'></iframe>"></iframe>
<button id="after">After</button>`,
  ),
};

let dir: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-e2e-'));
  for (const [name, twee] of Object.entries(stories)) {
    const src = resolve(dir, `${name}.twee`);
    writeFileSync(src, twee);
    await compileToFile({
      sources: [src],
      outFile: resolve(dir, `${name}.html`),
      formatPaths: [resolve(projectRoot, 'dist/storyformats')],
    });
  }
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(resolve(dir, `${url.searchParams.get('s')}.html`)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
  page = await (await browser.newContext()).newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

const open = async (story: string) => {
  await page.goto(`${baseUrl}/?s=${story}`);
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto(`${baseUrl}/?s=${story}`);
  await page.waitForSelector('.passage');
};

/** The id of the focused element, prefixed by those of the frames holding it. */
const active = () =>
  page.evaluate(() => {
    let doc = document;
    const path: string[] = [];
    for (;;) {
      const el = doc.activeElement;
      const next =
        el?.localName === 'iframe'
          ? (el as HTMLIFrameElement).contentDocument
          : null;
      if (!el || !next?.activeElement || next.activeElement === next.body) {
        return [...path, el?.id].join(':');
      }
      path.push(el.id);
      doc = next;
    }
  });

/** Press each key in turn; the focused element after each. */
const tab = async (...keys: string[]) => {
  const seen: (string | undefined)[] = [];
  for (const key of keys) {
    await page.keyboard.press(key);
    seen.push(await active());
  }
  return seen;
};

/** The button `id` in the frame #inner of the frame #outer, once loaded. */
const deepButton = (id: string) => {
  const outer = document.querySelector<HTMLIFrameElement>('#outer');
  const inner =
    outer?.contentDocument?.querySelector<HTMLIFrameElement>('#inner');
  return inner?.contentDocument?.getElementById(id) ?? null;
};

describe('Tab in a dialog', () => {
  it('follows the positive tabindexes of an iframe (#482)', async () => {
    await open('frameTabindex');
    await page.click('button:has-text("Open")');
    await page.waitForFunction(
      () =>
        !!document
          .querySelector<HTMLIFrameElement>('#frame')
          ?.contentDocument?.getElementById('last'),
    );
    expect(await active()).toBe('before');
    expect(await tab('Tab', 'Tab', 'Tab', 'Tab')).toEqual([
      'frame:first',
      'frame:later',
      'frame:last',
      'after',
    ]);
    expect(
      await tab('Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab'),
    ).toEqual(['frame:last', 'frame:later', 'frame:first', 'before']);
  });

  it('crosses nested frames in tab order (#508)', async () => {
    await open('nestedTab');
    await page.click('button:has-text("Open")');
    await page.waitForFunction(deepButton, 'deep1');
    await page.locator('#before').focus();
    expect(await tab('Tab', 'Tab', 'Tab', 'Tab')).toEqual([
      'outer:inner:deep2',
      'outer:inner:deep1',
      'outer:tail',
      'after',
    ]);
    expect(
      await tab('Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab'),
    ).toEqual([
      'outer:tail',
      'outer:inner:deep1',
      'outer:inner:deep2',
      'before',
    ]);
  });

  it('steps through the segments of a date input in an iframe (#506)', async () => {
    await open('frameDate');
    await page.click('button:has-text("Open")');
    await page.waitForFunction(
      () =>
        !!document
          .querySelector<HTMLIFrameElement>('#frame')
          ?.contentDocument?.getElementById('birth'),
    );
    const birth = page.frameLocator('#frame').locator('#birth');
    await birth.fill('2000-12-25');
    await birth.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowUp');
    expect(await active()).toBe('frame:birth');
    expect(await birth.inputValue()).not.toBe('2000-12-25');
    // Through the last segment, then on to the next control
    for (let i = 0; i < 6 && (await active()) !== 'after'; i++) {
      await page.keyboard.press('Tab');
    }
    expect(await active()).toBe('after');
    await page.keyboard.press('Shift+Tab');
    expect(await active()).toBe('frame:birth');
  });

  it('wraps on from a date input that ends the dialog (#506)', async () => {
    await open('frameDateLast');
    await page.click('button:has-text("Open")');
    await page.waitForFunction(
      () =>
        !!document
          .querySelector<HTMLIFrameElement>('#frame')
          ?.contentDocument?.getElementById('birth'),
    );
    await page.frameLocator('#frame').locator('#birth').focus();
    for (let i = 0; i < 6 && (await active()).startsWith('frame'); i++) {
      await page.keyboard.press('Tab');
    }
    expect(
      await page.evaluate(() => document.activeElement?.className),
    ).toContain('dialog-close');
  });

  it('stops at a contenteditable="false" element with a tabindex (#507)', async () => {
    await open('readonlyStop');
    await page.click('button:has-text("Open")');
    await page.locator('#before').focus();
    expect(await tab('Tab', 'Tab', 'Shift+Tab')).toEqual([
      'readonly',
      'after',
      'readonly',
    ]);
  });
});

describe('dialog focus and keys', () => {
  it('returns focus to a focusable SVG opener (#483)', async () => {
    await open('svgOpener');
    await page.locator('#open').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#name');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#name', { state: 'detached' });
    expect(await page.evaluate('document.activeElement.id')).toBe('open');
  });

  it('closes on Escape pressed in a nested frame (#508)', async () => {
    await open('nestedFrame');
    await page.click('button:has-text("Open")');
    await page.waitForFunction(deepButton, 'deep');
    await page.evaluate(() => {
      const outer = document.querySelector<HTMLIFrameElement>('#outer')!;
      const inner =
        outer.contentDocument!.querySelector<HTMLIFrameElement>('#inner')!;
      inner.contentDocument!.getElementById('deep')!.focus();
    });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.dialog-panel', { state: 'detached' });
  });
});
