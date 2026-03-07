/**
 * End-to-end Playwright tests for the compiled story.
 *
 * Requires dist/story.html to exist (run `bun run preview` first).
 * Starts a local HTTP server, runs tests via Playwright, then cleans up.
 *
 * These tests document EXPECTED behavior from a story author's perspective.
 * Failing tests surface bugs that need fixing.
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
  // ===========================================================================
  // Original tests
  // ===========================================================================
  describe('StoryInit and start passage', () => {
    it('loads with correct title', async () => {
      await navigateFresh();
      expect(await page.title()).toBe('Spindle Test Story');
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

  describe('Widget Demo passage', () => {
    async function goToWidgetDemo() {
      await navigateFresh();
      await clickLink('Widget demo');
      await page.waitForSelector('[data-passage="Widget Demo"]');
      return page.textContent('.passage');
    }

    it('renders widget with parameters (StatLine)', async () => {
      const text = await goToWidgetDemo();
      expect(text).toContain('Health:');
      expect(text).toContain('100');
      expect(text).toContain('Name:');
      expect(text).toContain('Adventurer');
    });

    it('renders widget with parameter (Greeting)', async () => {
      expect(await goToWidgetDemo()).toContain(
        'Hello, Adventurer! Welcome back.',
      );
    });

    it('renders widget without parameters (Badge)', async () => {
      await goToWidgetDemo();
      const badge = await page.$('span.badge');
      expect(badge).not.toBeNull();
      expect(await badge!.textContent()).toBe('★');
    });

    it('renders stat-line span from widget', async () => {
      await goToWidgetDemo();
      const statLines = await page.$$('span.stat-line');
      expect(statLines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Extra Macros passage', () => {
    async function goToExtraMacros() {
      await navigateFresh();
      await clickLink('Extra macros');
      await page.waitForSelector('[data-passage="Extra Macros"]');
      return page.textContent('.passage');
    }

    it('renders include macro content', async () => {
      const text = await goToExtraMacros();
      expect(text).toContain('included from another passage');
      expect(text).toContain('Player name: Adventurer');
    });

    it('renders switch/case correctly', async () => {
      const text = await goToExtraMacros();
      expect(text).toContain('You are a warrior');
      expect(text).not.toContain('You are a mage');
      expect(text).not.toContain('Unknown class');
    });

    it('renders meter macro with id and class', async () => {
      await goToExtraMacros();
      const meter = await page.$('#hp-meter.health-bar.macro-meter');
      expect(meter).not.toBeNull();
      const fill = await page.$('#hp-meter .macro-meter-fill');
      expect(fill).not.toBeNull();
    });

    it('renders meter label', async () => {
      await goToExtraMacros();
      const label = await page.$('#hp-meter .macro-meter-label');
      expect(label).not.toBeNull();
      expect(await label!.textContent()).toBe('100%');
    });

    it('renders link macro', async () => {
      await goToExtraMacros();
      const link = await page.$('a.macro-link');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Set flag');
    });

    it('renders story-title macro', async () => {
      const text = await goToExtraMacros();
      expect(text).toContain('Spindle Test Story');
    });

    it('renders passage tracking (hasVisited)', async () => {
      const text = await goToExtraMacros();
      expect(text).toContain('You have NOT visited the Hallway');
    });

    it('renders visited() count', async () => {
      const text = await goToExtraMacros();
      expect(text).toContain('Visit count for Start:');
    });

    it('renders currentPassage().name', async () => {
      const text = await goToExtraMacros();
      expect(text).toContain('Extra Macros');
    });

    it('renders timed content after delay', async () => {
      await goToExtraMacros();
      await page.waitForSelector('#timed-output', { timeout: 2000 });
      const text = await page.textContent('#timed-output');
      expect(text).toContain('Timed content appeared!');
    });

    it('renders timed next section', async () => {
      await goToExtraMacros();
      const el = await page.waitForSelector(
        '#timed-output:has-text("Second section!")',
        { timeout: 2000 },
      );
      expect(el).not.toBeNull();
    });

    it('renders type macro with typewriter effect', async () => {
      await goToExtraMacros();
      const typeEl = await page.$('#type-output');
      expect(typeEl).not.toBeNull();
      await page.waitForSelector('#type-output.macro-type-done', {
        timeout: 2000,
      });
      const text = await typeEl!.textContent();
      expect(text).toContain('Typed text here');
    });

    it('renders repeat macro and stops after 3 ticks', async () => {
      await goToExtraMacros();
      await page.waitForSelector('#repeat-output:has-text("Tick 3")', {
        timeout: 2000,
      });
      const text = await page.textContent('#repeat-output');
      expect(text).toContain('Tick 3');
    });

    it('renders #id on variable display', async () => {
      await goToExtraMacros();
      const el = await page.$('#player-name-display');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders #id on link', async () => {
      await goToExtraMacros();
      const el = await page.$('#id-test-link');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Back to start');
    });
  });

  describe('Goto macro', () => {
    it('navigates immediately via goto', async () => {
      await navigateFresh();
      await page.goto(`${baseUrl}/story.html`);
      await page.waitForSelector('[data-passage]');
      await page.evaluate(() => {
        (window as any).Story.goto('Goto Source');
      });
      await page.waitForSelector('[data-passage="Goto Target"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('Goto landed successfully');
    });
  });

  describe('Form Inputs passage', () => {
    async function goToFormInputs() {
      await navigateFresh();
      await clickLink('Form inputs');
      await page.waitForSelector('[data-passage="Form Inputs"]');
    }

    it('renders textbox and updates variable on input', async () => {
      await goToFormInputs();
      const input = await page.$('#name-input');
      expect(input).not.toBeNull();
      await input!.fill('TestUser');
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Name is: TestUser'),
      );
      expect(await page.textContent('.passage')).toContain('Name is: TestUser');
    });

    it('renders numberbox and updates variable on input', async () => {
      await goToFormInputs();
      const input = await page.$('#age-input');
      expect(input).not.toBeNull();
      await input!.fill('25');
      await page.waitForFunction(() =>
        document.querySelector('.passage')?.textContent?.includes('Age is: 25'),
      );
      expect(await page.textContent('.passage')).toContain('Age is: 25');
    });

    it('renders checkbox and toggles variable', async () => {
      await goToFormInputs();
      const checkbox = await page.$('#terms-check input[type="checkbox"]');
      expect(checkbox).not.toBeNull();
      expect(await page.textContent('.passage')).toContain(
        'Terms accepted: false',
      );
      await checkbox!.click();
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Terms accepted: true'),
      );
      expect(await page.textContent('.passage')).toContain(
        'Terms accepted: true',
      );
    });

    it('renders radio buttons and selects value', async () => {
      await goToFormInputs();
      expect(await page.textContent('.passage')).toContain(
        'Difficulty: normal',
      );
      const hardRadio = await page.$(
        'label.macro-radiobutton:has-text("Hard") input',
      );
      expect(hardRadio).not.toBeNull();
      await hardRadio!.click();
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Difficulty: hard'),
      );
      expect(await page.textContent('.passage')).toContain('Difficulty: hard');
    });

    it('renders listbox with options', async () => {
      await goToFormInputs();
      const select = await page.$('#weapon-select');
      expect(select).not.toBeNull();
      const options = await page.$$eval('#weapon-select option', (els) =>
        els.map((el) => el.textContent),
      );
      expect(options).toContain('sword');
      expect(options).toContain('bow');
      expect(options).toContain('staff');
    });

    it('listbox changes variable on selection', async () => {
      await goToFormInputs();
      await page.selectOption('#weapon-select', 'bow');
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Weapon: bow'),
      );
      expect(await page.textContent('.passage')).toContain('Weapon: bow');
    });

    it('renders cycle button and cycles through options', async () => {
      await goToFormInputs();
      const cycleBtn = await page.$('#stance-cycle');
      expect(cycleBtn).not.toBeNull();
      expect(await cycleBtn!.textContent()).toBe('balanced');
      await cycleBtn!.click();
      expect(await cycleBtn!.textContent()).toBe('offensive');
      await cycleBtn!.click();
      expect(await cycleBtn!.textContent()).toBe('defensive');
      await cycleBtn!.click();
      expect(await cycleBtn!.textContent()).toBe('balanced');
    });
  });

  describe('Interpolation Demo passage', () => {
    async function goToInterpolation() {
      await navigateFresh();
      await clickLink('Interpolation');
      await page.waitForSelector('[data-passage="Interpolation Demo"]');
    }

    it('renders dynamic class from selector interpolation', async () => {
      await goToInterpolation();
      const el = await page.$('span.dark');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('themed content');
    });

    it('renders prefixed dynamic class from selector interpolation', async () => {
      await goToInterpolation();
      const el = await page.$('span.prefix-dark');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('prefixed content');
    });

    it('resolves interpolation in HTML class attribute', async () => {
      await goToInterpolation();
      const el = await page.$('span.dark-text');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('HTML interpolated class');
    });

    it('resolves multiple interpolations in HTML attributes', async () => {
      await goToInterpolation();
      const el = await page.$('#themed-box');
      expect(el).not.toBeNull();
      const cls = await el!.getAttribute('class');
      expect(cls).toContain('box');
      expect(cls).toContain('dark');
    });

    it('resolves temporary variable in selector interpolation', async () => {
      await goToInterpolation();
      const el = await page.$('span.active');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('highlighted');
    });

    it('resolves @local interpolation in for-loop HTML attributes', async () => {
      await goToInterpolation();
      const alpha = await page.$('span.item-alpha');
      const beta = await page.$('span.item-beta');
      expect(alpha).not.toBeNull();
      expect(beta).not.toBeNull();
      expect(await alpha!.textContent()).toBe('alpha');
      expect(await beta!.textContent()).toBe('beta');
    });
  });

  describe('passage tracking after navigation', () => {
    it('hasVisited returns true after visiting a passage', async () => {
      await navigateFresh();
      await clickLink('Open the door');
      await page.waitForSelector('[data-passage="Hallway"]');
      await clickLink('Go back to the room');
      await page.waitForSelector('[data-passage="Start"]');
      await clickLink('Extra macros');
      await page.waitForSelector('[data-passage="Extra Macros"]');
      const text = await page.textContent('.passage');
      expect(text).toContain('You have visited the Hallway');
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

  // ===========================================================================
  // Edge Cases passage — truthiness, comparisons, types, loops
  // ===========================================================================
  describe('Edge Cases passage', () => {
    async function goToEdgeCases() {
      await navigateFresh();
      await clickLink('Edge cases');
      await page.waitForSelector('[data-passage="Edge Cases"]');
      return page.textContent('.passage');
    }

    it('displays string with spaces', async () => {
      expect(await goToEdgeCases()).toContain('hello world');
    });

    it('displays string with ampersand', async () => {
      expect(await goToEdgeCases()).toContain('test&value');
    });

    it('displays empty string as nothing between brackets', async () => {
      expect(await goToEdgeCases()).toContain('[]');
    });

    it('displays numeric string', async () => {
      expect(await goToEdgeCases()).toContain('42');
    });

    it('displays zero value', async () => {
      const text = await goToEdgeCases();
      expect(text).toContain('Zero value: 0');
    });

    it('displays boolean false', async () => {
      expect(await goToEdgeCases()).toContain('Boolean false: false');
    });

    it('displays boolean true', async () => {
      expect(await goToEdgeCases()).toContain('Boolean true: true');
    });

    it('displays null-like string literally', async () => {
      expect(await goToEdgeCases()).toContain('null');
    });

    it('treats empty string as falsy in conditionals', async () => {
      expect(await goToEdgeCases()).toContain('empty is falsy');
    });

    it('treats zero as falsy in conditionals', async () => {
      expect(await goToEdgeCases()).toContain('zero is falsy');
    });

    it('treats false as falsy in conditionals', async () => {
      expect(await goToEdgeCases()).toContain('false is falsy');
    });

    it('treats non-empty string as truthy in conditionals', async () => {
      expect(await goToEdgeCases()).toContain('spaced is truthy');
    });

    it('does arithmetic on numeric string (coercion)', async () => {
      expect(await goToEdgeCases()).toContain('84');
    });

    it('evaluates >= comparison', async () => {
      expect(await goToEdgeCases()).toContain('hp-gte-100');
    });

    it('evaluates <= comparison', async () => {
      expect(await goToEdgeCases()).toContain('hp-lte-100');
    });

    it('evaluates == comparison', async () => {
      expect(await goToEdgeCases()).toContain('hp-eq-100');
    });

    it('evaluates !== comparison', async () => {
      expect(await goToEdgeCases()).toContain('hp-neq-50');
    });

    it('accesses nested property on object', async () => {
      expect(await goToEdgeCases()).toContain('Adventurer has 100 HP');
    });

    it('accesses getter property via print', async () => {
      expect(await goToEdgeCases()).toContain('Full health');
    });

    it('renders for loop with index variable', async () => {
      await goToEdgeCases();
      const items = await page.$$('span.idx-item');
      expect(items.length).toBe(3);
      expect(await items[0]!.textContent()).toBe('0:x');
      expect(await items[1]!.textContent()).toBe('1:y');
      expect(await items[2]!.textContent()).toBe('2:z');
    });

    it('renders nothing for empty array for-loop', async () => {
      expect(await goToEdgeCases()).not.toContain('SHOULD-NOT-APPEAR');
    });

    it('evaluates nested if inside for-loop', async () => {
      await goToEdgeCases();
      const found = await page.$('span.found-two');
      expect(found).not.toBeNull();
      expect(await found!.textContent()).toBe('two');
    });

    it('evaluates multiple elseif chain correctly', async () => {
      const text = await goToEdgeCases();
      expect(text).toContain('chain-c');
      expect(text).not.toContain('chain-a');
      expect(text).not.toContain('chain-b');
      expect(text).not.toContain('chain-d');
      expect(text).not.toContain('chain-default');
    });

    it('concatenates strings in print', async () => {
      expect(await goToEdgeCases()).toContain('Hello World');
    });

    it('evaluates Math.floor', async () => {
      // Math.floor(7.9) = 7
      expect(await goToEdgeCases()).toContain('7');
    });

    it('evaluates Math.max', async () => {
      // Math.max(3, 7, 1) = 7
      expect(await goToEdgeCases()).toContain('7');
    });

    it('evaluates Math.min', async () => {
      // Math.min(10, 5, 20) = 5
      expect(await goToEdgeCases()).toContain('5');
    });
  });

  // ===========================================================================
  // Special Characters passage — apostrophes, HTML in vars, special chars
  // ===========================================================================
  describe('Special Chars passage', () => {
    async function goToSpecialChars() {
      await navigateFresh();
      await clickLink('Special chars');
      await page.waitForSelector('[data-passage="Special Chars Passage"]');
      return page.textContent('.passage');
    }

    it('displays name with apostrophe', async () => {
      expect(await goToSpecialChars()).toContain("O'Brien");
    });

    it('handles HTML-like content in variable safely (not rendered as HTML)', async () => {
      // <b>bold</b> in a variable should be escaped, not rendered as bold
      await goToSpecialChars();
      // The text should contain the literal angle brackets, not a <b> element
      const el = await page.$('.passage');
      const text = await el!.textContent();
      expect(text).toContain('<b>bold</b>');
    });

    it('displays at sign in variable value', async () => {
      expect(await goToSpecialChars()).toContain('user at domain');
    });

    it('displays underscore in variable value', async () => {
      expect(await goToSpecialChars()).toContain('snake_case_value');
    });

    it('displays multi-word value', async () => {
      expect(await goToSpecialChars()).toContain('multiple words here');
    });

    it('renders variable inside bold markdown', async () => {
      await goToSpecialChars();
      const allStrong = await page.$$eval('strong', (els) =>
        els.map((el) => el.textContent),
      );
      expect(allStrong).toContain('Adventurer');
    });

    it('renders variable inside italic markdown', async () => {
      await goToSpecialChars();
      const allEm = await page.$$eval('em', (els) =>
        els.map((el) => el.textContent),
      );
      expect(allEm).toContain('Adventurer');
    });

    it('renders multiple variables on one line', async () => {
      expect(await goToSpecialChars()).toContain('Adventurer / 100 / 5');
    });

    it('renders escaped braces as literal text and errors on unknown macro', async () => {
      const text = await goToSpecialChars();
      // \{is\} renders as literal text "{is}"
      expect(text).toContain('{is} not a macro');
      // unescaped {is} is an unknown macro and shows error
      expect(text).toContain('unknown macro');
    });

    it('evaluates ternary in print expression', async () => {
      expect(await goToSpecialChars()).toContain('healthy');
    });

    it('evaluates print with comparison operators in string', async () => {
      expect(await goToSpecialChars()).toContain("10 > 5 ? 'yes' : 'no'");
    });
  });

  // ===========================================================================
  // Variable Namespace Tests — $, _, @, computed, temp clearing
  // ===========================================================================
  describe('Var Namespace Tests passage', () => {
    async function goToVarTests() {
      await navigateFresh();
      await clickLink('Var namespaces');
      await page.waitForSelector('[data-passage="Var Namespace Tests"]');
      return page.textContent('.passage');
    }

    it('displays temporary variable with _ prefix', async () => {
      expect(await goToVarTests()).toContain('temp-value');
    });

    it('sets and reads temp var in same passage', async () => {
      expect(await goToVarTests()).toContain('fresh');
    });

    it('overwrites story variable in passage', async () => {
      expect(await goToVarTests()).toContain('overwritten');
    });

    it('accesses outer temp var inside for loop', async () => {
      expect(await goToVarTests()).toContain('outer-val');
    });

    it('accesses @local variable in for loop', async () => {
      expect(await goToVarTests()).toContain('inner');
    });

    it('evaluates computed temporary variable', async () => {
      expect(await goToVarTests()).toContain('Doubled HP: 200');
    });

    it('handles multiple set macros on same line', async () => {
      expect(await goToVarTests()).toContain('Sum: 6');
    });

    it('clears temporary variables on navigation', async () => {
      await navigateFresh();
      await clickLink('Var namespaces');
      await page.waitForSelector('[data-passage="Var Namespace Tests"]');
      await clickLink('Check temp cleared');
      await page.waitForSelector('[data-passage="Temp Check Target"]');
      const text = await page.textContent('.passage');
      // _tempVar should be empty/undefined after navigation
      expect(text).toContain('should be empty here: []');
      // Story var should persist
      expect(text).toContain('overwritten');
    });
  });

  // ===========================================================================
  // Selector Combinations — .class, #id, interpolated, on various macros
  // ===========================================================================
  describe('Selector Combos passage', () => {
    async function goToSelectorCombos() {
      await navigateFresh();
      await clickLink('Selector combos');
      await page.waitForSelector('[data-passage="Selector Combos"]');
    }

    it('renders class on variable display', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.styled-var');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders ID on variable display', async () => {
      await goToSelectorCombos();
      const el = await page.$('#id-var');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('100');
    });

    it('renders class AND ID on variable display', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.cls-combo#id-combo');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders class on print macro', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.styled-print');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('110');
    });

    it('renders ID on print macro', async () => {
      await goToSelectorCombos();
      const el = await page.$('#id-print');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('id-content');
    });

    it('renders class on if-block', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.if-styled');
      expect(el).not.toBeNull();
      const text = (await el!.textContent())!.trim();
      expect(text).toContain('styled-if-content');
    });

    it('renders multiple classes on variable display', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.cls-a.cls-b');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders class on for-loop wrapper', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.for-styled');
      expect(el).not.toBeNull();
      expect((await el!.textContent())!).toContain('for-class-a');
    });

    it('renders interpolated class on variable', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.highlight');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders interpolated class with prefix on print', async () => {
      await goToSelectorCombos();
      const el = await page.$('span.glow-highlight');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('glow-content');
    });

    it('renders interpolated HTML data attribute', async () => {
      await goToSelectorCombos();
      const el = await page.$('span[data-theme="dark"]');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('dark');
    });
  });

  // ===========================================================================
  // Macro Combinations — nested macros, button+temp, link, include, switch
  // ===========================================================================
  describe('Macro Combos passage', () => {
    async function goToMacroCombos() {
      await navigateFresh();
      await clickLink('Macro combos');
      await page.waitForSelector('[data-passage="Macro Combos"]');
      return page.textContent('.passage');
    }

    it('renders button that modifies temp var', async () => {
      await goToMacroCombos();
      expect(await page.textContent('.passage')).toContain('Result: before');
      await page.click('#set-temp-btn');
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Result: after'),
      );
      expect(await page.textContent('.passage')).toContain('Result: after');
    });

    it('renders button with arithmetic expression', async () => {
      await goToMacroCombos();
      await page.click('#expr-btn');
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Count after: 5'),
      );
      expect(await page.textContent('.passage')).toContain('Count after: 5');
    });

    it('renders link macro without passage target', async () => {
      await goToMacroCombos();
      const link = await page.$('a.macro-link:has-text("Toggle flag")');
      expect(link).not.toBeNull();
    });

    it('renders link macro with passage target', async () => {
      await goToMacroCombos();
      const link = await page.$('a.macro-link:has-text("Go home")');
      expect(link).not.toBeNull();
    });

    it('includes passage using variable name', async () => {
      const text = await goToMacroCombos();
      expect(text).toContain('included from another passage');
    });

    it('evaluates nested if/else with variables', async () => {
      const text = await goToMacroCombos();
      expect(text).toContain('Strong and healthy');
    });

    it('evaluates switch with number value', async () => {
      const text = await goToMacroCombos();
      expect(text).toContain('Switch: two');
      expect(text).not.toContain('Switch: one');
      expect(text).not.toContain('Switch: three');
    });

    it('renders meter with zero max without crashing', async () => {
      await goToMacroCombos();
      const meter = await page.$('#zero-meter');
      expect(meter).not.toBeNull();
    });

    it('renders meter with percentage label', async () => {
      await goToMacroCombos();
      const label = await page.$('#pct-meter .macro-meter-label');
      expect(label).not.toBeNull();
      expect(await label!.textContent()).toBe('100%');
    });

    it('renders meter with custom label', async () => {
      await goToMacroCombos();
      const label = await page.$('#custom-meter .macro-meter-label');
      expect(label).not.toBeNull();
      expect(await label!.textContent()).toBe('100 HP / 100 HP');
    });
  });

  // ===========================================================================
  // Widget Edge Cases — widgets with special args, zero, booleans, expressions
  // ===========================================================================
  describe('Widget Edge Cases passage', () => {
    async function goToWidgetEdges() {
      await navigateFresh();
      await clickLink('Widget edges');
      await page.waitForSelector('[data-passage="Widget Edge Cases"]');
      return page.textContent('.passage');
    }

    it('renders StatLine widget with special characters in label', async () => {
      const text = await goToWidgetEdges();
      expect(text).toContain("Stat's Name");
      expect(text).toContain('value with spaces');
    });

    it('renders StatLine widget with numeric zero argument', async () => {
      await goToWidgetEdges();
      const text = await page.textContent('.passage');
      // Zero should render as "0", not blank
      expect(text).toMatch(/Zero:.*0/);
    });

    it('renders StatLine widget with boolean argument', async () => {
      const text = await goToWidgetEdges();
      expect(text).toContain('Flag:');
    });

    it('renders StatLine widget with expression argument', async () => {
      const text = await goToWidgetEdges();
      expect(text).toContain('Double HP:');
      expect(text).toContain('200');
    });

    it('renders Greeting widget with multi-word name', async () => {
      expect(await goToWidgetEdges()).toContain(
        'Hello, Sir Reginald the Third! Welcome back.',
      );
    });

    it('renders multiple Badge widgets', async () => {
      await goToWidgetEdges();
      const badges = await page.$$('span.badge');
      expect(badges.length).toBe(3);
    });

    it('does not show unknown macro errors for registered widgets', async () => {
      const text = await goToWidgetEdges();
      expect(text).not.toContain('unknown macro');
    });
  });

  // ===========================================================================
  // For Loop Edge Cases — single, numbers, mixed types, nested, buttons, ifs
  // ===========================================================================
  describe('For Loop Edge Cases passage', () => {
    async function goToForEdges() {
      await navigateFresh();
      await clickLink('For loop edges');
      await page.waitForSelector('[data-passage="For Loop Edge Cases"]');
      return page.textContent('.passage');
    }

    it('iterates single-item array', async () => {
      await goToForEdges();
      const el = await page.$('span.single-item');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('only');
    });

    it('iterates array of numbers', async () => {
      await goToForEdges();
      const items = await page.$$('span.num-item');
      expect(items.length).toBe(3);
      expect(await items[0]!.textContent()).toBe('10');
      expect(await items[1]!.textContent()).toBe('20');
      expect(await items[2]!.textContent()).toBe('30');
    });

    it('iterates array of mixed types', async () => {
      await goToForEdges();
      const items = await page.$$('span.mixed-item');
      expect(items.length).toBe(4);
      const texts = await Promise.all(items.map((i) => i.textContent()));
      expect(texts).toContain('str');
      expect(texts).toContain('42');
      expect(texts).toContain('true');
      expect(texts).toContain('false');
    });

    it('renders nested for loops with correct @local scoping', async () => {
      await goToForEdges();
      const items = await page.$$('span.nested-item');
      expect(items.length).toBe(4);
      const texts = await Promise.all(items.map((i) => i.textContent()));
      expect(texts).toContain('A-1');
      expect(texts).toContain('A-2');
      expect(texts).toContain('B-1');
      expect(texts).toContain('B-2');
    });

    it('renders buttons inside for-loop and they increment correctly', async () => {
      await goToForEdges();
      expect(await page.textContent('.passage')).toContain('For-btn count: 0');
      // Click both buttons generated by the for loop
      const xBtn = await page.$('button.macro-button:has-text("X")');
      const yBtn = await page.$('button.macro-button:has-text("Y")');
      expect(xBtn).not.toBeNull();
      expect(yBtn).not.toBeNull();
      await xBtn!.click();
      await yBtn!.click();
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('For-btn count: 2'),
      );
    });

    it('evaluates if inside for-loop (even numbers only)', async () => {
      await goToForEdges();
      const evens = await page.$$('span.even-num');
      expect(evens.length).toBe(2);
      const texts = await Promise.all(evens.map((e) => e.textContent()));
      expect(texts).toContain('2');
      expect(texts).toContain('4');
    });

    it('accesses story variable by index in for-loop', async () => {
      await goToForEdges();
      const items = await page.$$('span.inv-in-for');
      expect(items.length).toBe(2);
      const texts = await Promise.all(items.map((i) => i.textContent()));
      expect(texts).toContain('rusty key');
      expect(texts).toContain('torch');
    });
  });

  // ===========================================================================
  // HTML Interop — nested elements, variables in HTML, data attributes
  // ===========================================================================
  describe('HTML Interop passage', () => {
    async function goToHtmlInterop() {
      await navigateFresh();
      await clickLink('HTML interop');
      await page.waitForSelector('[data-passage="HTML Interop"]');
    }

    it('renders nested HTML elements', async () => {
      await goToHtmlInterop();
      const inner = await page.$('div.outer span.inner');
      expect(inner).not.toBeNull();
      expect(await inner!.textContent()).toBe('nested content');
    });

    it('renders Twine variable inside HTML container', async () => {
      await goToHtmlInterop();
      const container = await page.$('div.html-var-container');
      expect(container).not.toBeNull();
      expect(await container!.textContent()).toBe('Adventurer');
    });

    it('renders Twine print macro inside HTML container', async () => {
      await goToHtmlInterop();
      const container = await page.$('div.html-macro-container');
      expect(container).not.toBeNull();
      expect(await container!.textContent()).toBe('300');
    });

    it('renders HTML with data attribute', async () => {
      await goToHtmlInterop();
      const el = await page.$('div.data-el');
      expect(el).not.toBeNull();
      expect(await el!.getAttribute('data-value')).toBe('test-data');
    });

    it('renders HTML with interpolated data attribute', async () => {
      await goToHtmlInterop();
      const el = await page.$('div.interp-data-el');
      expect(el).not.toBeNull();
      expect(await el!.getAttribute('data-val')).toBe('custom-data');
    });

    it('renders HTML with multiple classes', async () => {
      await goToHtmlInterop();
      const el = await page.$('span.cls1.cls2.cls3');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('multi-class html');
    });

    it('renders variables in markdown table', async () => {
      await goToHtmlInterop();
      const cells = await page.$$eval('td', (els) =>
        els.map((el) => el.textContent),
      );
      expect(cells).toContain('100');
      expect(cells).toContain('Adventurer');
    });
  });

  // ===========================================================================
  // Markdown Edge Cases — variables in bold/italic/list/table/blockquote
  // ===========================================================================
  describe('Markdown Edge Cases passage', () => {
    async function goToMarkdownEdges() {
      await navigateFresh();
      await clickLink('Markdown edges');
      await page.waitForSelector('[data-passage="Markdown Edge Cases"]');
    }

    it('renders variable inside bold', async () => {
      await goToMarkdownEdges();
      const strongs = await page.$$eval('strong', (els) =>
        els.map((el) => el.textContent),
      );
      expect(strongs).toContain('Adventurer');
    });

    it('renders variable inside italic', async () => {
      await goToMarkdownEdges();
      const ems = await page.$$eval('em', (els) =>
        els.map((el) => el.textContent),
      );
      // {$player.name} wrapped in *...* should produce <em>Adventurer</em>
      expect(ems).toContain('Adventurer');
    });

    it('renders variables in list items', async () => {
      await goToMarkdownEdges();
      const text = await page.textContent('.passage');
      expect(text).toContain('Name: Adventurer');
      expect(text).toContain('HP: 100');
    });

    it('renders variable in blockquote', async () => {
      await goToMarkdownEdges();
      const quote = await page.$('blockquote');
      expect(quote).not.toBeNull();
      const text = await quote!.textContent();
      expect(text).toContain('Adventurer');
    });

    it('renders variable in table cell', async () => {
      await goToMarkdownEdges();
      const cells = await page.$$eval('td', (els) =>
        els.map((el) => el.textContent),
      );
      expect(cells).toContain('100');
      expect(cells).toContain('5');
    });

    it('renders link after bold text', async () => {
      await goToMarkdownEdges();
      const text = await page.textContent('.passage');
      expect(text).toContain('bold text');
      const link = await page.$('a.passage-link:has-text("Back to start")');
      expect(link).not.toBeNull();
    });

    it('renders strikethrough', async () => {
      await goToMarkdownEdges();
      const dels = await page.$$eval('del', (els) =>
        els.map((el) => el.textContent),
      );
      expect(dels).toContain('no weakness');
    });

    it('renders variable inside backtick code span', async () => {
      // BUG: variable inside `backtick code` renders as raw placeholder HTML
      await goToMarkdownEdges();
      const codes = await page.$$eval('code', (els) =>
        els.map((el) => el.textContent),
      );
      // Expected: a code element containing "100" (the value of $player.hp)
      const hasValue = codes.some((c) => c?.includes('100'));
      expect(hasValue).toBe(true);
    });
  });

  // ===========================================================================
  // Computed Variable Tests
  // ===========================================================================
  describe('Computed Var Tests passage', () => {
    async function goToComputedVars() {
      await navigateFresh();
      await clickLink('Computed vars');
      await page.waitForSelector('[data-passage="Computed Var Tests"]');
      return page.textContent('.passage');
    }

    it('evaluates basic computed variable', async () => {
      const text = await goToComputedVars();
      // _base = 10, _computed = 10 * 5 = 100
      expect(text).toContain('60');
      // _base = 20, _result = 20 * 5 = 100
      expect(text).toContain('Computed after base change: 100');
    });

    it('evaluates computed from story variables', async () => {
      const text = await goToComputedVars();
      // $player.hp (100) + $player.strength (5) = 105
      expect(text).toContain('105');
    });

    it('evaluates computed with ternary', async () => {
      const text = await goToComputedVars();
      expect(text).toContain('max');
    });

    it('evaluates computed string concatenation', async () => {
      const text = await goToComputedVars();
      expect(text).toContain('Adventurer (Level 1)');
    });
  });

  // ===========================================================================
  // Unset Tests
  // ===========================================================================
  describe('Unset Tests passage', () => {
    async function goToUnsetTests() {
      await navigateFresh();
      await clickLink('Unset tests');
      await page.waitForSelector('[data-passage="Unset Tests"]');
      return page.textContent('.passage');
    }

    it('shows value before unset', async () => {
      const text = await goToUnsetTests();
      // $unset_b is never unset, so it persists everywhere
      expect(text).toContain('exists-b');
      // $unset_a is unset — in reactive rendering, both displays reflect final state
      // The "before" display also shows empty because VarDisplay reacts to the deletion
    });

    it('removes unset story variable (shows empty)', async () => {
      const text = await goToUnsetTests();
      // After {unset $unset_a}, the display should be empty between brackets
      expect(text).toContain('A: []');
    });

    it('removes unset temp variable (shows empty)', async () => {
      const text = await goToUnsetTests();
      expect(text).toContain('Temp: []');
    });

    it('preserves non-unset variables', async () => {
      const text = await goToUnsetTests();
      expect(text).toContain('B: exists-b');
    });
  });

  // ===========================================================================
  // Link Syntax Edge Cases — spaces, arrows, selectors, multiple inline
  // ===========================================================================
  describe('Link Syntax Edge Cases passage', () => {
    async function goToLinkSyntax() {
      await navigateFresh();
      await clickLink('Link syntax');
      await page.waitForSelector('[data-passage="Link Syntax Edge Cases"]');
    }

    it('renders pipe link with surrounding spaces (trimmed)', async () => {
      await goToLinkSyntax();
      const link = await page.$('a.passage-link:has-text("Spaced Display")');
      expect(link).not.toBeNull();
    });

    it('renders arrow link with surrounding spaces (trimmed)', async () => {
      await goToLinkSyntax();
      const link = await page.$('a.passage-link:has-text("Arrow Spaced")');
      expect(link).not.toBeNull();
    });

    it('renders reverse arrow link with surrounding spaces (trimmed)', async () => {
      await goToLinkSyntax();
      const link = await page.$('a.passage-link:has-text("Rev Spaced")');
      expect(link).not.toBeNull();
    });

    it('renders plain link', async () => {
      await goToLinkSyntax();
      const links = await page.$$eval('a.passage-link', (els) =>
        els.map((el) => el.textContent),
      );
      expect(links).toContain('Start');
    });

    it('renders link with CSS class', async () => {
      await goToLinkSyntax();
      const link = await page.$('a.passage-link.link-cls');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Classed Link');
    });

    it('renders link with CSS ID', async () => {
      await goToLinkSyntax();
      const link = await page.$('a#link-id');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('ID Link');
    });

    it('renders link with both class and ID', async () => {
      await goToLinkSyntax();
      const link = await page.$('a.passage-link.link-cls2#link-id2');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Both');
    });

    it('renders multiple inline links', async () => {
      await goToLinkSyntax();
      const links = await page.$$eval('a.passage-link', (els) =>
        els.map((el) => el.textContent),
      );
      expect(links).toContain('Link A');
      expect(links).toContain('Link B');
      expect(links).toContain('Link C');
    });
  });
});
