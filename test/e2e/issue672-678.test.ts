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

it('boots with large shallow passages and flat expression chains in unvisited passages (#674, #675)', async () => {
  await boot({
    Start: 'Hello',
    StoryVariables: '',
    Large: '<br>'.repeat(150_000),
    Chain: `{print ${'1+'.repeat(4000)}1}`,
  });
  await page.waitForSelector('.passage');
  expect(await page.evaluate(() => Story.observe().text)).toBe('Hello');
});

it('reports excessive nested labels before startup can overflow (#673)', async () => {
  await boot({
    Start: 'Hello',
    StoryVariables: '',
    Unvisited: '{button '.repeat(1200) + 'x' + '}{/button}'.repeat(1200),
  });
  await page.waitForSelector('#root h1');
  expect(await page.locator('#root').textContent()).toContain(
    'nesting or work limit',
  );
});

it('rejects a literal forbidden navigation target at startup (#672)', async () => {
  await boot({ Start: '[[StoryInit]]', StoryVariables: '', StoryInit: '' });
  await page.waitForSelector('#root h1');
  expect(await page.locator('#root').textContent()).toContain(
    'Cannot navigate to special passage "StoryInit"',
  );
});

it('boots inline builtin replacements and preserves computed signed zero (#676, #678)', async () => {
  await boot(
    {
      Start:
        '{if} {for} {computed $out = $input}{computed _out = $input}{print Object.is(_out, -0)}',
      StoryVariables: '$input = 0\n$out = 0',
      StoryInit: '{widget "for"}Widget replacement{/widget}',
    },
    "Story.defineMacro({name:'if', block:false, render() { return 'Macro replacement'; }});",
  );
  await page.waitForSelector('.passage');
  const result = await page.evaluate(async () => {
    await Story.waitForActions();
    Story.set('input', -0);
    await Story.waitForActions();
    return {
      signed: Object.is(Story.get('out'), -0),
      text: Story.observe().text,
      errors: Story.observe().errors,
    };
  });
  expect(result.signed).toBe(true);
  expect(result.text).toContain('Macro replacement');
  expect(result.text).toContain('Widget replacement');
  expect(result.text).toContain('true');
  expect(result.errors).toEqual([]);
});

it('includes visible header and sidebar failures once with dialog and context errors (#677)', async () => {
  await boot({
    Start: '{print null.passage}',
    StoryVariables: '',
    StoryInterface:
      '<header>{print null.header}</header><aside>{print null.sidebar}</aside><span hidden>{print null.hidden}</span>{passage}',
    StoryContext: '{print null.context}',
    Popup: '{print null.dialog}',
  });
  await page.waitForSelector('.passage');
  const observed = await page.evaluate(async () => {
    await Story.waitForActions();
    Story.openDialog('Popup');
    await Story.waitForActions();
    return Story.observe();
  });
  expect(observed.errors).toHaveLength(5);
  for (const name of ['header', 'sidebar', 'passage', 'context', 'dialog']) {
    expect(
      observed.errors.filter((error) => error.includes(`'${name}'`)),
    ).toHaveLength(1);
  }
});
