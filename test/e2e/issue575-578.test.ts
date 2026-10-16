import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(
    resolve(tmpdir(), 'spindle-observation-regressions-'),
  );
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Observation regressions

:: StoryData
{"ifid":"57557800-0000-4000-8000-000000000000","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$n = 0

:: StoryInit
{set $n = 1n}

:: Styles [stylesheet]
.secret { display: none; }
.veiled { visibility: hidden; }
.collapsed { visibility: collapse; }
.restored { visibility: visible; }

:: Start
Visible passage
<div class="secret">Passage secret {print null.passageFailure}</div>
<div class="veiled">Veiled passage <span class="restored">Restored text</span></div>
<div class="collapsed">Collapsed passage</div>
{numberbox $n}
[[Contact]]

:: Contact
Contact <mailto:support@example.com> <tel:12345> <urn:isbn:12345>.

:: StoryContext
Visible context
<span class="secret">Context secret {print null.contextFailure}</span>

:: Popup
Visible dialog
<span class="secret">Dialog secret {print null.dialogFailure}</span>
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
  await new Promise<void>((done) => server?.close(() => done()));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage();
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).Story?.get('n') === 1n);
  await page.evaluate(() => (window as any).Story.waitForActions());
});

it('boots with URI autolinks in an unvisited passage, then renders them (#576)', async () => {
  await page.evaluate(() => (window as any).Story.step('link:Contact'));
  // Markdown's protocol filter keeps mailto and clears unsupported schemes.
  expect(
    await page
      .locator('.passage a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(['mailto:support@example.com', '', '']);
  expect(await page.locator('.passage a').allTextContents()).toEqual([
    'mailto:support@example.com',
    'tel:12345',
    'urn:isbn:12345',
  ]);
  expect(
    await page.locator('.passage mailto, .passage tel, .passage urn').count(),
  ).toBe(0);
});

it('omits CSS-hidden passage, dialog and context content until revealed (#577)', async () => {
  const first = await page.evaluate(() => (window as any).Story.observe());
  expect(first.text).toContain('Visible passage');
  expect(first.text).toContain('Restored text');
  expect(first.text).not.toMatch(/secret|Veiled|Collapsed|Failure/);
  expect(first.context).toBe('Visible context');
  expect(first.errors).toEqual([]);

  await page.evaluate(async () => {
    const Story = (window as any).Story;
    Story.openDialog('Popup');
    await Story.waitForActions();
  });
  const opened = await page.evaluate(() => (window as any).Story.observe());
  expect(opened.dialogs).toEqual([
    { passage: 'Popup', text: 'Visible dialog' },
  ]);
  expect(opened.errors).toEqual([]);

  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.secret, .veiled, .collapsed'))
      el.removeAttribute('class');
  });
  const revealed = await page.evaluate(() => (window as any).Story.observe());
  expect(revealed.text).toContain('Passage secret');
  expect(revealed.text).toContain('Veiled passage');
  expect(revealed.text).toContain('Collapsed passage');
  expect(revealed.context).toContain('Context secret');
  expect(revealed.dialogs[0].text).toContain('Dialog secret');
  expect(revealed.errors).toHaveLength(3);
  for (const field of ['passageFailure', 'contextFailure', 'dialogFailure'])
    expect(revealed.errors.some((error: string) => error.includes(field))).toBe(
      true,
    );
});

it('serializes BigInt control observations across the JSON boundary (#578)', async () => {
  const result = await page.evaluate(() => {
    const Story = (window as any).Story;
    const observation = Story.observe();
    return {
      observation: JSON.parse(JSON.stringify(observation)),
      cloned: structuredClone(observation),
      liveType: typeof Story.getActions().find(
        (a: any) => a.type === 'numberbox',
      ).value,
    };
  });
  expect(result.observation).toEqual(result.cloned);
  expect(
    result.observation.actions.find((a: any) => a.type === 'numberbox').value,
  ).toBe('1n');
  expect(result.observation.text).toContain('[numberbox $n: 1]');
  expect(result.liveType).toBe('bigint');
});

it('respects CSS-hidden passage ancestors while still reading the context host (#577)', async () => {
  const seen = await page.evaluate(() => {
    const parent = document.querySelector('.passage')!.parentElement!;
    parent.style.display = 'none';
    const observation = (window as any).Story.observe();
    parent.style.display = '';
    return observation;
  });
  expect(seen.text).toBe('');
  expect(seen.errors).toEqual([]);
  expect(seen.context).toBe('Visible context');
});
