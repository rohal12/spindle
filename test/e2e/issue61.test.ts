/**
 * Reproduction test for issue #61:
 * Tokenizer fails with deeply nested HTML in PassageDialog + {include}
 *
 * Requires dist/story.html to exist (run `bun run preview` first).
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
    throw new Error('dist/story.html not found. Run `bun run preview` first.');
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

async function navigateFresh() {
  await page.goto(`${baseUrl}/story.html`);
  await page.waitForSelector('[data-passage="Start"]');
}

async function clickLink(text: string) {
  await page.click(`a.macro-link:has-text("${text}")`);
}

describe('issue #61: nested HTML + {include} in dialog', () => {
  it('DialogSidebar opens individually without error', async () => {
    await navigateFresh();
    await clickLink('Nested HTML include');
    await page.waitForSelector('[data-passage="Nested HTML Include Test"]');

    // Collect console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.click('button:has-text("Open DialogSidebar alone")');
    await page.waitForSelector('.dialog-overlay');

    const dialogText = await page.textContent('.dialog-body');
    expect(dialogText).toContain('Home');
    expect(dialogText).toContain('Settings');
    expect(dialogText).toContain('About');

    await page.click('.dialog-close');
    await page.waitForSelector('.dialog-overlay', { state: 'detached' });

    expect(errors.filter((e) => e.includes('Unexpected closing'))).toHaveLength(
      0,
    );
  });

  it('DialogShell with {include} opens without "Unexpected closing" error', async () => {
    // Use a fresh page to capture errors from the start
    const testPage = await browser.newPage();

    const pageErrors: string[] = [];
    testPage.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await testPage.goto(`${baseUrl}/story.html`);
    await testPage.waitForSelector('[data-passage="Start"]');
    await testPage.click('a.macro-link:has-text("Nested HTML include")');
    await testPage.waitForSelector('[data-passage="Nested HTML Include Test"]');

    await testPage.click('button:has-text("Open DialogShell")');

    // Wait briefly for the dialog attempt
    await testPage.waitForTimeout(2000);

    // Check for uncaught errors
    console.log('Page errors:', JSON.stringify(pageErrors));

    // Check if dialog appeared or if there's an error
    const overlay = await testPage.$('.dialog-overlay');
    console.log('Dialog overlay found:', !!overlay);

    if (overlay) {
      const errorDiv = await overlay.$('.error');
      if (errorDiv) {
        console.log('Error div:', await errorDiv.textContent());
      }
      const bodyText = await testPage.textContent('.dialog-body');
      console.log('Body text:', bodyText);
    }

    await testPage.close();

    // Assertions
    expect(
      pageErrors.filter((e) => e.includes('Unexpected closing')),
    ).toHaveLength(0);
    expect(overlay).not.toBeNull();
  });
});
