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
    .replace('{{STORY_NAME}}', 'Visibility regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/visibility.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: document }),
  );
  await page.goto(url);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
}

it.each(['style="content-visibility:hidden"', 'class="closed"'])(
  'omits content-visibility descendants and observes changes (%s, #767)',
  async (gate) => {
    await boot({
      Start:
        '<style>.closed { content-visibility:hidden }</style>Visible.' +
        `<div id="panel" ${gate}>Secret {button "Secret choice"}{/button}<span class="error">Secret error</span></div>`,
      StoryContext:
        'Context<div style="content-visibility:hidden">Context secret</div>',
      Popup:
        'Dialog<div style="content-visibility:hidden">Dialog secret {button "Dialog choice"}{/button}<span class="error">Dialog error</span></div>',
    });
    const observed = await page.evaluate(() => Story.observe());
    expect(observed.text).toBe('Visible.');
    expect(observed.actions).toEqual([]);
    expect(observed.errors).toEqual([]);
    expect(observed.context).toBe('Context');
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#panel')!.style.contentVisibility =
        'visible';
    });
    const shown = await page.evaluate(() => Story.observe());
    expect(shown.text).toContain('Secret');
    expect(shown.actions.map((a) => a.label)).toEqual(['Secret choice']);
    expect(shown.errors).toEqual(['Secret error']);

    await page.evaluate(async () => {
      Story.openDialog('Popup');
      await Story.waitForActions();
    });
    const modal = await page.evaluate(() => Story.observe());
    expect(modal.dialogs).toEqual([{ passage: 'Popup', text: 'Dialog' }]);
    expect(modal.actions.map((a) => a.label)).not.toContain('Dialog choice');
    expect(modal.errors).not.toContain('Dialog error');
  },
);

it.each(['style="display:block"', 'class="shown"'])(
  'includes CSS overrides of hidden and preserves until-found (%s, #768)',
  async (override) => {
    await boot({
      Start:
        '<style>.shown { display:block }</style>Visible.' +
        `<div id="panel" hidden ${override}>Shown {button "Shown choice"}{/button}<span class="error">Shown error</span></div>` +
        '<div hidden>Hidden text</div><div id="find" hidden="until-found" style="display:block">Find secret {button "Find choice"}{/button}<span class="error">Find error</span></div>',
    });
    const observed = await page.evaluate(() => Story.observe());
    expect(observed.text).toContain('Shown');
    expect(observed.text).not.toContain('Hidden text');
    expect(observed.text).not.toContain('Find secret');
    expect(observed.actions.map((a) => a.label)).toEqual(['Shown choice']);
    expect(observed.errors).toEqual(['Shown error']);
    await page
      .getByRole('button', { name: 'Shown choice', exact: true })
      .click();
    await page.evaluate(() =>
      document.querySelector('#find')!.removeAttribute('hidden'),
    );
    const found = await page.evaluate(() => Story.observe());
    expect(found.text).toContain('Find secret');
    expect(found.actions.map((a) => a.label)).toContain('Find choice');
    expect(found.errors).toContain('Find error');
  },
);

it('follows content-visibility through shadow trees and slots (#767)', async () => {
  await boot({ Start: '<div id="host">Slotted secret</div>' });
  await page.evaluate(() => {
    const host = document.querySelector('#host')!;
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<div style="content-visibility:hidden">Shadow secret<span class="error">Shadow error</span><slot></slot></div>';
  });
  expect((await page.evaluate(() => Story.observe())).text).toBe('');
  expect((await page.evaluate(() => Story.observe())).errors).toEqual([]);
  await page.evaluate(() => {
    document
      .querySelector('#host')!
      .shadowRoot!.querySelector('div')!.style.contentVisibility = 'visible';
  });
  expect((await page.evaluate(() => Story.observe())).text).toBe(
    'Shadow secretShadow error\nSlotted secret',
  );
});

it('observes only the typewriter prefix and offers fully revealed choices (#769)', async () => {
  // Long intervals let the test stop the clock after measurement, before tick 1.
  await page.clock.install();
  await boot({
    Start:
      'Before. {type 10s}AB {button "Go"}{/button}<span class="error">Oops</span><input value="secret">{/type}',
  });
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLElement>('.macro-type-inner')
      ?.style.clipPath.includes('100%'),
  );
  await page.clock.pauseAt(new Date());
  const initial = await page.evaluate(() => Story.observe());
  expect(initial.text).toBe('Before.');
  expect(initial.actions).toEqual([]);
  expect(initial.errors).toEqual([]);
  await page.clock.runFor(20_000);
  expect((await page.evaluate(() => Story.observe())).text).toBe('Before. AB');
  await page.clock.runFor(20_000);
  const partial = await page.evaluate(() => Story.observe());
  expect(partial.text).toBe('Before. AB G');
  expect(partial.actions).toEqual([]);
  await page.clock.runFor(10_000);
  expect(
    (await page.evaluate(() => Story.observe())).actions.map((a) => a.label),
  ).toEqual(['Go']);
  await page.clock.runFor(10_000);
  const error = await page.evaluate(() => Story.observe());
  expect(error.errors).toEqual(['O']);
  expect(error.text).not.toContain('secret');
  await page.clock.runFor(30_000);
  const done = await page.evaluate(() => Story.observe());
  expect(done.text).toContain('AB GoOops[input: "secret"]');
  expect(done.errors).toEqual(['Oops']);
});
