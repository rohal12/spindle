import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';

let dir: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-591-594-'));
  const source = resolve(dir, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Value regressions

:: StoryData
{"ifid":"REVIEW-PROBE","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$inventory = []
$n = 1

:: StoryInit
{widget "Echo" @n @label}<span class="result">{@n}:{@label}</span>{/widget}

:: Start
{set _n = 7}
<div class="temporary">{_n} vs {print _n} vs {_n + 0}</div>
<div class="story-value">{$n} vs {print $n} vs {$n + 0}</div>
{textbox $n}
<div id="widgets">{Echo .5 "half"} {Echo -.5 "negative"} {Echo +.5 "positive"} {Echo .5e2 "exponent"}</div>
[[Next]]

:: Next
Next
`,
  );
  await compileToFile({
    sources: [source],
    outFile: resolve(dir, 'story.html'),
    formatPaths: [resolve(import.meta.dirname!, '../../dist/storyformats')],
  });
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(resolve(dir, 'story.html')));
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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage();
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).Story?.get('n') === 1);
  await page.evaluate(() => (window as any).Story.waitForActions());
});

it('renders leading-dot widget arguments with their labels (#594)', async () => {
  expect(await page.locator('#widgets .result').allTextContents()).toEqual([
    '0.5:half',
    '-0.5:negative',
    '0.5:positive',
    '50:exponent',
  ]);
  expect(await page.locator('.error').count()).toBe(0);
});

it.each(['fade-through', 'crossfade'])(
  'keeps temporary displays in the %s outgoing snapshot (#593)',
  async (type) => {
    await page.evaluate((type) => {
      const Story = (window as any).Story;
      Story.setTransition({ type, duration: 5000 });
      Story.goto('Next');
    }, type);
    await page.locator('.passage-snapshot').waitFor();
    expect(
      await page.locator('.passage-snapshot .temporary').textContent(),
    ).toBe('7 vs 7 vs 7');
  },
);

it('keeps departed story values and controls when loading another moment (#593)', async () => {
  await page.evaluate(async () => {
    const Story = (window as any).Story;
    await Story.save('old');
    Story.set('n', 2);
  });
  await page.waitForFunction(
    () => document.querySelector('.story-value')?.textContent === '2 vs 2 vs 2',
  );
  await page.evaluate(async () => {
    const Story = (window as any).Story;
    Story.setTransition({ type: 'fade-through', duration: 5000 });
    await Story.load('old');
  });
  await page.locator('.passage-snapshot').waitFor();
  expect(
    await page.locator('.passage-snapshot .story-value').textContent(),
  ).toBe('2 vs 2 vs 2');
  expect(await page.locator('.passage-snapshot input').inputValue()).toBe('2');
  expect(await page.evaluate(() => (window as any).Story.get('n'))).toBe(1);
});

it.each([1_000_000, 0xffffffff])(
  'bounds sparse saves of length %i before loading (#591)',
  async (length) => {
    const result = await page.evaluate(async (length) => {
      const Story = (window as any).Story;
      Story.setTransition({ type: 'none' });
      const data = JSON.stringify([
        { passage: 1, variables: 2, history: 4, historyIndex: 6 },
        'Start',
        { inventory: 3 },
        [-7, length],
        [5],
        { passage: 1, variables: 2, timestamp: 6 },
        0,
      ]);
      const file = {
        formatVersion: 1,
        ifid: 'REVIEW-PROBE',
        save: {
          meta: {
            id: 'probe',
            passage: 'Start',
            ifid: 'REVIEW-PROBE',
            playthroughId: 'probe',
            createdAt: '',
            updatedAt: '',
            title: 'probe',
          },
          payload: { formatVersion: 1, data },
        },
      };
      await Story.save('sparse');
      let error = '';
      try {
        await Story.importSave(file, 'sparse');
      } catch (err) {
        error = String(err);
      }
      // A rejected import must retain the old slot and running game.
      const liveLength = Story.get('inventory').length;
      const liveN = Story.get('n');
      await Story.load('sparse');
      await Story.waitForActions();
      const inventory = Story.get('inventory');
      // A second save also exercises history comparison and sharing.
      await Story.save('again');
      await Story.load('again');
      return {
        bytes: JSON.stringify(file).length,
        error,
        liveLength,
        liveN,
        length: inventory.length,
        keys: Object.keys(inventory),
        reloadedLength: Story.get('inventory').length,
      };
    }, length);
    expect(result.liveLength).toBe(0);
    expect(result.liveN).toBe(1);
    if (length > 1_000_000) {
      expect(result.bytes).toBe(386);
      expect(result.error).toContain('Invalid save file format');
      expect(result.length).toBe(0);
      expect(result.reloadedLength).toBe(0);
    } else {
      expect(result.error).toBe('');
      expect(result.length).toBe(length);
      expect(result.reloadedLength).toBe(length);
    }
    expect(result.keys).toEqual([]);
  },
  10_000,
);
