/**
 * E2E test of Story.recordMoment() in a real browser: a change made in a
 * dialog over a passage, without a navigation, survives a page reload once
 * it is recorded (and is lost when it is not).
 *
 * Compiles its own story with the built format (global setup builds it).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';
import { sendFile } from './serve';

const projectRoot = resolve(import.meta.dirname!, '../..');

const STORY = `:: StoryTitle
Record moment

:: StoryData
{"ifid":"7ec02d00-0000-4000-8000-000000000001","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$worn = "none"

:: Start
Worn: {$worn}
{#wardrobe button "Wardrobe"}{do}Story.openDialog("Wardrobe");{/do}{/button}
[[Next]]

:: Next
Worn here: {$worn}
{#wardrobe button "Wardrobe"}{do}Story.openDialog("Wardrobe");{/do}{/button}

:: Wardrobe
{#hat button "Hat"}{do}$worn = "hat"; Story.recordMoment(); Story.closeDialog();{/do}{/button}
{#scarf button "Scarf"}{do}$worn = "scarf"; Story.closeDialog();{/do}{/button}
`;

let dir: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-record-moment-'));
  const source = resolve(dir, 'story.twee');
  writeFileSync(source, STORY);
  await compileToFile({
    sources: [source],
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
  await new Promise<void>((r) => server?.close(() => r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.goto(baseUrl);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector('.passage');
});

const passageText = () => page.locator('.passage').innerText();

/** Open the dialog and click one of its buttons, which closes it. */
const wear = async (id: string) => {
  await page.click('#wardrobe');
  await page.click(`#${id}`);
  await page.waitForSelector('.dialog-panel', { state: 'detached' });
};

const reload = async () => {
  await page.reload();
  await page.waitForSelector('.passage');
};

describe('Story.recordMoment() across a page reload', () => {
  it('a recorded change made in a dialog survives a reload', async () => {
    await page.click('text=Next');
    await page.waitForFunction(() =>
      document.querySelector('.passage')?.textContent?.includes('Worn here'),
    );
    await wear('hat');
    expect(await passageText()).toContain('Worn here: hat');

    await reload();
    expect(await passageText()).toContain('Worn here: hat');

    // The moment before keeps its own state, and forward returns to this one
    await page.evaluate(() => (window as any).Story.back());
    await page.waitForFunction(() =>
      document.querySelector('.passage')?.textContent?.includes('Worn: none'),
    );
    await page.evaluate(() => (window as any).Story.forward());
    await page.waitForFunction(() =>
      document
        .querySelector('.passage')
        ?.textContent?.includes('Worn here: hat'),
    );
  });

  it('a change that is not recorded is lost on a reload', async () => {
    await page.click('text=Next');
    await page.waitForFunction(() =>
      document.querySelector('.passage')?.textContent?.includes('Worn here'),
    );
    await wear('scarf');
    expect(await passageText()).toContain('Worn here: scarf');

    await reload();
    expect(await passageText()).toContain('Worn here: none');
  });

  it('a change recorded on the start passage survives a reload', async () => {
    await wear('hat');
    expect(await passageText()).toContain('Worn: hat');

    await reload();
    expect(await passageText()).toContain('Worn: hat');
    expect(await page.evaluate(() => (window as any).Story.passage)).toBe(
      'Start',
    );
  });
});
