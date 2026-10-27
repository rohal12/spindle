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

async function boot(passages: Record<string, string>, script = '') {
  const html = storyHtml(passages);
  const data = html
    .slice(html.indexOf('<tw-storydata'), html.indexOf('</tw-storydata>') + 15)
    .replace(
      '</tw-storydata>',
      `<script role="script" type="text/twine-javascript">${script}</script></tw-storydata>`,
    );
  const document = template
    .replace('{{STORY_NAME}}', 'Review regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/review.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: document }),
  );
  await page.goto(url);
}

// These fixtures verify conversion of huge child lists, without spending
// time laying out tens of thousands of offscreen lines.
const skipLayout = `document.head.appendChild(Object.assign(document.createElement('style'), {textContent: '.passage { display: none; }'}));`;

it.each([false, true])(
  'renders wide Markdown paragraphs (nobr=%s, #681)',
  async (nobr) => {
    const text = '*a* '.repeat(70_000);
    await boot(
      {
        StoryVariables: '',
        Start: nobr ? `{nobr}${text}{/nobr}` : text,
      },
      skipLayout,
    );
    await page.waitForSelector('.passage em', { state: 'attached' });
    expect(await page.locator('.passage em').count()).toBe(70_000);
    expect(await page.locator('.error').count()).toBe(0);
  },
);

it.each([false, true])(
  'renders wide placeholder paragraphs (nobr=%s, #681, #683)',
  async (nobr) => {
    const text = 'A' + '<br>'.repeat(150_000);
    await boot(
      {
        StoryVariables: '',
        Start: nobr ? `{nobr}${text}{/nobr}` : text,
      },
      skipLayout,
    );
    await page.waitForSelector('.passage br', { state: 'attached' });
    expect(await page.locator('.passage br').count()).toBe(150_000);
    expect(await page.locator('.error').count()).toBe(0);
  },
);

it('boots shared custom branches and contextual option widgets (#680, #682)', async () => {
  await boot(
    {
      StoryVariables: '$x = "A"',
      StoryInit: '{widget "option" @value}Widget:{@value}{/widget}',
      Start:
        '{panel}Intro{else}Other{case Hello world}Case body{elseif More labels}Elseif body{/panel} {if false}Hidden{else}Builtin{/if} {option "standalone"} {listbox $x}{OPTION "A"}{option "B"}{/listbox} {cycle $x}{option "A"}{OPTION "B"}{/cycle}',
    },
    "Story.defineMacro({name:'panel', subMacros:['else', 'case', 'elseif'], render(props, ctx) { return ctx.h('div', null, ctx.renderNodes(props.children), props.branches.map(branch => ctx.h('span', null, branch.rawArgs, ctx.renderNodes(branch.children)))); }});",
  );
  await page.waitForSelector('.passage select');
  const result = await page.evaluate(async () => {
    await Story.waitForActions();
    return Story.observe();
  });
  expect(result.errors).toEqual([]);
  expect(result.text).toContain('Intro');
  expect(result.text).toContain('Other');
  expect(result.text).toContain('Builtin');
  expect(result.text).toContain('Hello world');
  expect(result.text).toContain('More labels');
  expect(result.text).toContain('Widget:standalone');
  expect(
    result.actions
      .filter((action) => action.type === 'listbox' || action.type === 'cycle')
      .map((action) => action.options),
  ).toEqual([
    ['A', 'B'],
    ['A', 'B'],
  ]);
});
