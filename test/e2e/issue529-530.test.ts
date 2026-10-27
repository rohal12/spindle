/**
 * E2E tests of #529 and #530 in a real browser (focus returns to the opener
 * when a dialog closes):
 * - #529: closing stacked dialogs together restores the original opener;
 * - #530: an opener inside a same-origin iframe gets focus back, also in a
 *   nested frame.
 *
 * Compiles its own stories with the built format (global setup builds it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'http';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { sendFile } from './serve';
import { compileToFile } from '@rohal12/twee-ts';

const projectRoot = resolve(import.meta.dirname!, '../..');

const story = (n: number, passages: string) => `:: StoryTitle
Regression

:: StoryData
{"ifid":"${n}00000-0000-4000-8000-000000000${n}","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables

${passages}
`;

const stories: Record<string, string> = {
  stackedApi: story(
    529,
    `:: Start
{#open button "Open"}{do}Story.openDialog("Outer");{/do}{/button}

:: Outer
{#more button "More"}{do}Story.openDialog("Inner");{/do}{/button}

:: Inner
{#done button "Done"}{do}Story.closeAllDialogs();{/do}{/button}
{#twice button "Twice"}{do}Story.closeDialog();Story.closeDialog();{/do}{/button}`,
  ),
  stackedMacro: story(
    529,
    `:: Start
{dialog "Open"}Outer{/dialog}

:: Outer
{dialog "More"}Inner{/dialog}

:: Inner
<button id="done" onclick="Story.closeAllDialogs()">Done</button>`,
  ),
  frameOpener: story(
    530,
    `:: Start
<iframe id="frame" srcdoc="&lt;button id='open' onclick='parent.Story.openDialog(&quot;Outer&quot;)'&gt;Open&lt;/button&gt;"></iframe>

:: Outer
{#done button "Done"}{do}Story.closeDialog();{/do}{/button}`,
  ),
  nestedFrameOpener: story(
    530,
    `:: Start
<iframe id="outer" srcdoc="&lt;iframe id='inner' srcdoc='&lt;button id=&amp;quot;open&amp;quot; onclick=&amp;quot;top.Story.openDialog(&amp;apos;Popup&amp;apos;)&amp;quot;&gt;Open&lt;/button&gt;'&gt;&lt;/iframe&gt;"></iframe>

:: Popup
{#done button "Done"}{do}Story.closeDialog();{/do}{/button}`,
  ),
  frameGone: story(
    530,
    `:: Start
<iframe id="frame" srcdoc="&lt;button id='open' onclick='parent.Story.openDialog(&quot;Outer&quot;)'&gt;Open&lt;/button&gt;"></iframe>
<button id="after">After</button>

:: Outer
{#done button "Done"}{do}document.getElementById("frame").contentDocument.getElementById("open").remove();Story.closeDialog();{/do}{/button}`,
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
    sendFile(res, dir, `${url.searchParams.get('s')}.html`);
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

const open = async (name: string) => {
  await page.goto(`${baseUrl}/?s=${name}`);
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto(`${baseUrl}/?s=${name}`);
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

/** Wait until no dialog is open. */
const closed = () =>
  page.waitForSelector('.dialog-panel', { state: 'detached' });

describe('focus after closing stacked dialogs (#529)', () => {
  it('returns to the original opener after Story.closeAllDialogs', async () => {
    await open('stackedApi');
    await page.locator('#open').focus();
    await page.keyboard.press('Enter');
    await page.locator('#more').waitFor();
    await page.keyboard.press('Enter');
    await page.locator('#done').waitFor();
    await page.keyboard.press('Enter');
    await closed();
    expect(await active()).toBe('open');
  });

  it('returns to the original opener after two synchronous closeDialog calls', async () => {
    await open('stackedApi');
    await page.locator('#open').focus();
    await page.keyboard.press('Enter');
    await page.locator('#more').focus();
    await page.keyboard.press('Enter');
    await page.locator('#twice').focus();
    await page.keyboard.press('Enter');
    await closed();
    expect(await active()).toBe('open');
  });

  it('returns to the original opener of nested {dialog} macros', async () => {
    await open('stackedMacro');
    const opener = page.locator('.passage button', { hasText: 'Open' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.locator('.dialog-panel button', { hasText: 'More' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('#done').focus();
    await page.keyboard.press('Enter');
    await closed();
    expect(
      await page.evaluate(() => document.activeElement?.textContent === 'Open'),
    ).toBe(true);
  });
});

describe('focus after closing a dialog opened from a frame (#530)', () => {
  it('returns to the control inside the frame', async () => {
    await open('frameOpener');
    await page.frameLocator('#frame').locator('#open').focus();
    await page.keyboard.press('Enter');
    await page.locator('#done').waitFor();
    await page.keyboard.press('Enter');
    await closed();
    expect(await active()).toBe('frame:open');
  });

  it('returns to the control inside a nested frame', async () => {
    await open('nestedFrameOpener');
    await page.waitForFunction(() => {
      const outer = document.querySelector<HTMLIFrameElement>('#outer');
      const inner =
        outer?.contentDocument?.querySelector<HTMLIFrameElement>('#inner');
      return !!inner?.contentDocument?.getElementById('open');
    });
    await page
      .frameLocator('#outer')
      .frameLocator('#inner')
      .locator('#open')
      .focus();
    await page.keyboard.press('Enter');
    await page.locator('#done').waitFor();
    await page.keyboard.press('Enter');
    await closed();
    expect(await active()).toBe('outer:inner:open');
  });

  it('falls back to the frame when the control is gone', async () => {
    await open('frameGone');
    await page.frameLocator('#frame').locator('#open').focus();
    await page.keyboard.press('Enter');
    await page.locator('#done').waitFor();
    await page.keyboard.press('Enter');
    await closed();
    expect(await active()).toBe('frame');
  });
});
