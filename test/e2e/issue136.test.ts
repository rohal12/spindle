/**
 * E2E reproduction test for issue #136:
 * Consecutive {set} macros can't see each other's variable mutations.
 *
 * Requires dist/story.html to exist (run `npm run preview` first).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { sendFile } from './serve';

const projectRoot = resolve(import.meta.dirname!, '../..');
const distDir = resolve(projectRoot, 'dist');
const storyPath = resolve(distDir, 'story.html');

let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  if (!existsSync(storyPath)) {
    throw new Error('dist/story.html not found. Run `npm run preview` first.');
  }

  server = createServer((req, res) =>
    sendFile(res, distDir, (req.url || '/').replace(/^\//, '') || 'story.html'),
  );

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

describe('issue #136: consecutive {set} mutations', () => {
  beforeAll(async () => {
    // Collect page errors
    page.on('pageerror', (err) => {
      console.error('Page error:', err.message);
    });

    await page.goto(`${baseUrl}/story.html`);
    await page.waitForSelector('[data-passage="Start"]');
    await page.click('a.macro-link:has-text("Consecutive set")');
    await page.waitForSelector('[data-passage="Consecutive Set Test"]');
  });

  it('second {set} sees _temp from first {set} — renders Result: 1,2,3', async () => {
    const text = await page.textContent(
      '[data-passage="Consecutive Set Test"]',
    );
    console.log('PAGE TEXT:', JSON.stringify(text));
    const errors = await page.$$eval('.error', (els) =>
      els.map((e) => e.textContent),
    );
    console.log('ERRORS:', JSON.stringify(errors));
    expect(errors).toHaveLength(0);
    expect(text).toContain('Result: 1,2,3');
  });
});
