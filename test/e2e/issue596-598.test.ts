import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileToFile } from '@rohal12/twee-ts';
import * as prettier from 'prettier';

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-596-598-'));
  const source = resolve(directory, 'story.twee');
  const original =
    '<div>\n{do}\n$s = "<!--SP:1-->";\n{/do}\n{set $n = 1}\n</div>';
  const toolingUrl = pathToFileURL(resolve('dist/pkg/tooling.js')).href;
  const { formatPassage } = (await import(
    toolingUrl
  )) as typeof import('../../src/tooling');
  const formatted = await formatPassage(original, { prettier });
  writeFileSync(
    source,
    `:: StoryTitle
Review regressions

:: StoryData
{"ifid":"59659800-0000-4000-8000-000000000000","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$alma = { notifications: [] }
$s = ""
$n = 0

:: Start
Start

:: Loop
{for @x, @i of $alma.notifications}{computed @prev = @i === 0 || $alma.notifications[@i - 1].v}<span class="row">{@x.v}:{@prev}:{$alma.notifications[@i].v}</span>{/for}

:: Original
${original}

:: Formatted
${formatted}

:: Protected
Protected

:: Redirect
Redirect
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
  await page.waitForFunction(() => (window as any).Story?.passage === 'Start');
  await page.evaluate(() => {
    (window as any).Story.setTransition({ type: 'none' });
    return (window as any).Story.waitForActions();
  });
});

it('reconciles shrinking and regrowing rows before evaluating their indices (#596)', async () => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const Story = (window as any).Story;
    Story.set('alma', { notifications: [{ v: 1 }, { v: 2 }, { v: 3 }] });
    Story.goto('Loop');
    await Story.waitForActions();
  });
  expect(await page.locator('.passage .row').allTextContents()).toEqual([
    '1:true:1',
    '2:1:2',
    '3:2:3',
  ]);
  for (const values of [[1], [], [4, 5], [4]]) {
    await page.evaluate(async (values) => {
      const Story = (window as any).Story;
      Story.set('alma', { notifications: values.map((v) => ({ v })) });
      await Story.waitForActions();
    }, values);
    expect(await page.locator('.passage .row').allTextContents()).toEqual(
      values.map((v, i) => `${v}:${i === 0 ? true : values[i - 1]}:${v}`),
    );
  }
  expect(errors).toEqual([]);
  expect(await page.locator('.error').count()).toBe(0);
});

it('keeps original and formatted gameplay equivalent with literal markers (#597)', async () => {
  const results = [];
  for (const passage of ['Original', 'Formatted']) {
    results.push(
      await page.evaluate(async (passage) => {
        const Story = (window as any).Story;
        Story.set({ s: '', n: 0 });
        Story.goto(passage);
        await Story.waitForActions();
        return { s: Story.get('s'), n: Story.get('n') };
      }, passage),
    );
  }
  expect(results).toEqual([
    { s: '<!--SP:1-->', n: 1 },
    { s: '<!--SP:1-->', n: 1 },
  ]);
  expect(await page.locator('.error').count()).toBe(0);
});

it('keeps the callback redirect and drops the guarded destination (#598)', async () => {
  const result = await page.evaluate(async () => {
    const Story = (window as any).Story;
    const after: string[] = [];
    Story.on('afternavigate', (to: string) => after.push(to));
    const off = Story.on('beforenavigate', (to: string) => {
      if (to === 'Protected') Story.goto('Redirect');
    });
    Story.goto('Protected');
    off();
    await Story.waitForActions();
    return {
      passage: Story.passage,
      previous: Story.previousPassage().name,
      guardedVisits: Story.visited('Protected'),
      after,
    };
  });
  expect(result).toEqual({
    passage: 'Redirect',
    previous: 'Start',
    guardedVisits: 0,
    after: ['Redirect'],
  });
});
