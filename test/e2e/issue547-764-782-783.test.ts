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
    .replace('{{STORY_NAME}}', 'Watcher, SVG, settings and widget regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/review.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: document }),
  );
  await page.goto(url);
}

it('does not restore PassageReady watchers from a later passage (#547)', async () => {
  await boot({
    StoryVariables: '$n = 0\n$fired = 0\n$interfaceFired = false',
    StoryInit: '{do}Story.save("initial");{/do}',
    StoryInterface: '{watch "$n > 0" run "$interfaceFired = true"}{passage}',
    PassageReady:
      '{if currentPassage().name === "Next"}' +
      '{watch "$n > 0" run "$fired += 1" name "future"}{/if}',
    Start: '[[Next]]',
    Next: 'Next',
  });
  await page.waitForSelector('.passage');
  const result = await page.evaluate(async () => {
    await Story.waitForActions();
    Story.setTransition({ type: 'none' });
    await Story.step('link:Next');
    await Story.load('initial');
    await Story.waitForActions();
    Story.set('n', 1);
    await Story.waitForActions();
    return {
      passage: Story.passage,
      fired: Story.get('fired'),
      interfaceFired: Story.get('interfaceFired'),
    };
  });
  expect(result).toEqual({ passage: 'Start', fired: 0, interfaceFired: true });
});

it('observes SVG instances using absolute and relative same-document URLs (#764)', async () => {
  await boot({
    StoryVariables: '',
    Start:
      '<svg width="500" height="200"><defs>' +
      '<text id="label" y="20">Label</text>' +
      '<g id="nested"><use href="review.html#label"/></g>' +
      '<g id="cycle"><use href="http://spindle.test/review.html#cycle"/></g>' +
      '<text id="spaced label" y="20">Encoded</text></defs>' +
      '<use href="#label"/>' +
      '<use href="http://spindle.test/review.html#label" y="30"/>' +
      '<use xlink:href="review.html#label" y="60"/>' +
      '<use href="./review.html#nested" y="90"/>' +
      '<use href="review.html#spaced%20label" y="120"/>' +
      '<use href="review.html#cycle"/>' +
      '<use href="elsewhere.svg#label"/>' +
      '<use href="review.html?other#label"/>' +
      '<use href="http://other.test/review.html#label"/></svg>',
  });
  await page.waitForSelector('.passage');
  const result = await page.evaluate(() => ({
    text: Story.observe().text,
    widths: [...document.querySelectorAll<SVGGraphicsElement>('svg > use')]
      .slice(0, 5)
      .map((el) => el.getBBox().width),
  }));
  expect(result.text).toBe('LabelLabelLabelLabelEncoded');
  expect(result.widths.every((width) => width > 0)).toBe(true);
});

it.each([false, true])(
  'shows Settings after first registration (deferred=%s, #782)',
  async (deferred) => {
    await boot({
      StoryVariables: '',
      ...(deferred
        ? {
            StoryInit: `{do}
Story.deferRender();
setTimeout(() => {
  Story.settings.addToggle('music', {label: 'Music', default: true});
  Story.ready();
}, 100);
{/do}`,
          }
        : {}),
      Start: 'Ready',
    });
    await page.waitForSelector('.passage');
    if (!deferred) {
      expect(
        await page
          .getByRole('button', { name: 'Settings', exact: true })
          .count(),
      ).toBe(0);
      await page.evaluate(() => {
        Story.settings.addToggle('music', { label: 'Music', default: true });
      });
    }
    const button = page.getByRole('button', { name: 'Settings', exact: true });
    await button.click();
    await page.getByRole('checkbox', { name: 'Music', exact: true }).uncheck();
    expect(await page.evaluate(() => Story.settings.getToggle('music'))).toBe(
      false,
    );
  },
);

it('refreshes mounted controls and redefinitions without value events (#782)', async () => {
  await boot({
    StoryVariables: '$events = 0',
    StoryInit: `{do}
Story.settings.addToggle('music', {label: 'Music', default: true});
Story.on('settingchanged', () => Story.set('events', Story.get('events') + 1));
{/do}`,
    Start: '{settings-controls}',
  });
  await page.waitForSelector('.settings-row');
  await page.getByRole('checkbox', { name: 'Music', exact: true }).uncheck();
  await page.evaluate(() => {
    Story.settings.addToggle('music', {
      label: 'Background music',
      default: true,
    });
    Story.settings.addToggle('effects', { label: 'Effects', default: true });
  });
  expect(
    await page
      .getByRole('checkbox', { name: 'Background music', exact: true })
      .isChecked(),
  ).toBe(false);
  expect(
    await page
      .getByRole('checkbox', { name: 'Effects', exact: true })
      .isChecked(),
  ).toBe(true);
  expect(await page.evaluate(() => Story.get('events'))).toBe(1);
});

it('boots a widget with thousands of registered macros and body calls (#783)', async () => {
  const n = 4000;
  const script = Array.from(
    { length: n },
    (_, i) =>
      `Story.defineMacro({name: "m${i}", parameters: [{name: "value", type: "expression"}], render() {return null}});`,
  ).join('\n');
  await boot(
    {
      StoryVariables: '',
      StoryInit: '{widget "large"}' + '{m0 1}'.repeat(n) + '{/widget}',
      Start: 'Ready',
    },
    script,
  );
  await page.waitForSelector('.passage');
  expect(await page.locator('.error').count()).toBe(0);
  expect(await page.locator('.passage').textContent()).toBe('Ready');
});
