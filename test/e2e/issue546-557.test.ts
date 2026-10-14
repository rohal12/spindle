import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';

let dir: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-iframe-regressions-'));
  const source = resolve(dir, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Iframe regressions

:: StoryData
{"ifid":"54655700-0000-4000-8000-000000000000","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$n = 0

:: Start
<iframe class="widget" width="300" height="100" src="/widget"></iframe>
<iframe class="inline-widget" srcdoc="<script>parent.Story.set('n', Number(parent.Story.get('n')) + 1)</script>Inline"></iframe>
[[Next]]
{dialog "Open"}Popup{/dialog}

:: Next
Next {$n}

:: Popup
<iframe id="outer" srcdoc="<iframe id='inner' src='/initial'></iframe>"></iframe>
<button id="after">After</button>
`,
  );
  await compileToFile({
    sources: [source],
    outFile: resolve(dir, 'story.html'),
    formatPaths: [resolve(import.meta.dirname!, '../../dist/storyformats')],
  });
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/widget') {
      res.end(
        '<script>parent.Story.set("n", Number(parent.Story.get("n")) + 1)</script>Widget',
      );
    } else if (req.url === '/initial') {
      res.end('<button id="initial">Initial</button>');
    } else if (req.url === '/next') {
      res.end('<button id="replacement">Replacement</button>');
    } else {
      res.end(readFileSync(resolve(dir, 'story.html')));
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function boot() {
  await page.close();
  page = await browser.newPage();
  await page.goto(baseUrl);
  await page.waitForFunction(() => (window as any).Story?.get('n') === 2);
  await page.evaluate(async () => {
    await (window as any).Story.waitForActions();
  });
}

describe('passive outgoing iframe snapshots (#546)', () => {
  it.each(['crossfade', 'fade-through'])(
    'does not reload src or srcdoc during %s',
    async (type) => {
      await boot();
      let widgetRequests = 0;
      const count = (request: { url(): string }) => {
        if (request.url().endsWith('/widget')) widgetRequests++;
      };
      page.on('request', count);
      try {
        await page.evaluate((transition) => {
          const Story = (window as any).Story;
          Story.setTransition({ type: transition, duration: 5000 });
          Story.goto('Next');
        }, type);
        await page.locator('.passage-snapshot').waitFor();
        // Give a cloned browsing context time to load and execute its script.
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => (window as any).Story.get('n'))).toBe(
          2,
        );
        expect(widgetRequests).toBe(0);
        expect(await page.locator('.passage-snapshot iframe').count()).toBe(0);
        const size = await page
          .locator('.passage-snapshot .widget')
          .boundingBox();
        expect(size!.width).toBeGreaterThanOrEqual(300);
        expect(size!.height).toBeGreaterThan(99);
      } finally {
        page.off('request', count);
      }
    },
  );
});

it('reattaches Escape after a nested same-origin frame replaces its document (#557)', async () => {
  await boot();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const inner = page.frameLocator('#outer').frameLocator('#inner');
  await inner.locator('#initial').waitFor();
  await page
    .frameLocator('#outer')
    .locator('#inner')
    .evaluate((frame) => {
      (frame as HTMLIFrameElement).src = '/next';
    });
  await inner.locator('#replacement').focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator('.dialog-panel').count()).toBe(0);
});
