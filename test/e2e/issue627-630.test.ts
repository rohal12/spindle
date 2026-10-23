import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { stringify, parse } from 'devalue';
import type { StoryAPI } from '../../types/index';
declare const Story: StoryAPI;
import { compileToFile } from '@rohal12/twee-ts';

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-627-630-'));
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Save replay regressions

:: StoryData
{"ifid":"62763000-0000-4000-8000-000000000000","format":"spindle","start":"Start"}

:: StoryVariables
$x = 0
$hits = 0
$late = 0

:: StoryInit
{widget "do"}{@children}{/widget}
{widget "Wrap"}{do}{@children}{/do}{/widget}
{Wrap}Startup composition works{/Wrap}

:: Start
{watch "$x > 0" run "$hits += 1" once}
{watch "$x > 1" run "$late += 1" once}
{Wrap}Forwarded content{/Wrap}
[[Next]]

:: Next
{set $x = 1}
Hits: {$hits}
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
});

it('boots composed block widgets that replace do (#630)', async () => {
  expect(await page.locator('.passage').textContent()).toContain(
    'Forwarded content',
  );
  expect(await page.locator('.error').count()).toBe(0);
});

it('replays a consumed watcher after repeated loads while retaining later consumption (#627)', async () => {
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await page.waitForFunction(() => Story.get('hits') === 1);
  await page.evaluate(async () => {
    await Story.save('checkpoint');
    for (let i = 0; i < 2; i++) {
      await Story.load('checkpoint');
      await Story.waitForActions();
      if (Story.get('hits') !== 1) throw new Error('entry watcher reward lost');
    }
    Story.set('x', 2);
    await Story.waitForActions();
    if (Story.get('late') !== 1) throw new Error('later watcher did not fire');
    await Story.save('later');
    await Story.load('later');
    await Story.waitForActions();
    Story.set('x', 2);
    await Story.waitForActions();
  });
  expect(
    await page.evaluate(() => [Story.get('hits'), Story.get('late')]),
  ).toEqual([1, 0]);
  expect(await page.locator('.passage').textContent()).toContain('Hits: 1');
});

it('loads compact shared history and keeps only the configured limit (#628)', async () => {
  const variables = Object.fromEntries(
    Array.from({ length: 2000 }, (_, i) => ['v' + i, i]),
  );
  const moment = { passage: 'Start', variables, timestamp: 0 };
  const data = stringify({
    passage: 'Start',
    variables,
    history: Array(2000).fill(moment),
    historyIndex: 1999,
    watchers: [],
  });
  const result = await page.evaluate(async (data) => {
    await Story.save('initial');
    const exported = (await Story.exportSave('initial'))!;
    exported.save.payload = { formatVersion: 1, data };
    await Story.importSave(exported, 'shared');
    await Story.load('shared');
    await Story.waitForActions();
    await Story.save('retained');
    return {
      data: (await Story.exportSave('retained'))!.save.payload.data,
      value: Story.get('v1999'),
    };
  }, data);
  expect(parse(result.data).history).toHaveLength(40);
  expect(result.value).toBe(1999);
});
