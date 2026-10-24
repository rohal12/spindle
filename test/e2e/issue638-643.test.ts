import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';
import type { StoryAPI } from '../../types/index';
declare const Story: StoryAPI;

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-638-643-'));
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Save, widget and transition regressions

:: StoryData
{"ifid":"63864300-0000-4000-8000-000000000000","format":"spindle","start":"Start"}

:: StoryVariables
$n = 0

:: StoryInit
{widget "option"}OPTION CONTENT{/widget}

:: Start
BEFORE {option} AFTER
<span title="{option}">Widget attribute</span>
[[{option}->Hall]]

:: Hall
Hall text.
`,
  );
  const output = resolve(directory, 'story.html');
  await compileToFile({
    sources: [source],
    outFile: output,
    formatPaths: [resolve('dist/storyformats')],
  });
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(readFileSync(output));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  if (directory) rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage();
  await page.goto(baseUrl);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
});

it('renders a companion-named widget in content, attributes and link labels (#642)', async () => {
  expect(await page.locator('.passage').textContent()).toContain(
    'BEFORE OPTION CONTENT AFTER',
  );
  expect(await page.locator('.passage span[title]').getAttribute('title')).toBe(
    'OPTION CONTENT',
  );
  expect(
    await page
      .getByRole('link', { name: 'OPTION CONTENT', exact: true })
      .count(),
  ).toBe(1);
  expect(await page.locator('.error').count()).toBe(0);
});

it('retains an outer hook write after a nested backup save (#638)', async () => {
  const value = await page.evaluate(async () => {
    let backup: Promise<unknown> | undefined;
    Story.on('beforesave', (slot) => {
      if (slot === 'main') {
        backup = Story.save('backup');
        Story.set('n', 1);
      }
    });
    Story.set('n', 1);
    await Story.save('main');
    await backup;
    Story.set('n', 2);
    await Story.load('main');
    await Story.waitForActions();
    return Story.get('n');
  });
  expect(value).toBe(1);
});

it.each(['restart', 'same-length load', 'non-tail load'])(
  'shows incoming-only content during %s (#643)',
  async (operation) => {
    if (operation !== 'restart') {
      await page.evaluate(() => {
        Story.setTransition({ type: 'none' });
        Story.goto('Hall');
      });
      await page.waitForFunction(() =>
        document.querySelector('.passage')?.textContent?.includes('Hall text.'),
      );
      if (operation === 'non-tail load') {
        await page.evaluate(() => Story.back());
        await page.waitForFunction(() =>
          document.querySelector('.passage')?.textContent?.includes('BEFORE'),
        );
      }
      await page.evaluate(() => Story.save('saved'));
    }
    await page.evaluate(async (operation) => {
      Story.setTransition({ type: 'fade-through', duration: 1000, pause: 100 });
      if (operation === 'restart') Story.restart();
      else await Story.load('saved');
      await Story.waitForActions();
      await new Promise((done) => setTimeout(done, 180));
    }, operation);
    expect(await page.locator('.passage-snapshot').count()).toBe(0);
    expect(await page.locator('.passage').getAttribute('data-transition')).toBe(
      'fade',
    );
    expect(await page.locator('.passage').textContent()).toContain(
      operation === 'same-length load' ? 'Hall text.' : 'BEFORE',
    );
  },
);
