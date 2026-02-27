/**
 * End-to-end Playwright tests for the compiled story.
 *
 * Requires dist/story.html to exist (run `bun run preview` first).
 * Starts a local HTTP server, runs tests via Playwright, then cleans up.
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

/** Click a visible passage link by its text */
async function clickLink(text: string) {
  await page.click(`a.passage-link:has-text("${text}")`);
}

beforeAll(async () => {
  if (!existsSync(storyPath)) {
    throw new Error('dist/story.html not found. Run `bun run preview` first.');
  }

  server = createServer((req, res) => {
    const filePath = resolve(
      distDir,
      (req.url || '/').slice(1) || 'index.html',
    );
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
    });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Server failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  browser = await chromium.launch();
  page = await browser.newPage();
}, 15000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function navigateFresh() {
  await page.goto(`${baseUrl}/story.html`);
  await page.waitForSelector('[data-passage]');
}

describe('compiled story e2e', () => {
  describe('StoryInit and start passage', () => {
    it('loads with correct title', async () => {
      await navigateFresh();
      expect(await page.title()).toBe('react-twine Test Story');
    });

    it('renders Start passage with StoryInit variables', async () => {
      await navigateFresh();
      const text = await page.textContent('.passage');
      expect(text).toContain('Adventurer');
      expect(text).toContain('100');
    });

    it('shows navigation links', async () => {
      await navigateFresh();
      const links = await page.$$eval('a.passage-link', (els) =>
        els.map((el) => el.textContent),
      );
      expect(links).toContain('Open the door');
      expect(links).toContain('Look around the room');
      expect(links).toContain('Test macros');
    });
  });

  describe('link navigation', () => {
    it('navigates to Hallway and increments room counter', async () => {
      await navigateFresh();
      await clickLink('Open the door');
      await page.waitForSelector('[data-passage="Hallway"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('hallway stretches');
      expect(text).toContain('Rooms visited:');
    });

    it('navigates back to Start', async () => {
      await navigateFresh();
      await clickLink('Open the door');
      await page.waitForSelector('[data-passage="Hallway"]');
      await clickLink('Go back to the room');
      await page.waitForSelector('[data-passage="Start"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('Adventurer');
    });
  });

  describe('variable reactivity', () => {
    it('decreases health in Dark Corridor', async () => {
      await navigateFresh();
      await clickLink('Open the door');
      await page.waitForSelector('[data-passage="Hallway"]');
      await clickLink('Go right into silence');
      await page.waitForSelector('[data-passage="Dark Corridor"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('Health:');
      expect(text).toContain('90');
    });

    it('shows correct conditional text based on health', async () => {
      await navigateFresh();
      await clickLink('Open the door');
      await page.waitForSelector('[data-passage="Hallway"]');
      await clickLink('Go right into silence');
      await page.waitForSelector('[data-passage="Dark Corridor"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('press on bravely');
    });
  });

  describe('conditional state (key/note)', () => {
    it('shows Take the key link when key not taken', async () => {
      await navigateFresh();
      await clickLink('Look around the room');
      await page.waitForSelector('[data-passage="Room"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('Take the key');
    });

    it('replaces link with text after taking key', async () => {
      await navigateFresh();
      await clickLink('Look around the room');
      await page.waitForSelector('[data-passage="Room"]');
      await clickLink('Take the key');
      await page.waitForSelector('[data-passage="Take Key"]');
      await clickLink('Go back');
      await page.waitForSelector('[data-passage="Room"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('already have the key');
    });

    it('tracks note state across passages', async () => {
      await navigateFresh();
      await clickLink('Look around the room');
      await page.waitForSelector('[data-passage="Room"]');
      await clickLink('Read the note');
      await page.waitForSelector('[data-passage="Note"]');
      expect(await page.textContent('.passage')).toContain(
        'music holds the answer',
      );
      await clickLink('Put the note down');
      await page.waitForSelector('[data-passage="Room"]');
      expect(await page.textContent('.passage')).toContain(
        'already read the note',
      );
    });
  });

  describe('Macro Demo passage', () => {
    async function goToMacroDemo() {
      await navigateFresh();
      await clickLink('Test macros');
      await page.waitForSelector('[data-passage="Macro Demo"]');
      return page.textContent('.passage');
    }

    it('displays variable value', async () => {
      expect(await goToMacroDemo()).toContain('Adventurer');
    });

    it('displays temporary variable', async () => {
      expect(await goToMacroDemo()).toContain('hello');
    });

    it('evaluates print expression', async () => {
      expect(await goToMacroDemo()).toContain('200'); // 100 * 2
    });

    it('renders conditional based on health', async () => {
      expect(await goToMacroDemo()).toContain('Full health!');
    });

    it('renders for-loop over inventory', async () => {
      const text = await goToMacroDemo();
      expect(text).toContain('rusty key');
      expect(text).toContain('torch');
    });

    it('executes do-block', async () => {
      expect(await goToMacroDemo()).toContain('do-block executed successfully');
    });

    it('renders all four link syntaxes', async () => {
      await goToMacroDemo();
      const links = await page.$$eval('a.passage-link', (els) =>
        els.map((el) => el.textContent),
      );
      expect(links).toContain('Back to start');
      expect(links).toContain('Arrow to hallway');
      expect(links).toContain('Visit the room');
    });

    it('renders CSS class on variable display', async () => {
      await goToMacroDemo();
      const span = await page.$('span.hero-name');
      expect(span).not.toBeNull();
      expect(await span!.textContent()).toBe('Adventurer');
    });

    it('renders CSS class on link', async () => {
      await goToMacroDemo();
      const link = await page.$('a.passage-link.fancy');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Back to start');
    });

    it('renders CSS class on button', async () => {
      await goToMacroDemo();
      const btn = await page.$('button.macro-button.danger');
      expect(btn).not.toBeNull();
    });

    it('renders multiple CSS classes on button', async () => {
      await goToMacroDemo();
      const btn = await page.$('button.macro-button.danger.large');
      expect(btn).not.toBeNull();
    });

    it('renders green class on health status at full health', async () => {
      await goToMacroDemo();
      const span = await page.$('span.green');
      expect(span).not.toBeNull();
      expect((await span!.textContent())!.trim()).toBe('Full health!');
    });

    it('renders red Drink Poison button', async () => {
      await goToMacroDemo();
      const btn = await page.$('button.macro-button.red');
      expect(btn).not.toBeNull();
      expect(await btn!.textContent()).toBe('Drink Poison');
    });

    it('renders green Drink Health potion button after taking damage', async () => {
      await goToMacroDemo();
      // Take damage to make health < 100 so heal button appears
      await page.click('button.macro-button.red');
      const btn = await page.$('button.macro-button.green');
      expect(btn).not.toBeNull();
      expect(await btn!.textContent()).toBe('Drink Health potion');
    });
  });

  describe('live reactivity', () => {
    it('button increments counter without page navigation', async () => {
      await navigateFresh();
      await clickLink('Test macros');
      await page.waitForSelector('[data-passage="Macro Demo"]');

      const getCount = async () => {
        const match = (await page.textContent('.passage'))!.match(
          /Count: (\d+)/,
        );
        return match ? parseInt(match[1]) : -1;
      };

      expect(await getCount()).toBe(0);
      const plusBtn = await page.$('button.macro-button:has-text("+1")');
      expect(plusBtn).not.toBeNull();

      for (let i = 0; i < 3; i++) {
        await page.click('button.macro-button:has-text("+1")');
      }
      expect(await getCount()).toBe(3);
    });

    it('replaces button with link at count 10', async () => {
      await navigateFresh();
      await clickLink('Test macros');
      await page.waitForSelector('[data-passage="Macro Demo"]');

      for (let i = 0; i < 10; i++) {
        await page.click('button.macro-button:has-text("+1")');
      }

      expect(await page.$('button.macro-button:has-text("+1")')).toBeNull();
      const link = await page.$('a.passage-link:has-text("You reached 10")');
      expect(link).not.toBeNull();
    });
  });

  describe('full playthrough to ending', () => {
    it('reaches the ending via Piano', async () => {
      await navigateFresh();
      await clickLink('Open the door');
      await page.waitForSelector('[data-passage="Hallway"]');
      await clickLink('Go left toward the music');
      await page.waitForSelector('[data-passage="Music Room"]');
      await clickLink('Sit at the piano');
      await page.waitForSelector('[data-passage="Piano"]');
      await clickLink('Step through the light');
      await page.waitForSelector('[data-passage="Ending"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('You are free, Adventurer');
      expect(text).toContain('THE END');
    });
  });
});
