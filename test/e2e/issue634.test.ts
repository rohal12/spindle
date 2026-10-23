import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';

let dir: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-634-'));
  const source = resolve(dir, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Conditional whitespace

:: StoryData
{"ifid":"WHITESPACE-634","format":"spindle","format-version":"0.1.0","start":"ProbePlain"}

:: StoryVariables
$show = true

:: StoryInit
{widget "Words"} B. {/widget}

:: ProbePlain
A.{if $show} B.{else} X.{/if} C.{if false}x{else} D.{/if}

:: ProbeNobr [nobr]
<p>A.{if $show} B.{else} X.{/if} C.{if false}x{else} D.{/if}</p>

:: Widget
A.{Words}C. D.

:: Markdown
{if true}
# Heading

- One
- Two
{/if}
`,
  );
  const output = resolve(dir, 'story.html');
  await compileToFile({
    sources: [source],
    outFile: output,
    formatPaths: [resolve(import.meta.dirname!, '../../dist/storyformats')],
  });
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(output));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  );
  await page.waitForSelector('[data-passage="ProbePlain"]');
  await page.evaluate(() =>
    (window as any).Story.setTransition({ type: 'none' }),
  );
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  if (dir) rmSync(dir, { recursive: true, force: true });
});

it.each(['ProbePlain', 'ProbeNobr', 'Widget'])(
  'keeps spaces around macro bodies in %s (#634)',
  async (passage) => {
    await page.evaluate(async (passage) => {
      const Story = (window as any).Story;
      Story.goto(passage);
      await Story.waitForActions();
    }, passage);
    expect((await page.locator('.passage').textContent())?.trim()).toBe(
      'A. B. C. D.',
    );
    await page.evaluate(async () => {
      const Story = (window as any).Story;
      Story.set('show', false);
      await Story.waitForActions();
    });
    expect((await page.locator('.passage').textContent())?.trim()).toBe(
      passage === 'Widget' ? 'A. B. C. D.' : 'A. X. C. D.',
    );
    await page.evaluate(() => (window as any).Story.set('show', true));
  },
);

it('keeps block Markdown inside a macro body (#634)', async () => {
  await page.evaluate(async () => {
    const Story = (window as any).Story;
    Story.goto('Markdown');
    await Story.waitForActions();
  });
  expect(await page.locator('.passage h1').textContent()).toBe('Heading');
  expect(await page.locator('.passage li').allTextContents()).toEqual([
    'One',
    'Two',
  ]);
});
