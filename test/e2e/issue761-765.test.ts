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
    .replace('{{STORY_NAME}}', 'Review regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/review.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: document }),
  );
  await page.goto(url);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
}

it.each([
  '<style>.show { display:block !important }</style><div class="show" style="display:none">',
  '<div style="display:none;display:block">',
])(
  'observes text, actions and errors after CSS display overrides (#761)',
  async (opening) => {
    await boot({
      Start: `${opening}Visible text {button "Visible action"}{/button}<span class="error">Visible error</span></div>`,
    });
    const observed = await page.evaluate(() => Story.observe());
    expect(observed.text).toContain('Visible text');
    expect(observed.actions.map((action) => action.label)).toContain(
      'Visible action',
    );
    expect(observed.errors).toEqual(['Visible error']);
    await page
      .getByRole('button', { name: 'Visible action', exact: true })
      .click();
  },
);

it.each([false, true])(
  'revives StoryInit classes before restoring the session (startup navigation=%s, #762)',
  async (navigate) => {
    await boot({
      StoryVariables: '$player = null',
      StoryInit: `{do}
class Player {
  constructor(data) { this.score = data.score; }
  getScore() { return this.score; }
}
Story.registerClass('Player', Player);
$player = new Player({score: 0});
${navigate ? "Story.goto('InitDestination');" : ''}
Story.on('storyinit', () => {
  document.documentElement.dataset.initScore = String(Story.get('player').getScore());
});
{/do}`,
      Start: 'Start [[Next]]',
      Next: 'Score: {$player.score}',
      InitDestination: 'Initialization destination',
    });
    await page.evaluate(async () => {
      Story.setTransition({ type: 'none' });
      Story.set('player.score', 7);
      Story.goto('Next');
      await Story.waitForActions();
    });
    await page.waitForFunction(() =>
      sessionStorage
        .getItem('spindle.session.TEST-STORY')
        ?.includes('c:Player'),
    );
    await page.reload();
    await page.waitForSelector('.passage[data-passage="Next"]');
    await page.evaluate(() => Story.waitForActions());
    expect(await page.locator('.passage').textContent()).toContain('Score: 7');
    expect(await page.locator('html').getAttribute('data-init-score')).toBe(
      '7',
    );
    expect(
      await page.evaluate(() =>
        (Story.get('player') as { getScore(): number }).getScore(),
      ),
    ).toBe(7);
  },
);

it.each(['lowercase', 'mixed case'])(
  'normalizes %s SVG like native HTML parsing (#763)',
  async (casing) => {
    let source =
      '<svg width="200" height="80" viewbox="0 0 200 80">' +
      '<foreignobject width="200" height="50"><div>Visible HTML</div></foreignobject>' +
      '<defs><lineargradient id="paint" gradientunits="userSpaceOnUse"><stop stop-color="red"/></lineargradient></defs>' +
      '<rect x="0" y="60" width="200" height="20" fill="url(#paint)"/></svg>';
    if (casing === 'mixed case') {
      source = source
        .replace(/svg/g, 'SvG')
        .replace(/viewbox/g, 'VIEWbox')
        .replace(/foreignobject/g, 'ForeignOBJECT')
        .replace(/lineargradient/g, 'LinearGRADIENT');
    }
    await boot({ Start: source });
    const result = await page.evaluate((source) => {
      const native = document.createElement('template');
      native.innerHTML = source;
      const summarize = (root: ParentNode) => {
        const svg = root.querySelector('svg')!;
        const foreign = svg.querySelector('foreignObject')!;
        const gradient = svg.querySelector('linearGradient')!;
        return {
          viewBox: svg.getAttribute('viewBox'),
          foreign: foreign.constructor.name,
          gradient: gradient.constructor.name,
          units: gradient.getAttribute('gradientUnits'),
          html: foreign.querySelector('div')!.namespaceURI,
        };
      };
      return {
        actual: summarize(document.querySelector('.passage')!),
        expected: summarize(native.content),
        width: document
          .querySelector('.passage foreignObject div')!
          .getBoundingClientRect().width,
      };
    }, source);
    expect(result.actual).toEqual(result.expected);
    expect(result.width).toBeGreaterThan(0);
    expect((await page.evaluate(() => Story.observe())).text).toContain(
      'Visible HTML',
    );
  },
);

it('observes repeated SVG use text without unused or hidden definitions (#764)', async () => {
  await boot({
    Start:
      '<svg width="400" height="100"><defs>' +
      '<text id="label" y="20">Visible SVG choice</text>' +
      '<text id="unused">Unused</text>' +
      '<symbol id="icon"><text y="20">Symbol label</text></symbol>' +
      '<g id="cycle"><use href="#cycle"/></g></defs>' +
      '<use href="#label"/><use href="#label" y="30"/>' +
      '<use xlink:href="#icon" y="60"/>' +
      '<use href="#cycle"/><use href="#label" style="display:none"/>' +
      '<use href="#label" style="visibility:hidden"/></svg>',
  });
  const result = await page.evaluate(() => ({
    text: Story.observe().text,
    width: document.querySelector('svg > use')!.getBoundingClientRect().width,
  }));
  expect(result.width).toBeGreaterThan(0);
  expect(result.text).toBe('Visible SVG choiceVisible SVG choiceSymbol label');
});

it('uses one override for both passage displays and then restores the default (#765)', async () => {
  await boot({
    StoryInterface: '{#first passage}{#second passage}',
    Start: 'Start [[Next]]',
    Next: 'Next',
    End: 'End',
  });
  await page.evaluate(async () => {
    Story.setTransition({ type: 'fade-through', duration: 1000, pause: 100 });
    Story.setNextTransition({ type: 'none' });
    Story.goto('Next');
    await Story.waitForActions();
  });
  expect(
    await page
      .locator('.passage[data-passage="Next"][data-transition="none"]')
      .count(),
  ).toBe(2);
  expect(await page.locator('.passage-snapshot').count()).toBe(0);
  await page.evaluate(() => Story.goto('End'));
  await page.waitForFunction(
    () => document.querySelectorAll('.passage-snapshot').length === 2,
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '.passage[data-passage="End"][data-transition="fade-through"]',
      ).length === 2,
  );
});
