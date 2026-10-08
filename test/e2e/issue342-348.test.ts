/**
 * E2E tests that need a real browser layout or a page refresh:
 * - #348: {type} reveals wrapped text in reading order;
 * - #342: a session or save of a passage the updated story lacks is not
 *   restored.
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

/** Evaluate an expression with the page's `Story` API. */
const inPage = (expr: string) => page.evaluate(expr);

const projectRoot = resolve(import.meta.dirname!, '../..');
const IFID = '22222222-3333-4444-5555-666666666666';

const footer = '\n:: StoryVariables\n';

const header = `:: StoryTitle
Regression

:: StoryData
{"ifid":"${IFID}","format":"spindle","format-version":"0.1.0","start":"Start"}

`;

const LONG =
  'ABCDEFGHIJKLM NOPQRSTUVWXYZ abcdefghijklm nopqrstuvwxyz 0123456789 ' +
  'ABCDEFGHIJKLM NOPQRSTUVWXYZ abcdefghijklm nopqrstuvwxyz 0123456789';

const stories: Record<string, string> = {
  type: `${header}:: Start
{type 150ms}${LONG}{/type}
`,
  v1: `${header}:: Start
[[Old]]

:: Old
Old passage
`,
  v2: `${header}:: Start
Start passage

:: New
New passage
`,
};

let dir: string;
let served = 'type';
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-e2e-'));
  for (const [name, twee] of Object.entries(stories)) {
    const src = resolve(dir, `${name}.twee`);
    writeFileSync(src, twee + footer);
    await compileToFile({
      sources: [src],
      outFile: resolve(dir, `${name}.html`),
      formatPaths: [resolve(projectRoot, 'dist/storyformats')],
    });
  }
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(resolve(dir, `${served}.html`)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
  page = await browser.newPage({ viewport: { width: 260, height: 700 } });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** Rectangles of the clip path of the typewriter's text. */
const clipRects = () =>
  page.$eval(
    '.macro-type-inner',
    (el) => ((el as HTMLElement).style.clipPath.match(/M/gi) ?? []).length,
  );

describe('{type} with wrapped text (#348)', () => {
  it('reveals whole lines in reading order, then everything', async () => {
    served = 'type';
    await page.goto(baseUrl);
    await page.waitForSelector('.macro-type-inner');

    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(400);
      if (await page.$('.macro-type-done')) break;
      seen.push(await clipRects());
    }
    // Several lines were laid out, and the revealed boxes grew line by line
    // (the old clip was one horizontal percentage of the whole box)
    expect(Math.max(...seen)).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));

    await page.waitForSelector('.macro-type-done', { timeout: 30_000 });
    const clip = await page.$eval(
      '.macro-type-inner',
      (el) => (el as HTMLElement).style.clipPath,
    );
    expect(clip).toBe('');
  });
});

describe('a story updated since the session was made (#342)', () => {
  const text = () => page.textContent('body');

  it('starts the updated story instead of restoring a removed passage', async () => {
    served = 'v1';
    await page.goto(baseUrl);
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(baseUrl);
    await page.click('a.macro-link:has-text("Old")');
    await page.waitForSelector('text=Old passage');

    served = 'v2';
    await page.reload();
    await page.waitForSelector('text=Start passage');
    expect(await text()).not.toContain('not found');
    expect(await inPage('Story.passage')).toBe('Start');
  });

  it('rejects loading a save of a removed passage and keeps the game', async () => {
    served = 'v1';
    await page.goto(baseUrl);
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(baseUrl);
    await page.click('a.macro-link:has-text("Old")');
    await page.waitForSelector('text=Old passage');
    await inPage("Story.save('old')");

    served = 'v2';
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(baseUrl);
    await page.waitForSelector('text=Start passage');
    const rejected = await inPage(
      'Story.load("old").then(() => false, () => true)',
    );
    expect(rejected).toBe(true);
    expect(await inPage('Story.passage')).toBe('Start');
    expect(await text()).not.toContain('not found');
  });
});
