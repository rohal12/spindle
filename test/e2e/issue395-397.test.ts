/**
 * E2E tests that need a real browser:
 * - #395: an email autolink neither stops the story nor becomes an element;
 * - #396: a dialog's radio group leaves the passage's checked radio checked
 *   (happy-dom does not uncheck a group's members on insertion);
 * - #397: a restart closes a dialog the story interface opened.
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
const IFID = '33333333-4444-5555-6666-777777777777';

const header = `:: StoryTitle
Regression

:: StoryData
{"ifid":"${IFID}","format":"spindle","format-version":"0.1.0","start":"Start"}

`;

const stories: Record<string, string> = {
  email: `${header}:: StoryVariables

:: Start
Contact <support@example.com>.
`,
  radios: `${header}:: StoryVariables
$choice = "a"

:: Start
{radiobutton $choice "a" "A"}
{radiobutton $choice "b" "B"}
{dialog "Open"}Picker{/dialog}

:: Picker
{radiobutton $choice "a" "A"}
{radiobutton $choice "b" "B"}
`,
  restart: `${header}:: StoryVariables
$n = 0

:: StoryInterface
{dialog "Options"}Options{/dialog}
{passage}

:: Start
Start of the game.

:: Options
{button "Reset"}{do}Story.restart(){/do}{/button}
`,
};

let dir: string;
let served = 'email';
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

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
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

const open = async (story: string) => {
  served = story;
  await page.goto(baseUrl);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(baseUrl);
};

describe('an email autolink (#395)', () => {
  it('starts the story and renders a mailto link', async () => {
    await open('email');
    await page.waitForSelector('.passage');
    expect(await page.textContent('body')).not.toContain('Validation');
    expect(await page.getAttribute('.passage a', 'href')).toBe(
      'mailto:support@example.com',
    );
  });
});

describe('radio groups in a passage and a dialog (#396)', () => {
  const passageChecked = () =>
    page.$$eval('.passage input[type=radio]', (inputs) =>
      inputs
        .filter((i) => !i.closest('.dialog-panel'))
        .map((i) => (i as HTMLInputElement).checked),
    );

  it('keeps the passage selection through opening and closing the dialog', async () => {
    await open('radios');
    await page.waitForSelector('.passage input[type=radio]');
    expect(await passageChecked()).toEqual([true, false]);

    await page.click('button:has-text("Open")');
    await page.waitForSelector('.dialog-panel input[type=radio]');
    expect(await passageChecked()).toEqual([true, false]);
    expect(
      await page.$$eval('.dialog-panel input[type=radio]', (inputs) =>
        inputs.map((i) => (i as HTMLInputElement).checked),
      ),
    ).toEqual([true, false]);

    await page.click('.dialog-close');
    await page.waitForSelector('.dialog-panel', {
      state: 'detached',
      timeout: 5000,
    });
    expect(await passageChecked()).toEqual([true, false]);
    expect(await page.evaluate('Story.get("choice")')).toBe('a');
  });
});

describe('restart from a story interface dialog (#397)', () => {
  it('closes the dialog and shows the fresh start passage', async () => {
    await open('restart');
    await page.click('button:has-text("Options")');
    await page.waitForSelector('.dialog-panel');
    await page.click('.dialog-panel button:has-text("Reset")');
    await page.waitForSelector('.dialog-panel', {
      state: 'detached',
      timeout: 5000,
    });
    expect(await page.evaluate('Story.isDialogOpen()')).toBe(false);
    expect(await page.textContent('.passage')).toContain('Start of the game.');
  });
});
