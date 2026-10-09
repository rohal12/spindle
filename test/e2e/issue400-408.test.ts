/**
 * E2E tests of #400-#408 in a real browser, with the issues' own stories:
 * - #400: a {for} body writing its own item runs once per item;
 * - #401: a restart cancels a pending interface click body;
 * - #402: a StoryInterface {watch} watches again after a restart;
 * - #403: a second deferRender() keeps :storyready;
 * - #404: a tab sees a quick save another tab made (real IndexedDB, two
 *   pages of one browser context);
 * - #405: a cyclic default boots;
 * - #406: a loop over a shared graph renders without a long stall;
 * - #407: replacing a registered Array subclass item remounts its iteration;
 * - #408: Story.set writes a field of a registered Map subclass;
 * - #410: a timer of a passage left stops writing;
 * - #411: a {for} button that edits its item keeps its control;
 * - #413: native media controls are tab stops of a dialog;
 * - #414: input bindings of temporary variables are rejected.
 *
 * Compiles its own stories with the built format (global setup builds it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { createServer } from 'http';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { compileToFile } from '@rohal12/twee-ts';

const projectRoot = resolve(import.meta.dirname!, '../..');

const header = (ifid: string) => `:: StoryTitle
Regression

:: StoryData
{"ifid":"${ifid}","format":"spindle","format-version":"0.1.0","start":"Start"}

`;

const stories: Record<string, string> = {
  forWrites: `${header('40000000-0000-4000-8000-000000000400')}:: StoryVariables
$party = [{ hp: 0 }]

:: Start
{for @member, @i of $party}
  {if @member.hp < 3}
    {set $party[@i].hp += 1}
  {/if}
{/for}
HP: {$party[0].hp}
`,
  interfaceClick: `${header('40000000-0000-4000-8000-000000000401')}:: StoryVariables
$n = 0

:: StoryInterface
{button "Schedule"}
  {timed 500ms}{set $n += 1}{/timed}
{/button}
{passage}

:: Start
Number: {$n}
`,
  interfaceWatch: `${header('40000000-0000-4000-8000-000000000402')}:: StoryVariables
$n = 0
$fired = 0

:: StoryInterface
{watch "$n > 0" run "$fired += 1"}
{passage}

:: Start
{button "Increment"}{set $n += 1}{/button}
Fired: {$fired}
`,
  deferTwice: `${header('40000000-0000-4000-8000-000000000403')}:: Boot [script]
window.readyCount = 0;
document.addEventListener(':storyready', () => window.readyCount++);
Story.deferRender();
setTimeout(() => {
  Story.deferRender();
  Story.ready();
}, 100);

:: StoryVariables
$n = 0

:: Start
Start of the game.
`,
  saves: `${header('40000000-0000-4000-8000-000000000404')}:: StoryVariables
$n = 0

:: Start
Start of the game.
`,
  cyclic: `${header('40000000-0000-4000-8000-000000000405')}:: StoryVariables
$node = (() => { const node = { name: "Alice" }; node.self = node; return node; })()

:: Start
Name: {$node.name}
`,
  graph: `${header('40000000-0000-4000-8000-000000000406')}:: StoryVariables
$items = []

:: Start
{button "Build graph"}
  {do}
    let node = { text: "leaf" };
    for (let i = 0; i < 18; i++) node = { left: node, right: node };
    $items = [node];
  {/do}
{/button}
{for @node of $items}Item{/for}
`,
  subclasses: `${header('40000000-0000-4000-8000-000000000407')}:: Classes [script]
window.Bag = class Bag extends Array {
  constructor(label) { super(); this.label = label; }
};
window.Inventory = class Inventory extends Map {
  constructor(label) { super(); this.label = label; }
};
Story.registerClass('Bag', Bag);
Story.registerClass('Inventory', Inventory);

:: StoryVariables
$bags = []
$bag = null

:: StoryInit
{do}$bags = [new Bag("Old label")]; $bag = new Inventory("Initial"){/do}

:: Start
{for @bag of $bags}
  {set @cached = @bag.label}
  Cached: {@cached}
  Live: {@bag.label}
{/for}
Label: {$bag.label}
`,
  outgoingTimer: `${header('40000000-0000-4000-8000-000000000410')}:: StoryVariables
$n = 0

:: Start
{repeat 20ms}{set $n += 1}{/repeat}
[[B]]

:: B
N: {$n}
`,
  loopButton: `${header('40000000-0000-4000-8000-000000000411')}:: StoryVariables
$party = [{hp: 0}]
$done = 0

:: Start
{for @p, @i of $party}
  {button "Heal"}
    {set $party[@i].hp += 1}
    {timed 100ms}{set $done += 1}{/timed}
  {/button}
{/for}
Done: {$done}
`,
  mediaDialog: `${header('40000000-0000-4000-8000-000000000413')}:: StoryVariables

:: Start
{dialog "Listen"}Audio{/dialog}

:: Audio
<audio controls src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="></audio>
`,
  tempBinding: `${header('40000000-0000-4000-8000-000000000414')}:: StoryVariables

:: Start
{set _name = "Ada"}
{textbox _name}
Current: {_name}
`,
};

let dir: string;
let served = 'forWrites';
let server: ReturnType<typeof createServer>;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), 'spindle-e2e-'));
  for (const [name, twee] of Object.entries(stories)) {
    const src = resolve(dir, `${name}.twee`);
    writeFileSync(src, twee);
    await compileToFile({
      sources: [src],
      outFile: resolve(dir, `${name}.html`),
      formatPaths: [resolve(projectRoot, 'dist/storyformats')],
    });
  }
  server = createServer((req, res) => {
    const story = new URL(req.url ?? '/', 'http://x').searchParams.get('s');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(resolve(dir, `${story ?? served}.html`)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
  context = await browser.newContext();
  page = await context.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

const open = async (story: string, on: Page = page) => {
  served = story;
  await on.goto(`${baseUrl}/?s=${story}`);
  await on.evaluate(() => sessionStorage.clear());
  await on.goto(`${baseUrl}/?s=${story}`);
  await on.waitForSelector('.passage');
};

describe('a {for} body writing its own item (#400)', () => {
  it('runs once per item', async () => {
    await open('forWrites');
    await page.waitForTimeout(200);
    expect(await page.evaluate('Story.get("party")')).toEqual([{ hp: 1 }]);
    expect(await page.textContent('.passage')).toContain('HP: 1');
  });
});

describe('a pending interface click body (#401)', () => {
  it('is cancelled by a restart', async () => {
    await open('interfaceClick');
    await page.click('button:has-text("Schedule")');
    await page.evaluate('Story.restart()');
    await page.waitForTimeout(800);
    expect(await page.evaluate('Story.get("n")')).toBe(0);
  });
});

describe('a StoryInterface {watch} (#402)', () => {
  it('watches again after a restart', async () => {
    await open('interfaceWatch');
    await page.click('button:has-text("Increment")');
    await expect.poll(() => page.evaluate('Story.get("fired")')).toBe(1);
    await page.evaluate('Story.restart()');
    await page.click('.passage button:has-text("Increment")');
    await expect.poll(() => page.evaluate('Story.get("fired")')).toBe(1);
    expect(await page.evaluate('Story.get("n")')).toBe(1);
  });
});

describe('a second deferRender() (#403)', () => {
  it('still fires :storyready', async () => {
    await open('deferTwice');
    await expect.poll(() => page.evaluate('window.readyCount')).toBe(1);
    expect(await page.textContent('.passage')).toContain('Start of the game.');
  });
});

describe('a quick save made in another tab (#404)', () => {
  it('enables QuickLoad and hasSave() in this tab', async () => {
    // The context is new: the story has no saves yet
    await open('saves');
    const other = await context.newPage();
    await open('saves', other);
    await expect.poll(() => page.evaluate('Story.hasSave()')).toBe(false);

    await other.evaluate('Story.save()');
    await expect.poll(() => page.evaluate('Story.hasSave()')).toBe(true);
    expect(await page.isDisabled('button:has-text("QuickLoad")')).toBe(false);

    await other.evaluate('Story.deleteSave()');
    await expect.poll(() => page.evaluate('Story.hasSave()')).toBe(false);
    await other.close();
  });
});

describe('a cyclic default (#405)', () => {
  it('boots and keeps the backreference', async () => {
    await open('cyclic');
    expect(await page.textContent('.passage')).toContain('Name: Alice');
    expect(
      await page.evaluate(
        '(() => { const n = Story.get("node"); return n.self === n; })()',
      ),
    ).toBe(true);
  });
});

describe('a loop over a shared graph (#406)', () => {
  it('renders the item without a long task', async () => {
    await open('graph');
    await page.evaluate(() => {
      (window as unknown as { longest: number }).longest = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const w = window as unknown as { longest: number };
          w.longest = Math.max(w.longest, entry.duration);
        }
      }).observe({ type: 'longtask' });
    });
    await page.click('button:has-text("Build graph")');
    await expect.poll(() => page.textContent('.passage')).toContain('Item');
    await page.waitForTimeout(200);
    expect(await page.evaluate('window.longest')).toBeLessThan(150);
  });
});

describe('registered collection subclasses (#407, #408)', () => {
  it('remounts an iteration whose replacement differs in its fields', async () => {
    await open('subclasses');
    expect(await page.textContent('.passage')).toContain('Cached: Old label');
    await page.evaluate('Story.set("bags", [new Bag("New label")])');
    await expect
      .poll(() => page.textContent('.passage'))
      .toContain('Cached: New label');
    expect(await page.evaluate('Story.get("bags")[0] instanceof Bag')).toBe(
      true,
    );
  });

  it('lets Story.set write a field of a Map subclass', async () => {
    await open('subclasses');
    await page.evaluate('Story.set("bag.label", "API label")');
    await expect
      .poll(() => page.textContent('.passage'))
      .toContain('Label: API label');
    expect(await page.evaluate('Story.get("bag") instanceof Inventory')).toBe(
      true,
    );
  });
});

describe('a timer of a passage that was left (#410)', () => {
  it('does not write into the destination', async () => {
    await open('outgoingTimer');
    await page.waitForTimeout(100);
    await page.evaluate('Story.goto("B")');
    await page.waitForSelector('.passage:has-text("N:")');
    const n = await page.evaluate('Story.get("n")');
    await page.waitForTimeout(200);
    expect(await page.evaluate('Story.get("n")')).toBe(n);
  });
});

describe('a {for} button that edits its item (#411)', () => {
  it('keeps the control and finishes its timer', async () => {
    await open('loopButton');
    const button = await page.$('.passage button');
    await button!.click();
    await expect.poll(() => page.evaluate('Story.get("done")')).toBe(1);
    expect(await page.evaluate('Story.get("party")')).toEqual([{ hp: 1 }]);
    expect(await button!.evaluate((el) => el.isConnected)).toBe(true);
  });
});

describe('native media controls in a dialog (#413)', () => {
  it('are reached by Tab before the trap wraps', async () => {
    await open('mediaDialog');
    await page.click('.passage button, .passage a');
    await page.waitForSelector('.dialog-panel');
    const tags = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      tags.add(
        await page.evaluate(
          () =>
            document.activeElement?.localName +
            (document.activeElement?.closest('.dialog-panel') ? '' : '!'),
        ),
      );
    }
    expect(tags).toContain('audio');
    expect(tags).not.toContain('body!');
  });
});

describe('an input bound to a temporary variable (#414)', () => {
  it('is rejected instead of binding a story key', async () => {
    await open('tempBinding');
    expect(await page.$('.passage input')).toBeNull();
    expect(await page.textContent('.passage .error')).toContain('temporary');
    expect(await page.evaluate('Story.get("_name")')).toBeUndefined();
  });
});
