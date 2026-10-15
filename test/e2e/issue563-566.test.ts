import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-resource-actions-'));
  const source = resolve(dir, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Resources and controls

:: StoryData
{"ifid":"56356600-0000-4000-8000-000000000000","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$loads = 0
$errors = 0
$enabled = false
$legend = false
$secondLegend = false
$hits = 0

:: Start
<img class="loaded" src="/pixel.svg" onload="Story.set('loads', Number(Story.get('loads')) + 1)">
<img class="broken" src="/missing.png" onerror="Story.set('errors', Number(Story.get('errors')) + 1)">
<fieldset id="locked" disabled>
<legend>{checkbox $legend "Legend"}</legend>
<legend>{checkbox $secondLegend "Second legend"}</legend>
{checkbox $enabled "Locked"}
{button "Locked button"}{set $hits += 1}{/button}
{#snapshot-shared button "Shared"}{set $hits += 10}{/button}
</fieldset>
<div class="hidden-control">{button "CSS hidden"}{/button}</div>
<div hidden>{button "Hidden"}{/button}</div>
<details><summary>{button "Summary"}{/button}</summary>{button "Detail"}{/button}</details>
[[Next]]

:: Next
Next

:: Enabled
{#snapshot-shared button "Shared"}{set $hits += 100}{/button}
`,
  );
  await compileToFile({
    sources: [source],
    outFile: resolve(dir, 'story.html'),
    formatPaths: [resolve(import.meta.dirname!, '../../dist/storyformats')],
  });
  server = createServer((req, res) => {
    if (req.url === '/pixel.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
      );
    } else if (req.url === '/missing.png') {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(resolve(dir, 'story.html')));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await page.goto(baseUrl);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForFunction(
    () =>
      (window as any).Story?.get('loads') === 1 &&
      (window as any).Story.get('errors') === 1,
  );
  await page.evaluate(() => (window as any).Story.waitForActions());
});

describe('reader control and resource regressions', () => {
  it.each(['crossfade', 'fade-through'])(
    'keeps %s snapshots passive when images load or fail (#563)',
    async (type) => {
      await page.evaluate((type) => {
        const Story = (window as any).Story;
        Story.setTransition({ type, duration: 5000 });
        Story.goto('Next');
      }, type);
      await page.locator('.passage-snapshot').waitFor();
      expect(
        await page.locator('.passage-snapshot .loaded').getAttribute('src'),
      ).toBe('/pixel.svg');
      expect(
        await page
          .locator('.passage-snapshot [onload], .passage-snapshot [onerror]')
          .count(),
      ).toBe(0);
      // Let the cloned successful and failed resources settle too.
      await page.waitForTimeout(250);
      expect(
        await page.evaluate(() => [
          (window as any).Story.get('loads'),
          (window as any).Story.get('errors'),
        ]),
      ).toEqual([1, 1]);
    },
  );

  it('refuses fieldset-disabled inputs and buttons, including dynamic changes (#566)', async () => {
    await page
      .locator('input[data-action="checkbox:$enabled"]')
      .click({ force: true });
    expect(
      await page.evaluate(() => (window as any).Story.get('enabled')),
    ).toBe(false);
    const result = await page.evaluate(async () => {
      const Story = (window as any).Story;
      const ids = [
        'checkbox:$enabled',
        'checkbox:$secondLegend',
        'button:"Locked button"',
      ];
      const flags = ids.map(
        (id) =>
          Story.getActions().find((action: any) => action.id === id)?.disabled,
      );
      const rejected = [];
      for (const id of ids) {
        try {
          await Story.step(id);
          rejected.push(false);
        } catch (error) {
          rejected.push((error as Error).message.includes('disabled'));
        }
      }
      await Story.step('checkbox:$legend');
      const firstLegend = Story.get('legend');
      document.querySelector<HTMLFieldSetElement>('#locked')!.disabled = false;
      const enabledFlag = !!Story.getActions().find(
        (action: any) => action.id === 'checkbox:$enabled',
      ).disabled;
      await Story.step('checkbox:$enabled');
      await Story.step('button:"Locked button"');
      document.querySelector<HTMLFieldSetElement>('#locked')!.disabled = true;
      let disabledAgain = false;
      try {
        await Story.step('button:"Locked button"');
      } catch {
        disabledAgain = true;
      }
      return {
        flags,
        rejected,
        firstLegend,
        enabledFlag,
        disabledAgain,
        enabled: Story.get('enabled'),
        secondLegend: Story.get('secondLegend'),
        hits: Story.get('hits'),
      };
    });
    expect(result).toEqual({
      flags: [true, true, true],
      rejected: [true, true, true],
      firstLegend: true,
      enabledFlag: false,
      disabledAgain: true,
      enabled: true,
      secondLegend: false,
      hits: 1,
    });
  });

  it('keeps current actions independent of disabled outgoing snapshot controls (#563, #566)', async () => {
    await page.evaluate(async () => {
      const Story = (window as any).Story;
      Story.setTransition({ type: 'crossfade', duration: 5000 });
      Story.goto('Enabled');
      await Story.waitForActions();
    });
    await page.locator('.passage-snapshot').waitFor();
    const result = await page.evaluate(async () => {
      const Story = (window as any).Story;
      const action = Story.getActions().find(
        (action: any) => action.id === 'snapshot-shared',
      );
      if (action.disabled) return { disabled: true, hits: Story.get('hits') };
      await Story.step(action.id);
      return { disabled: false, hits: Story.get('hits') };
    });
    expect(result).toEqual({ disabled: false, hits: 100 });
  });

  it('observes CSS visibility and collapsed details without relying on layout size (#565)', async () => {
    await page.addStyleTag({ content: '.hidden-control { display: none; }' });
    const labels = await page.evaluate(() =>
      (window as any).Story.observe().actions.map(
        (action: any) => action.label,
      ),
    );
    expect(labels).not.toContain('CSS hidden');
    expect(labels).not.toContain('Hidden');
    expect(labels).not.toContain('Detail');
    expect(labels).toContain('Summary');
    await page.locator('summary').click();
    expect(
      await page.evaluate(() =>
        (window as any).Story.observe().actions.map(
          (action: any) => action.label,
        ),
      ),
    ).toContain('Detail');
  });
});
