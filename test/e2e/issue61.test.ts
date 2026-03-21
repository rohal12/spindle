/**
 * E2E reproduction test for issue #61:
 * Tokenizer fails with special characters in HTML attribute names
 * and deeply nested HTML in PassageDialog + {include}.
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

async function navigateToTestPage() {
  await page.goto(`${baseUrl}/story.html`);
  await page.waitForSelector('[data-passage="Start"]');
  await page.click('a.macro-link:has-text("Nested HTML include")');
  await page.waitForSelector('[data-passage="Nested HTML Include Test"]');
}

async function openDialogAndCheck(
  buttonText: string,
  expectedContent: string[],
) {
  const testPage = await browser.newPage();

  const pageErrors: string[] = [];
  testPage.on('pageerror', (err) => pageErrors.push(err.message));

  await testPage.goto(`${baseUrl}/story.html`);
  await testPage.waitForSelector('[data-passage="Start"]');
  await testPage.click('a.macro-link:has-text("Nested HTML include")');
  await testPage.waitForSelector('[data-passage="Nested HTML Include Test"]');

  await testPage.click(`button:has-text("${buttonText}")`);
  await testPage.waitForSelector('.dialog-overlay', { timeout: 5000 });

  // Check no error div in dialog
  const errorDiv = await testPage.$('.dialog-body .error');
  const errorText = errorDiv ? await errorDiv.textContent() : null;

  // Check expected content rendered
  const bodyText = await testPage.textContent('.dialog-body');

  await testPage.close();

  return { pageErrors, errorText, bodyText };
}

describe('issue #61: HTML attribute parsing in dialogs', () => {
  it('DialogSidebar: deeply nested HTML renders without error', async () => {
    const { pageErrors, errorText, bodyText } = await openDialogAndCheck(
      'Open DialogSidebar alone',
      ['Home', 'Settings', 'About'],
    );

    expect(errorText).toBeNull();
    expect(
      pageErrors.filter((e) => e.includes('Unexpected closing')),
    ).toHaveLength(0);
    expect(bodyText).toContain('Home');
    expect(bodyText).toContain('Settings');
    expect(bodyText).toContain('About');
  });

  it('DialogShell: {include} with nested HTML renders without error', async () => {
    const { pageErrors, errorText, bodyText } = await openDialogAndCheck(
      'Open DialogShell',
      ['Header', 'Home', 'Content here'],
    );

    expect(errorText).toBeNull();
    expect(
      pageErrors.filter((e) => e.includes('Unexpected closing')),
    ).toHaveLength(0);
    expect(bodyText).toContain('Header');
    expect(bodyText).toContain('Home');
    expect(bodyText).toContain('Content here');
  });

  it('AttrNames: colon/namespace in attribute names renders without error', async () => {
    const { pageErrors, errorText, bodyText } = await openDialogAndCheck(
      'Open AttrNames',
      ['Namespaced attr'],
    );

    expect(errorText).toBeNull();
    expect(
      pageErrors.filter((e) => e.includes('Unexpected closing')),
    ).toHaveLength(0);
    expect(bodyText).toContain('Namespaced attr');
  });

  it('IfInAttr: {if} inside attribute value renders without error', async () => {
    const { pageErrors, errorText, bodyText } = await openDialogAndCheck(
      'Open IfInAttr',
      ['Conditional class content'],
    );

    expect(errorText).toBeNull();
    expect(
      pageErrors.filter((e) => e.includes('Unexpected closing')),
    ).toHaveLength(0);
    expect(bodyText).toContain('Conditional class content');
  });
});
