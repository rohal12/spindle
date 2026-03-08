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
    beforeAll(async () => {
      await navigateFresh();
    });

    it('loads with correct title', async () => {
      expect(await page.title()).toBe('Spindle Test Story');
    });

    it('renders Start passage with StoryInit variables', async () => {
      const text = await page.textContent('.passage');
      expect(text).toContain('Adventurer');
      expect(text).toContain('100');
    });

    it('shows navigation links', async () => {
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
    // Read-only tests share a single navigation
    describe('read-only checks', () => {
      let text: string | null;
      beforeAll(async () => {
        await navigateFresh();
        await clickLink('Test macros');
        await page.waitForSelector('[data-passage="Macro Demo"]');
        text = await page.textContent('.passage');
      });

      it('displays variable value', () => {
        expect(text).toContain('Adventurer');
      });

      it('displays temporary variable', () => {
        expect(text).toContain('hello');
      });

      it('evaluates print expression', () => {
        expect(text).toContain('200'); // 100 * 2
      });

      it('renders conditional based on health', () => {
        expect(text).toContain('Full health!');
      });

      it('renders for-loop over inventory', () => {
        expect(text).toContain('rusty key');
        expect(text).toContain('torch');
      });

      it('executes do-block', () => {
        expect(text).toContain('do-block executed successfully');
      });

      it('renders all four link syntaxes', async () => {
        const links = await page.$$eval('a.passage-link', (els) =>
          els.map((el) => el.textContent),
        );
        expect(links).toContain('Back to start');
        expect(links).toContain('Arrow to hallway');
        expect(links).toContain('Visit the room');
      });

      it('renders CSS class on variable display', async () => {
        const span = await page.$('span.hero-name');
        expect(span).not.toBeNull();
        expect(await span!.textContent()).toBe('Adventurer');
      });

      it('renders CSS class on link', async () => {
        const link = await page.$('a.passage-link.fancy');
        expect(link).not.toBeNull();
        expect(await link!.textContent()).toBe('Back to start');
      });

      it('renders CSS class on button', async () => {
        const btn = await page.$('button.macro-button.danger');
        expect(btn).not.toBeNull();
      });

      it('renders multiple CSS classes on button', async () => {
        const btn = await page.$('button.macro-button.danger.large');
        expect(btn).not.toBeNull();
      });

      it('renders green class on health status at full health', async () => {
        const span = await page.$('span.green');
        expect(span).not.toBeNull();
        expect((await span!.textContent())!.trim()).toBe('Full health!');
      });

      it('renders red Drink Poison button', async () => {
        const btn = await page.$('button.macro-button.red');
        expect(btn).not.toBeNull();
        expect(await btn!.textContent()).toBe('Drink Poison');
      });
    });

    // This test clicks a button — needs its own navigation
    it('renders green Drink Health potion button after taking damage', async () => {
      await navigateFresh();
      await clickLink('Test macros');
      await page.waitForSelector('[data-passage="Macro Demo"]');
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
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Widget demo');
      await page.waitForSelector('[data-passage="Widget Demo"]');
      text = await page.textContent('.passage');
    });

    it('renders widget with parameters (StatLine)', () => {
      expect(text).toContain('Health:');
      expect(text).toContain('100');
      expect(text).toContain('Name:');
      expect(text).toContain('Adventurer');
    });

    it('renders widget with parameter (Greeting)', () => {
      expect(text).toContain('Hello, Adventurer! Welcome back.');
    });

    it('renders widget without parameters (Badge)', async () => {
      const badge = await page.$('span.badge');
      expect(badge).not.toBeNull();
      expect(await badge!.textContent()).toBe('★');
    });

    it('renders stat-line span from widget', async () => {
      const statLines = await page.$$('span.stat-line');
      expect(statLines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Extra Macros passage', () => {
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Extra macros');
      await page.waitForSelector('[data-passage="Extra Macros"]');
      text = await page.textContent('.passage');
    });

    it('renders include macro content', () => {
      expect(text).toContain('included from another passage');
      expect(text).toContain('Player name: Adventurer');
    });

    it('renders switch/case correctly', () => {
      expect(text).toContain('You are a warrior');
      expect(text).not.toContain('You are a mage');
      expect(text).not.toContain('Unknown class');
    });

    it('renders meter macro with id and class', async () => {
      const meter = await page.$('#hp-meter.health-bar.macro-meter');
      expect(meter).not.toBeNull();
      const fill = await page.$('#hp-meter .macro-meter-fill');
      expect(fill).not.toBeNull();
    });

    it('renders meter label', async () => {
      const label = await page.$('#hp-meter .macro-meter-label');
      expect(label).not.toBeNull();
      expect(await label!.textContent()).toBe('100%');
    });

    it('renders link macro', async () => {
      const link = await page.$('a.macro-link');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Set flag');
    });

    it('renders story-title macro', () => {
      expect(text).toContain('Spindle Test Story');
    });

    it('renders passage tracking (hasVisited)', () => {
      expect(text).toContain('You have NOT visited the Hallway');
    });

    it('renders visited() count', () => {
      expect(text).toContain('Visit count for Start:');
    });

    it('renders currentPassage().name', () => {
      expect(text).toContain('Extra Macros');
    });

    it('renders timed content after delay', async () => {
      await page.waitForSelector('#timed-output', { timeout: 2000 });
      const timedText = await page.textContent('#timed-output');
      expect(timedText).toContain('Timed content appeared!');
    });

    it('renders timed next section', async () => {
      await page.waitForFunction(
        () => document.body.textContent?.includes('Second section!'),
        { timeout: 2000 },
      );
    });

    it('renders type macro with typewriter effect', async () => {
      const typeEl = await page.$('#type-output');
      expect(typeEl).not.toBeNull();
      await page.waitForSelector('#type-output.macro-type-done', {
        timeout: 2000,
      });
      const typeText = await typeEl!.textContent();
      expect(typeText).toContain('Typed text here');
    });

    it('renders repeat macro and stops after 3 ticks', async () => {
      await page.waitForSelector('#repeat-output:has-text("Tick 3")', {
        timeout: 2000,
      });
      const repeatText = await page.textContent('#repeat-output');
      expect(repeatText).toContain('Tick 3');
    });

    it('renders #id on variable display', async () => {
      const el = await page.$('#player-name-display');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders #id on link', async () => {
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
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Interpolation');
      await page.waitForSelector('[data-passage="Interpolation Demo"]');
    });

    it('renders dynamic class from selector interpolation', async () => {
      const el = await page.$('span.dark');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('themed content');
    });

    it('renders prefixed dynamic class from selector interpolation', async () => {
      const el = await page.$('span.prefix-dark');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('prefixed content');
    });

    it('resolves interpolation in HTML class attribute', async () => {
      const el = await page.$('span.dark-text');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('HTML interpolated class');
    });

    it('resolves multiple interpolations in HTML attributes', async () => {
      const el = await page.$('#themed-box');
      expect(el).not.toBeNull();
      const cls = await el!.getAttribute('class');
      expect(cls).toContain('box');
      expect(cls).toContain('dark');
    });

    it('resolves temporary variable in selector interpolation', async () => {
      const el = await page.$('span.active');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('highlighted');
    });

    it('resolves @local interpolation in for-loop HTML attributes', async () => {
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
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Edge cases');
      await page.waitForSelector('[data-passage="Edge Cases"]');
      text = await page.textContent('.passage');
    });

    it('displays string with spaces', () => {
      expect(text).toContain('hello world');
    });

    it('displays string with ampersand', () => {
      expect(text).toContain('test&value');
    });

    it('displays empty string as nothing between brackets', () => {
      expect(text).toContain('[]');
    });

    it('displays numeric string', () => {
      expect(text).toContain('42');
    });

    it('displays zero value', () => {
      expect(text).toContain('Zero value: 0');
    });

    it('displays boolean false', () => {
      expect(text).toContain('Boolean false: false');
    });

    it('displays boolean true', () => {
      expect(text).toContain('Boolean true: true');
    });

    it('displays null-like string literally', () => {
      expect(text).toContain('null');
    });

    it('treats empty string as falsy in conditionals', () => {
      expect(text).toContain('empty is falsy');
    });

    it('treats zero as falsy in conditionals', () => {
      expect(text).toContain('zero is falsy');
    });

    it('treats false as falsy in conditionals', () => {
      expect(text).toContain('false is falsy');
    });

    it('treats non-empty string as truthy in conditionals', () => {
      expect(text).toContain('spaced is truthy');
    });

    it('does arithmetic on numeric string (coercion)', () => {
      expect(text).toContain('84');
    });

    it('evaluates >= comparison', () => {
      expect(text).toContain('hp-gte-100');
    });

    it('evaluates <= comparison', () => {
      expect(text).toContain('hp-lte-100');
    });

    it('evaluates == comparison', () => {
      expect(text).toContain('hp-eq-100');
    });

    it('evaluates !== comparison', () => {
      expect(text).toContain('hp-neq-50');
    });

    it('accesses nested property on object', () => {
      expect(text).toContain('Adventurer has 100 HP');
    });

    it('accesses getter property via print', () => {
      expect(text).toContain('Full health');
    });

    it('renders for loop with index variable', async () => {
      const items = await page.$$('span.idx-item');
      expect(items.length).toBe(3);
      expect(await items[0]!.textContent()).toBe('0:x');
      expect(await items[1]!.textContent()).toBe('1:y');
      expect(await items[2]!.textContent()).toBe('2:z');
    });

    it('renders nothing for empty array for-loop', () => {
      expect(text).not.toContain('SHOULD-NOT-APPEAR');
    });

    it('evaluates nested if inside for-loop', async () => {
      const found = await page.$('span.found-two');
      expect(found).not.toBeNull();
      expect(await found!.textContent()).toBe('two');
    });

    it('evaluates multiple elseif chain correctly', () => {
      expect(text).toContain('chain-c');
      expect(text).not.toContain('chain-a');
      expect(text).not.toContain('chain-b');
      expect(text).not.toContain('chain-d');
      expect(text).not.toContain('chain-default');
    });

    it('concatenates strings in print', () => {
      expect(text).toContain('Hello World');
    });

    it('evaluates Math.floor', () => {
      // Math.floor(7.9) = 7
      expect(text).toContain('7');
    });

    it('evaluates Math.max', () => {
      // Math.max(3, 7, 1) = 7
      expect(text).toContain('7');
    });

    it('evaluates Math.min', () => {
      // Math.min(10, 5, 20) = 5
      expect(text).toContain('5');
    });
  });

  // ===========================================================================
  // Special Characters passage — apostrophes, HTML in vars, special chars
  // ===========================================================================
  describe('Special Chars passage', () => {
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Special chars');
      await page.waitForSelector('[data-passage="Special Chars Passage"]');
      text = await page.textContent('.passage');
    });

    it('displays name with apostrophe', () => {
      expect(text).toContain("O'Brien");
    });

    it('handles HTML-like content in variable safely (not rendered as HTML)', async () => {
      // <b>bold</b> in a variable should be escaped, not rendered as bold
      // The text should contain the literal angle brackets, not a <b> element
      const el = await page.$('.passage');
      const elText = await el!.textContent();
      expect(elText).toContain('<b>bold</b>');
    });

    it('displays at sign in variable value', () => {
      expect(text).toContain('user at domain');
    });

    it('displays underscore in variable value', () => {
      expect(text).toContain('snake_case_value');
    });

    it('displays multi-word value', () => {
      expect(text).toContain('multiple words here');
    });

    it('renders variable inside bold markdown', async () => {
      const allStrong = await page.$$eval('strong', (els) =>
        els.map((el) => el.textContent),
      );
      expect(allStrong).toContain('Adventurer');
    });

    it('renders variable inside italic markdown', async () => {
      const allEm = await page.$$eval('em', (els) =>
        els.map((el) => el.textContent),
      );
      expect(allEm).toContain('Adventurer');
    });

    it('renders multiple variables on one line', () => {
      expect(text).toContain('Adventurer / 100 / 5');
    });

    it('renders escaped braces as literal text and errors on unknown macro', () => {
      // \{is\} renders as literal text "{is}"
      expect(text).toContain('{is} not a macro');
      // unescaped {is} is an unknown macro and shows error
      expect(text).toContain('unknown macro');
    });

    it('evaluates ternary in print expression', () => {
      expect(text).toContain('healthy');
    });

    it('evaluates print with comparison operators in string', () => {
      expect(text).toContain("10 > 5 ? 'yes' : 'no'");
    });
  });

  // ===========================================================================
  // Variable Namespace Tests — $, _, @, computed, temp clearing
  // ===========================================================================
  describe('Var Namespace Tests passage', () => {
    // Read-only tests share a single navigation
    describe('read-only checks', () => {
      let text: string | null;
      beforeAll(async () => {
        await navigateFresh();
        await clickLink('Var namespaces');
        await page.waitForSelector('[data-passage="Var Namespace Tests"]');
        text = await page.textContent('.passage');
      });

      it('displays temporary variable with _ prefix', () => {
        expect(text).toContain('temp-value');
      });

      it('sets and reads temp var in same passage', () => {
        expect(text).toContain('fresh');
      });

      it('overwrites story variable in passage', () => {
        expect(text).toContain('overwritten');
      });

      it('accesses outer temp var inside for loop', () => {
        expect(text).toContain('outer-val');
      });

      it('accesses @local variable in for loop', () => {
        expect(text).toContain('inner');
      });

      it('evaluates computed temporary variable', () => {
        expect(text).toContain('Doubled HP: 200');
      });

      it('handles multiple set macros on same line', () => {
        expect(text).toContain('Sum: 6');
      });
    });

    // This test navigates to another passage — needs its own navigation
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
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Selector combos');
      await page.waitForSelector('[data-passage="Selector Combos"]');
    });

    it('renders class on variable display', async () => {
      const el = await page.$('span.styled-var');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders ID on variable display', async () => {
      const el = await page.$('#id-var');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('100');
    });

    it('renders class AND ID on variable display', async () => {
      const el = await page.$('span.cls-combo#id-combo');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders class on print macro', async () => {
      const el = await page.$('span.styled-print');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('110');
    });

    it('renders ID on print macro', async () => {
      const el = await page.$('#id-print');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('id-content');
    });

    it('renders class on if-block', async () => {
      const el = await page.$('span.if-styled');
      expect(el).not.toBeNull();
      const ifText = (await el!.textContent())!.trim();
      expect(ifText).toContain('styled-if-content');
    });

    it('renders multiple classes on variable display', async () => {
      const el = await page.$('span.cls-a.cls-b');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders class on for-loop wrapper', async () => {
      const el = await page.$('span.for-styled');
      expect(el).not.toBeNull();
      expect((await el!.textContent())!).toContain('for-class-a');
    });

    it('renders interpolated class on variable', async () => {
      const el = await page.$('span.highlight');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('Adventurer');
    });

    it('renders interpolated class with prefix on print', async () => {
      const el = await page.$('span.glow-highlight');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('glow-content');
    });

    it('renders interpolated HTML data attribute', async () => {
      const el = await page.$('span[data-theme="dark"]');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('dark');
    });
  });

  // ===========================================================================
  // Macro Combinations — nested macros, button+temp, link, include, switch
  // ===========================================================================
  describe('Macro Combos passage', () => {
    // Read-only tests share a single navigation
    describe('read-only checks', () => {
      let text: string | null;
      beforeAll(async () => {
        await navigateFresh();
        await clickLink('Macro combos');
        await page.waitForSelector('[data-passage="Macro Combos"]');
        text = await page.textContent('.passage');
      });

      it('renders link macro without passage target', async () => {
        const link = await page.$('a.macro-link:has-text("Toggle flag")');
        expect(link).not.toBeNull();
      });

      it('renders link macro with passage target', async () => {
        const link = await page.$('a.macro-link:has-text("Go home")');
        expect(link).not.toBeNull();
      });

      it('includes passage using variable name', () => {
        expect(text).toContain('included from another passage');
      });

      it('evaluates nested if/else with variables', () => {
        expect(text).toContain('Strong and healthy');
      });

      it('evaluates switch with number value', () => {
        expect(text).toContain('Switch: two');
        expect(text).not.toContain('Switch: one');
        expect(text).not.toContain('Switch: three');
      });

      it('renders meter with zero max without crashing', async () => {
        const meter = await page.$('#zero-meter');
        expect(meter).not.toBeNull();
      });

      it('renders meter with percentage label', async () => {
        const label = await page.$('#pct-meter .macro-meter-label');
        expect(label).not.toBeNull();
        expect(await label!.textContent()).toBe('100%');
      });

      it('renders meter with custom label', async () => {
        const label = await page.$('#custom-meter .macro-meter-label');
        expect(label).not.toBeNull();
        expect(await label!.textContent()).toBe('100 HP / 100 HP');
      });
    });

    // These tests click buttons — need their own navigation
    it('renders button that modifies temp var', async () => {
      await navigateFresh();
      await clickLink('Macro combos');
      await page.waitForSelector('[data-passage="Macro Combos"]');
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
      await navigateFresh();
      await clickLink('Macro combos');
      await page.waitForSelector('[data-passage="Macro Combos"]');
      await page.click('#expr-btn');
      await page.waitForFunction(() =>
        document
          .querySelector('.passage')
          ?.textContent?.includes('Count after: 5'),
      );
      expect(await page.textContent('.passage')).toContain('Count after: 5');
    });
  });

  // ===========================================================================
  // Widget Edge Cases — widgets with special args, zero, booleans, expressions
  // ===========================================================================
  describe('Widget Edge Cases passage', () => {
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Widget edges');
      await page.waitForSelector('[data-passage="Widget Edge Cases"]');
      text = await page.textContent('.passage');
    });

    it('renders StatLine widget with special characters in label', () => {
      expect(text).toContain("Stat's Name");
      expect(text).toContain('value with spaces');
    });

    it('renders StatLine widget with numeric zero argument', () => {
      // Zero should render as "0", not blank
      expect(text).toMatch(/Zero:.*0/);
    });

    it('renders StatLine widget with boolean argument', () => {
      expect(text).toContain('Flag:');
    });

    it('renders StatLine widget with expression argument', () => {
      expect(text).toContain('Double HP:');
      expect(text).toContain('200');
    });

    it('renders Greeting widget with multi-word name', () => {
      expect(text).toContain('Hello, Sir Reginald the Third! Welcome back.');
    });

    it('renders multiple Badge widgets', async () => {
      const badges = await page.$$('span.badge');
      expect(badges.length).toBe(3);
    });

    it('does not show unknown macro errors for registered widgets', () => {
      expect(text).not.toContain('unknown macro');
    });
  });

  // ===========================================================================
  // For Loop Edge Cases — single, numbers, mixed types, nested, buttons, ifs
  // ===========================================================================
  describe('For Loop Edge Cases passage', () => {
    // Read-only tests share a single navigation
    describe('read-only checks', () => {
      beforeAll(async () => {
        await navigateFresh();
        await clickLink('For loop edges');
        await page.waitForSelector('[data-passage="For Loop Edge Cases"]');
      });

      it('iterates single-item array', async () => {
        const el = await page.$('span.single-item');
        expect(el).not.toBeNull();
        expect(await el!.textContent()).toBe('only');
      });

      it('iterates array of numbers', async () => {
        const items = await page.$$('span.num-item');
        expect(items.length).toBe(3);
        expect(await items[0]!.textContent()).toBe('10');
        expect(await items[1]!.textContent()).toBe('20');
        expect(await items[2]!.textContent()).toBe('30');
      });

      it('iterates array of mixed types', async () => {
        const items = await page.$$('span.mixed-item');
        expect(items.length).toBe(4);
        const texts = await Promise.all(items.map((i) => i.textContent()));
        expect(texts).toContain('str');
        expect(texts).toContain('42');
        expect(texts).toContain('true');
        expect(texts).toContain('false');
      });

      it('renders nested for loops with correct @local scoping', async () => {
        const items = await page.$$('span.nested-item');
        expect(items.length).toBe(4);
        const texts = await Promise.all(items.map((i) => i.textContent()));
        expect(texts).toContain('A-1');
        expect(texts).toContain('A-2');
        expect(texts).toContain('B-1');
        expect(texts).toContain('B-2');
      });

      it('evaluates if inside for-loop (even numbers only)', async () => {
        const evens = await page.$$('span.even-num');
        expect(evens.length).toBe(2);
        const texts = await Promise.all(evens.map((e) => e.textContent()));
        expect(texts).toContain('2');
        expect(texts).toContain('4');
      });

      it('accesses story variable by index in for-loop', async () => {
        const items = await page.$$('span.inv-in-for');
        expect(items.length).toBe(2);
        const texts = await Promise.all(items.map((i) => i.textContent()));
        expect(texts).toContain('rusty key');
        expect(texts).toContain('torch');
      });

      it('set inside for-loop accumulates using @local', async () => {
        const el = await page.$('#for-set-total');
        expect(await el!.textContent()).toBe('Total: 60');
      });

      it('do inside for-loop concatenates using @local', async () => {
        const el = await page.$('#for-do-result');
        expect(await el!.textContent()).toBe('Result: abc');
      });

      it('nested for with set uses correct @local scope', async () => {
        const el = await page.$('#for-nested-log');
        expect(await el!.textContent()).toBe('Log: X1X2Y1Y2');
      });
    });

    // These tests click buttons — need their own navigation
    it('renders buttons inside for-loop and they increment correctly', async () => {
      await navigateFresh();
      await clickLink('For loop edges');
      await page.waitForSelector('[data-passage="For Loop Edge Cases"]');
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

    it('button inside for-loop picks correct @local on click', async () => {
      await navigateFresh();
      await clickLink('For loop edges');
      await page.waitForSelector('[data-passage="For Loop Edge Cases"]');
      const btns = await page.$$('.for-pick-btn');
      expect(btns.length).toBe(3);
      // Click the "Pick 20" button (second one)
      await btns[1]!.click();
      await page.waitForFunction(() =>
        document.querySelector('#for-btn-pick')?.textContent?.includes('20'),
      );
      expect(await page.$eval('#for-btn-pick', (el) => el.textContent)).toBe(
        'Picked: 20',
      );
    });
  });

  // ===========================================================================
  // HTML Interop — nested elements, variables in HTML, data attributes
  // ===========================================================================
  describe('HTML Interop passage', () => {
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('HTML interop');
      await page.waitForSelector('[data-passage="HTML Interop"]');
    });

    it('renders nested HTML elements', async () => {
      const inner = await page.$('div.outer span.inner');
      expect(inner).not.toBeNull();
      expect(await inner!.textContent()).toBe('nested content');
    });

    it('renders Twine variable inside HTML container', async () => {
      const container = await page.$('div.html-var-container');
      expect(container).not.toBeNull();
      expect(await container!.textContent()).toBe('Adventurer');
    });

    it('renders Twine print macro inside HTML container', async () => {
      const container = await page.$('div.html-macro-container');
      expect(container).not.toBeNull();
      expect(await container!.textContent()).toBe('300');
    });

    it('renders HTML with data attribute', async () => {
      const el = await page.$('div.data-el');
      expect(el).not.toBeNull();
      expect(await el!.getAttribute('data-value')).toBe('test-data');
    });

    it('renders HTML with interpolated data attribute', async () => {
      const el = await page.$('div.interp-data-el');
      expect(el).not.toBeNull();
      expect(await el!.getAttribute('data-val')).toBe('custom-data');
    });

    it('renders HTML with multiple classes', async () => {
      const el = await page.$('span.cls1.cls2.cls3');
      expect(el).not.toBeNull();
      expect(await el!.textContent()).toBe('multi-class html');
    });

    it('renders variables in markdown table', async () => {
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
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Markdown edges');
      await page.waitForSelector('[data-passage="Markdown Edge Cases"]');
    });

    it('renders variable inside bold', async () => {
      const strongs = await page.$$eval('strong', (els) =>
        els.map((el) => el.textContent),
      );
      expect(strongs).toContain('Adventurer');
    });

    it('renders variable inside italic', async () => {
      const ems = await page.$$eval('em', (els) =>
        els.map((el) => el.textContent),
      );
      // {$player.name} wrapped in *...* should produce <em>Adventurer</em>
      expect(ems).toContain('Adventurer');
    });

    it('renders variables in list items', async () => {
      const text = await page.textContent('.passage');
      expect(text).toContain('Name: Adventurer');
      expect(text).toContain('HP: 100');
    });

    it('renders variable in blockquote', async () => {
      const quote = await page.$('blockquote');
      expect(quote).not.toBeNull();
      const quoteText = await quote!.textContent();
      expect(quoteText).toContain('Adventurer');
    });

    it('renders variable in table cell', async () => {
      const cells = await page.$$eval('td', (els) =>
        els.map((el) => el.textContent),
      );
      expect(cells).toContain('100');
      expect(cells).toContain('5');
    });

    it('renders link after bold text', async () => {
      const text = await page.textContent('.passage');
      expect(text).toContain('bold text');
      const link = await page.$('a.passage-link:has-text("Back to start")');
      expect(link).not.toBeNull();
    });

    it('renders strikethrough', async () => {
      const dels = await page.$$eval('del', (els) =>
        els.map((el) => el.textContent),
      );
      expect(dels).toContain('no weakness');
    });

    it('renders variable inside backtick code span', async () => {
      // BUG: variable inside `backtick code` renders as raw placeholder HTML
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
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Computed vars');
      await page.waitForSelector('[data-passage="Computed Var Tests"]');
      text = await page.textContent('.passage');
    });

    it('evaluates basic computed variable', () => {
      // _base = 10, _computed = 10 * 5 = 100
      expect(text).toContain('60');
      // _base = 20, _result = 20 * 5 = 100
      expect(text).toContain('Computed after base change: 100');
    });

    it('evaluates computed from story variables', () => {
      // $player.hp (100) + $player.strength (5) = 105
      expect(text).toContain('105');
    });

    it('evaluates computed with ternary', () => {
      expect(text).toContain('max');
    });

    it('evaluates computed string concatenation', () => {
      expect(text).toContain('Adventurer (Level 1)');
    });
  });

  // ===========================================================================
  // Unset Tests
  // ===========================================================================
  describe('Unset Tests passage', () => {
    let text: string | null;
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Unset tests');
      await page.waitForSelector('[data-passage="Unset Tests"]');
      text = await page.textContent('.passage');
    });

    it('shows value before unset', () => {
      // $unset_b is never unset, so it persists everywhere
      expect(text).toContain('exists-b');
      // $unset_a is unset — in reactive rendering, both displays reflect final state
      // The "before" display also shows empty because VarDisplay reacts to the deletion
    });

    it('removes unset story variable (shows empty)', () => {
      // After {unset $unset_a}, the display should be empty between brackets
      expect(text).toContain('A: []');
    });

    it('removes unset temp variable (shows empty)', () => {
      expect(text).toContain('Temp: []');
    });

    it('preserves non-unset variables', () => {
      expect(text).toContain('B: exists-b');
    });
  });

  // ===========================================================================
  // Link Syntax Edge Cases — spaces, arrows, selectors, multiple inline
  // ===========================================================================
  describe('Link Syntax Edge Cases passage', () => {
    beforeAll(async () => {
      await navigateFresh();
      await clickLink('Link syntax');
      await page.waitForSelector('[data-passage="Link Syntax Edge Cases"]');
    });

    it('renders pipe link with surrounding spaces (trimmed)', async () => {
      const link = await page.$('a.passage-link:has-text("Spaced Display")');
      expect(link).not.toBeNull();
    });

    it('renders arrow link with surrounding spaces (trimmed)', async () => {
      const link = await page.$('a.passage-link:has-text("Arrow Spaced")');
      expect(link).not.toBeNull();
    });

    it('renders reverse arrow link with surrounding spaces (trimmed)', async () => {
      const link = await page.$('a.passage-link:has-text("Rev Spaced")');
      expect(link).not.toBeNull();
    });

    it('renders plain link', async () => {
      const links = await page.$$eval('a.passage-link', (els) =>
        els.map((el) => el.textContent),
      );
      expect(links).toContain('Start');
    });

    it('renders link with CSS class', async () => {
      const link = await page.$('a.passage-link.link-cls');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Classed Link');
    });

    it('renders link with CSS ID', async () => {
      const link = await page.$('a#link-id');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('ID Link');
    });

    it('renders link with both class and ID', async () => {
      const link = await page.$('a.passage-link.link-cls2#link-id2');
      expect(link).not.toBeNull();
      expect(await link!.textContent()).toBe('Both');
    });

    it('renders multiple inline links', async () => {
      const links = await page.$$eval('a.passage-link', (els) =>
        els.map((el) => el.textContent),
      );
      expect(links).toContain('Link A');
      expect(links).toContain('Link B');
      expect(links).toContain('Link C');
    });
  });
});
