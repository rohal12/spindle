/**
 * E2E reproduction test for issue #60:
 * {button} macro fails to parse when body contains HTML block elements.
 *
 * Requires dist/story.html to exist (run `npm run preview` first).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';

const projectRoot = resolve(import.meta.dirname!, '../..');
const distDir = resolve(projectRoot, 'dist');
const storyPath = resolve(distDir, 'story.html');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  if (!existsSync(storyPath)) {
    throw new Error('dist/story.html not found. Run `npm run preview` first.');
  }

  server = createServer((req, res) => {
    const filePath = resolve(
      distDir,
      (req.url || '/').replace(/^\//, '') || 'story.html',
    );
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  browser = await chromium.launch();
  page = await browser.newPage();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe('issue #60: button with HTML block elements', () => {
  it('renders button passage without parse errors', async () => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${baseUrl}/story.html`);
    await page.waitForSelector('[data-passage="Start"]');
    await page.click('a.macro-link:has-text("Button HTML test")');
    await page.waitForSelector('[data-passage="Button HTML Test"]');

    // No parse errors should have occurred
    const errorDivs = await page.$$('.passage .error');
    const errorTexts = await Promise.all(
      errorDivs.map((el) => el.textContent()),
    );
    expect(
      errorTexts.filter(
        (t) => t?.includes('Expected') || t?.includes('Unexpected'),
      ),
    ).toHaveLength(0);

    // The button should be rendered
    const button = await page.$('button.macro-button');
    expect(button).not.toBeNull();

    // No JS errors related to parsing
    expect(
      pageErrors.filter(
        (e) => e.includes('Expected') || e.includes('Unexpected'),
      ),
    ).toHaveLength(0);
  });

  it('button click does not throw errors', async () => {
    const pageErrors: string[] = [];

    const testPage = await browser.newPage();
    testPage.on('pageerror', (err) => pageErrors.push(err.message));

    await testPage.goto(`${baseUrl}/story.html`);
    await testPage.waitForSelector('[data-passage="Start"]');
    await testPage.click('a.macro-link:has-text("Button HTML test")');
    await testPage.waitForSelector('[data-passage="Button HTML Test"]');

    // Click the button — should not throw
    await testPage.click('button.macro-button');

    // Brief pause for any async errors to surface
    await testPage.waitForTimeout(500);

    expect(
      pageErrors.filter(
        (e) => e.includes('Expected') || e.includes('Unexpected'),
      ),
    ).toHaveLength(0);

    await testPage.close();
  });
});
