import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { storyHtml } from '../headless/story-html';
import type { StoryAPI } from '../../types/index';

declare const Story: StoryAPI;
let browser: Browser;
let page: Page;
let template: string;

beforeAll(async () => {
  const format = readFileSync(resolve('dist/format.js'), 'utf8');
  template = JSON.parse(
    format.slice(format.indexOf('(') + 1, format.lastIndexOf(')')),
  ).source;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
});
beforeEach(async () => {
  await page?.close();
  page = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
});

async function boot(passages: Record<string, string>) {
  const html = storyHtml({ StoryVariables: '', ...passages });
  const data = html.slice(
    html.indexOf('<tw-storydata'),
    html.indexOf('</tw-storydata>') + 15,
  );
  const document = template
    .replace('{{STORY_NAME}}', 'Loop and modal regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/loop-modal.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: document }),
  );
  await page.goto(url);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
}

it.each(['object', 'primitive'])(
  'remounts rows replaced by an input-triggered watcher (%s, #778)',
  async (kind) => {
    const object = kind === 'object';
    const item = object ? '@item.name' : '@item';
    const binding = object ? '$items.0.name' : '$items.0';
    const watched = object ? '$items[0].name' : '$items[0]';
    await boot({
      StoryVariables: object ? '$items = [{name: "old"}]' : '$items = ["old"]',
      StoryInit: `{watch '${watched} === "typed"' run '$items = ${object ? '[{name: "new"}]' : '["new"]'}' once}`,
      Start:
        `{for @item of $items}{set @copied = ${item}}` +
        `<span id="copy">{@copied}</span><span id="live">{${item}}</span>` +
        `{textbox ${binding}}{/for}`,
    });
    const input = page.locator('.passage input');
    await input.fill('typed');
    await page.waitForFunction(
      () => document.querySelector('#live')?.textContent === 'new',
    );
    expect(await page.locator('#copy').textContent()).toBe('new');
    expect(await input.inputValue()).toBe('new');
  },
);

it('keeps genuine input edits mounted and focused (#778)', async () => {
  await boot({
    StoryVariables: '$items = [{name: "old"}]\n$mounts = 0',
    Start:
      '{for @item of $items}{set $mounts += 1}{set @copied = @item.name}' +
      '<span id="copy">{@copied}</span>{textbox $items.0.name}{/for}',
  });
  const input = page.locator('.passage input');
  await input.focus();
  for (const value of ['A', 'Ad', 'Ada']) {
    await input.fill(value);
    expect(await input.evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
  }
  expect(await page.evaluate(() => Story.get('mounts'))).toBe(1);
  expect(await page.locator('#copy').textContent()).toBe('old');
});

it.each(['style="display:contents"', 'class="boxless"'])(
  'skips boxless candidates but tabs through their children both ways (%s, #780)',
  async (style) => {
    await boot({
      Start:
        '<style>.boxless { display: contents }</style>{dialog "Open" noclose}Panel{/dialog}',
      Panel:
        `<a href="#" id="boxless" autofocus ${style}><span>Boxless</span></a>` +
        '<button id="first">First</button>' +
        `<div tabindex="0" ${style}><button id="nested">Nested</button></div>` +
        `<a href="#" ${style}><span>Also boxless</span></a>` +
        '<button id="last">Last</button>',
    });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('.dialog-panel').waitFor();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('first');
    for (const id of ['nested', 'last', 'first']) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
    }
    for (const id of ['last', 'nested', 'first']) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
    }
  },
);

it('keeps focus when an input-triggered watcher changes a sibling row (#778)', async () => {
  await boot({
    StoryVariables: '$items = [{name: "old"}, {name: "other"}]\n$mounts = 0',
    StoryInit: `{watch '$items[0].name === "typed"' run '$items[1].name = "updated"' once}`,
    Start:
      '{for @item, @i of $items}{set $mounts += 1}{set @copied = @item.name}' +
      '<span class="copy">{@copied}</span>{if @i === 0}{textbox $items.0.name}{/if}{/for}',
  });
  const input = page.locator('.passage input').first();
  await input.fill('typed');
  await page.waitForFunction(
    () => (Story.get('items') as { name: string }[])[1]?.name === 'updated',
  );
  expect(await input.evaluate((el) => el === document.activeElement)).toBe(
    true,
  );
  expect(await page.locator('.copy').allTextContents()).toEqual([
    'old',
    'updated',
  ]);
  expect(await page.evaluate(() => Story.get('mounts'))).toBe(3);
});
