/**
 * E2E tests of the `dialogclose` story event in a real browser: it fires
 * once per closed dialog, after the dialog has left the DOM and focus is
 * back on its opener, whichever way the dialog closed.
 *
 * Compiles its own story with the built format (global setup builds it).
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

const story = `:: StoryTitle
Dialog close

:: StoryData
{"ifid":"74100000-0000-4000-8000-000000000741","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables

:: Script [script]
window.seen = [];
Story.on('storyinit', function () {
  window.seen.push('storyinit');
});
Story.on('dialogclose', function (passage) {
  window.seen.push([
    passage,
    document.querySelectorAll('.dialog-panel').length,
    Story.isDialogOpen(),
    document.activeElement && document.activeElement.id,
  ]);
  if (window.focusElsewhere) document.getElementById('elsewhere').focus();
});

:: Start
{#open button "Open"}{do}Story.openDialog("Outer");{/do}{/button}
<button id="elsewhere">Elsewhere</button>

:: Outer
{#more button "More"}{do}Story.openDialog("Inner");{/do}{/button}
{#close button "Close"}{do}Story.closeDialog();{/do}{/button}

:: Inner
{#all button "All"}{do}Story.closeAllDialogs();{/do}{/button}
`;

type Seen = Array<string | [string, number, boolean, string | null]>;

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'spindle-e2e-'));
  const src = resolve(dir, 'story.twee');
  writeFileSync(src, story);
  await compileToFile({
    sources: [src],
    outFile: resolve(dir, 'story.html'),
    formatPaths: [resolve(projectRoot, 'dist/storyformats')],
  });
  server = createServer((_req, res) => sendFile(res, dir, 'story.html'));
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

/** Load the story afresh and open the Outer dialog from its button. */
const openOuter = async () => {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto(baseUrl);
  await page.waitForSelector('.passage');
  await page.evaluate(() => {
    (window as unknown as { seen: Seen }).seen = [];
  });
  await page.locator('#open').focus();
  await page.keyboard.press('Enter');
  await page.locator('#more').waitFor();
};

/** What the story's handlers saw, once no dialog is open. */
const seen = async (): Promise<Seen> => {
  await page.waitForSelector('.dialog-panel', { state: 'detached' });
  return page.evaluate(() => (window as unknown as { seen: Seen }).seen);
};

describe('dialogclose event', () => {
  it.each<[string, () => Promise<unknown>]>([
    ['the ✕ button', () => page.locator('.dialog-close').click()],
    ['Escape', () => page.keyboard.press('Escape')],
    [
      'a backdrop click',
      () => page.locator('.dialog-overlay').click({ position: { x: 5, y: 5 } }),
    ],
    ['Story.closeDialog()', () => page.locator('#close').click()],
  ])(
    'fires once after %s, the dialog gone and focus back on the opener',
    async (_way, close) => {
      await openOuter();
      await close();
      expect(await seen()).toEqual([['Outer', 0, false, 'open']]);
    },
  );

  it('fires innermost first for stacked dialogs closed together', async () => {
    await openOuter();
    await page.locator('#more').click();
    await page.locator('#all').click();
    expect(await seen()).toEqual([
      ['Inner', 0, false, 'open'],
      ['Outer', 0, false, 'open'],
    ]);
  });

  it('fires for the inner dialog alone while the outer one stays open', async () => {
    await openOuter();
    await page.locator('#more').click();
    await page.locator('#all').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#all').waitFor({ state: 'detached' });
    expect(
      await page.evaluate(() => (window as unknown as { seen: Seen }).seen),
    ).toEqual([['Inner', 1, true, 'more']]);
  });

  it('keeps the focus a handler sets', async () => {
    await openOuter();
    await page.evaluate(() => {
      (window as unknown as { focusElsewhere: boolean }).focusElsewhere = true;
    });
    await page.keyboard.press('Escape');
    expect(await seen()).toEqual([['Outer', 0, false, 'open']]);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      'elsewhere',
    );
  });

  it('fires after storyinit for a dialog a restart closes', async () => {
    await openOuter();
    await page.evaluate(() => window.Story.restart());
    const events = await seen();
    expect(events).toHaveLength(2);
    expect(events[0]).toBe('storyinit');
    expect(events[1]).toEqual(['Outer', 0, false, expect.anything()]);
  });
});
