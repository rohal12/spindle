/**
 * E2E tests of #453-#461 in a real browser, with the issues' own stories:
 * - #453: raw CSS URLs in a passage <style>;
 * - #454: settings controls follow Story.settings.set;
 * - #455: inline Markdown in {type};
 * - #456: dialogs have accessible names;
 * - #458: click bodies are released once settled;
 * - #459: HTML comments in tables and details;
 * - #460: Tab enters the controls of an iframe in a dialog;
 * - #461: Tab steps through the segments of a date input in a dialog.
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

const stories: Record<string, string> = {
  styleUrl: `${header('45300000-0000-4000-8000-000000000453')}:: StoryVariables

:: Start
<style>
.texture { background-image: url("/image.png?theme=dark&notch=1"); }
.amp::after { content: "&amp;"; }
</style>
<div class="texture amp">Texture</div>
`,
  settingsSet: `${header('45400000-0000-4000-8000-000000000454')}:: StoryVariables

:: StoryInit
{do}
Story.settings.addToggle("dark", { label: "Dark mode", default: true });
{/do}

:: Start
{settings-controls}
{button "Reset"}
  {do}Story.settings.set("dark", false);{/do}
{/button}
`,
  typeMarkdown: `${header('45500000-0000-4000-8000-000000000455')}:: StoryVariables

:: Start
{type 1ms}A **bold** and *italic* message.{/type}
`,
  dialogNames: `${header('45600000-0000-4000-8000-000000000456')}:: StoryVariables

:: Start
{saves}
{dialog "Open"}Popup{/dialog}
{dialog "Plain"}Plain{/dialog}

:: Popup
# Heading
Text

:: Plain
Text
`,
  clickBodies: `${header('45800000-0000-4000-8000-000000000458')}:: StoryVariables
$n = 0

:: Start
{button "Increment"}{if $n >= 0}{set $n += 1}{/if}{/button}
{button "Later"}{timed 300ms}{set $n += 1000}{/timed}{/button}
`,
  comments: `${header('45900000-0000-4000-8000-000000000459')}:: StoryVariables

:: Start
<table id="t"><tbody>
<!-- rows -->

<tr><td>HP</td><td>10</td></tr>

<tr><td>Mana</td><td>5</td></tr>
</tbody></table>

<details id="d">
<!-- A hint -->

<summary>Read hint</summary>
Secret
</details>
`,
  dialogIframe: `${header('46000000-0000-4000-8000-000000000460')}:: StoryVariables

:: Start
{dialog "Open"}Popup{/dialog}

:: Popup
<button id="before">Before</button>
<iframe id="frame" srcdoc="<button id='inside1'>First</button><button id='inside2'>Second</button>"></iframe>
<button id="after">After</button>
`,
  dialogDate: `${header('46100000-0000-4000-8000-000000000461')}:: StoryVariables

:: Start
{dialog "Open"}Popup{/dialog}

:: Popup
<input id="birth" type="date">
<button id="after">After</button>
`,
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
    if (url.pathname === '/image.png') {
      res.writeHead(404);
      res.end();
      return;
    }
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

describe('passage-local <style> (#453)', () => {
  it('keeps its CSS text raw', async () => {
    await open('styleUrl');
    const css = await page.textContent('.passage style');
    expect(css).toContain('/image.png?theme=dark&notch=1');
    expect(css).toContain('content: "&amp;"');
    const bg = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.texture')!).backgroundImage,
    );
    expect(bg).toContain('theme=dark&notch=1');
  });
});

describe('settings controls (#454)', () => {
  it('follow Story.settings.set', async () => {
    await open('settingsSet');
    expect(await page.isChecked('.settings-row input')).toBe(true);
    await page.click('button:has-text("Reset")');
    expect(await page.isChecked('.settings-row input')).toBe(false);
  });
});

describe('{type} (#455)', () => {
  it('renders inline Markdown', async () => {
    await open('typeMarkdown');
    await page.waitForSelector('.macro-type-done');
    expect(await page.textContent('.macro-type')).toBe(
      'A bold and italic message.',
    );
    expect(await page.locator('.macro-type strong').count()).toBe(1);
    expect(await page.locator('.macro-type em').count()).toBe(1);
  });
});

describe('dialog names (#456)', () => {
  it('name built-in and story dialogs', async () => {
    await open('dialogNames');
    await page.click('button:has-text("Saves")');
    expect(await page.getAttribute('[role="dialog"]', 'aria-label')).toBe(
      'Saves',
    );
    await page.click('.dialog-close');
    await page.click('button:has-text("Open")');
    const name = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')!;
      const id = d.getAttribute('aria-labelledby');
      return document.getElementById(id ?? '')?.textContent;
    });
    expect(name).toBe('Heading');
    await page.click('.dialog-close');
    await page.click('button:has-text("Plain")');
    expect(await page.getAttribute('[role="dialog"]', 'aria-label')).toBe(
      'Plain',
    );
  });
});

describe('click bodies (#458)', () => {
  it('are released once settled, and kept while pending', async () => {
    await open('clickBodies');
    for (let i = 0; i < 50; i++) {
      await page.click('button:has-text("Increment")');
    }
    await page.waitForTimeout(100);
    expect(await page.evaluate('Story.get("n")')).toBe(50);
    await page.click('button:has-text("Later")');
    await page.waitForTimeout(600);
    expect(await page.evaluate('Story.get("n")')).toBe(1050);
  });
});

describe('HTML comments in structural content (#459)', () => {
  it('leave the table rows and the summary in place', async () => {
    await open('comments');
    expect(
      await page.evaluate('document.querySelector("#t").rows.length'),
    ).toBe(2);
    expect(await page.locator('#d > summary').textContent()).toBe('Read hint');
  });
});

describe('Tab in a dialog', () => {
  it('enters the controls of an iframe (#460)', async () => {
    await open('dialogIframe');
    await page.click('button:has-text("Open")');
    await page.waitForFunction(
      () =>
        !!document
          .querySelector<HTMLIFrameElement>('#frame')
          ?.contentDocument?.getElementById('inside2'),
    );
    const active = () =>
      page.evaluate(() => {
        const frame = document.querySelector<HTMLIFrameElement>('#frame')!;
        const inner = frame.contentDocument?.activeElement;
        return document.activeElement === frame && inner?.id
          ? `frame:${inner.id}`
          : document.activeElement?.id;
      });
    expect(await active()).toBe('before');
    await page.keyboard.press('Tab');
    expect(await active()).toBe('frame:inside1');
    await page.keyboard.press('Tab');
    expect(await active()).toBe('frame:inside2');
    await page.keyboard.press('Tab');
    expect(await active()).toBe('after');
    await page.keyboard.press('Shift+Tab');
    expect(await active()).toBe('frame:inside2');
  });

  it('steps through the segments of a date input (#461)', async () => {
    await open('dialogDate');
    await page.click('button:has-text("Open")');
    await page.locator('#birth').fill('2000-12-25');
    await page.locator('#birth').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate('document.activeElement.id')).toBe('birth');
    expect(await page.inputValue('#birth')).not.toBe('2000-12-25');
    // Through the last segment, then on to the next control
    for (let i = 0; i < 6; i++) {
      if ((await page.evaluate('document.activeElement.id')) === 'after') break;
      await page.keyboard.press('Tab');
    }
    expect(await page.evaluate('document.activeElement.id')).toBe('after');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate('document.activeElement.id')).toBe('birth');
  });
});
