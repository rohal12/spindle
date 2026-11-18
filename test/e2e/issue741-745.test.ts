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
  const body = template
    .replace('{{STORY_NAME}}', 'Review regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/issues741-745.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body }),
  );
  await page.goto(url);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
}

it('starts with an interpolated selector and code operators in a link label (#741)', async () => {
  await boot({
    StoryVariables: '$theme = "choice"\n$key = false\n$lockpick = true',
    Start: '[[{.{$theme} if $key || $lockpick}Open{else}Inspect{/if}->Hall]]',
    Hall: 'You entered the hall.',
  });
  expect(await page.locator('.passage a').textContent()).toBe('Open');
  await page.locator('.passage a').click();
  await page.waitForFunction(() => Story.passage === 'Hall');
});

it('observes drawn SVG text and edited native controls (#742, #743)', async () => {
  await boot({
    Start:
      '<svg width="200" height="40"><title>Map title</title><desc>Map description</desc><defs><text>Unused</text></defs><text x="0" y="20">Visible</text><foreignObject x="0" y="20" width="200" height="20"><div>HTML</div></foreignObject></svg>\n<textarea>Original</textarea> <input value="Before"> <select><option value="r">Red</option><option value="b">Blue</option></select>',
  });
  await page.locator('.passage textarea').fill('Edited note');
  await page.locator('.passage input').fill('After');
  await page.locator('.passage select').selectOption('b');
  const text = await page.evaluate(() => Story.observe().text);
  expect(text).toContain('Visible');
  expect(text).toContain('HTML');
  expect(text).toContain('[textarea: "Edited note"]');
  expect(text).toContain('[input: "After"]');
  expect(text).toContain('[select: "Blue"]');
  for (const hidden of [
    'Map title',
    'Map description',
    'Unused',
    'Original',
    'Red',
  ])
    expect(text).not.toContain(hidden);
});

it.each([
  ['fade-through', 'html'],
  ['crossfade', 'html'],
  ['crossfade', 'svg'],
  ['crossfade', 'link'],
] as const)(
  'keeps outgoing stylesheet rules out of incoming content (%s, %s, #744)',
  async (type, source) => {
    const css = '.new-only { display: none; } #tile { fill: red; }';
    await page.route('http://spindle.test/passage.css', (route) =>
      route.fulfill({ contentType: 'text/css', body: css }),
    );
    const style =
      source === 'link'
        ? '<link rel="stylesheet" href="http://spindle.test/passage.css">'
        : `<style>${css}</style>`;
    await boot({
      Start:
        (source === 'svg' ? '' : style) +
        '<svg width="40" height="40">' +
        (source === 'svg' ? style : '') +
        '<rect id="tile" width="40" height="40"/></svg>[[Next]]',
      Next: '<div class="new-only">New passage content</div><svg width="40" height="40"><rect id="tile" width="40" height="40"/></svg>',
    });
    await page.clock.install();
    await page.evaluate(async (type) => {
      Story.setTransition({ type, duration: 60_000 });
      Story.goto('Next');
    }, type);
    await page.clock.runFor(20);
    await page.locator('.passage-snapshot').waitFor();
    if (type === 'fade-through') await page.clock.fastForward(60_001);
    await page.waitForFunction(
      () => !!document.querySelector('.passage .new-only'),
    );
    expect(await page.locator('.passage-snapshot').count()).toBe(1);
    expect(
      await page
        .locator('.passage .new-only')
        .evaluate((el) => getComputedStyle(el).display),
    ).toBe('block');
    expect(
      await page
        .locator('.passage-snapshot rect')
        .evaluate((el) => getComputedStyle(el).fill),
    ).toBe('rgb(255, 0, 0)');
    expect(
      await page
        .locator('.passage rect')
        .evaluate((el) => getComputedStyle(el).fill),
    ).toBe('rgb(0, 0, 0)');
    expect(await page.evaluate(() => Story.observe().text)).toContain(
      'New passage content',
    );
  },
);

it.each(['none', 'internal', 'external'])(
  'freezes outgoing native radios with %s form ownership (#745)',
  async (owner) => {
    const form = owner === 'none' ? '' : '<form id="choices"></form>';
    const association = owner === 'none' ? '' : ' form="choices"';
    const radios = `<input type="radio" name="choice"${association} value="a" checked><input type="radio" name="choice"${association} value="b">`;
    await boot({
      StoryInterface:
        owner === 'external'
          ? '<form id="choices"></form>{passage}'
          : '{passage}',
      Start: (owner === 'internal' ? form : '') + radios + '[[Next]]',
      Next: (owner === 'internal' ? form : '') + radios,
    });
    const before = await page
      .locator('.passage input')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked));
    expect(before).toEqual([true, false]);
    await page.evaluate(async () => {
      Story.setTransition({ type: 'crossfade', duration: 60_000 });
      Story.goto('Next');
      await Story.waitForActions();
    });
    const checked = () =>
      page
        .locator('.passage-snapshot input')
        .evaluateAll((els) =>
          els.map((el) => (el as HTMLInputElement).checked),
        );
    expect(await checked()).toEqual([true, false]);
    await page.locator('.passage input[value=b]').check({ force: true });
    expect(await checked()).toEqual([true, false]);
  },
);
