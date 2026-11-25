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
    .replace('{{STORY_NAME}}', 'State and dialog regressions')
    .replace('{{STORY_DATA}}', () => data);
  const url = 'http://spindle.test/state-dialog.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: document }),
  );
  await page.goto(url);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
}

it('reads, navigates and restores native class fields shadowing inherited accessors (#773)', async () => {
  await boot({
    StoryVariables: '$hero = null',
    StoryInit: `{do}
      class Base {
        get hp() { return 0; }
        set inventory(value) { throw new Error('inherited setter invoked'); }
      }
      class Hero extends Base {
        hp = 100;
        inventory = ['key'];
      }
      Story.registerClass('Hero', Hero);
      Story.set('hero', new Hero());
    {/do}`,
    Start: 'HP {$hero.hp}',
    Next: 'Next HP {$hero.hp}',
  });
  expect(await page.locator('.passage').innerText()).toContain('HP 100');
  await page.evaluate(async () => {
    Story.goto('Next');
    await Story.waitForActions();
    Story.set('hero.hp', 50);
    Story.back();
    await Story.waitForActions();
  });
  expect(await page.evaluate(() => Story.passage)).toBe('Start');
  expect(await page.evaluate(() => Story.get('hero'))).toEqual({
    hp: 100,
    inventory: ['key'],
  });
});

it.each(['single', 'batch'])(
  'retained root setter inputs cannot change recorded history (%s, #774)',
  async (form) => {
    await boot({
      StoryVariables: '$clock = null\n$obj = null',
      Start: 'Start',
      Next: 'Next',
    });
    const observed = await page.evaluate(async (batch) => {
      const clock = new Date(1000);
      const obj = { clock };
      if (batch) Story.set({ clock, obj });
      else {
        Story.set('clock', clock);
        Story.set('obj', obj);
      }
      Story.recordMoment();
      clock.setTime(9000);
      const live = (Story.get('clock') as Date).getTime();
      const nested = (Story.get('obj') as { clock: Date }).clock.getTime();
      const recorded = (Story.history.variables(0).clock as Date).getTime();
      Story.goto('Next');
      await Story.waitForActions();
      Story.back();
      await Story.waitForActions();
      return {
        live,
        nested,
        recorded,
        restored: (Story.get('clock') as Date).getTime(),
      };
    }, form === 'batch');
    expect(observed).toEqual({
      live: 1000,
      nested: 1000,
      recorded: 1000,
      restored: 1000,
    });
  },
);

it.each(['style="display:block"', 'class="shown"'])(
  'tabs both ways through CSS-revealed hidden controls (%s, #775)',
  async (override) => {
    await boot({
      Start:
        '<style>.shown { display: block }</style>{dialog "Open" noclose}Panel{/dialog}',
      Panel:
        `<button id="first" hidden ${override}>First choice</button>` +
        `<div hidden ${override}><button id="revealed" autofocus>Revealed choice</button></div>` +
        '<div hidden><button>Hidden</button></div>' +
        '<div hidden="until-found" style="display:block"><button>Unfound</button></div>' +
        '<div inert><button>Inert</button></div>' +
        '<button id="last">Last choice</button>',
    });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('.dialog-panel').waitFor();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      'revealed',
    );
    for (const id of ['last', 'first', 'revealed']) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
    }
    for (const id of ['first', 'last', 'revealed']) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
    }
  },
);

it.each([
  "James'",
  "'Tis the Season",
  'James"',
  '"Tis the Season',
  '"Panel"',
  "'Panel'",
])(
  'validates and opens the intended dialog body name %s (#776)',
  async (body) => {
    const target = body === '"Panel"' || body === "'Panel'" ? 'Panel' : body;
    await boot({
      Start: `{dialog "Open"}${body}{/dialog}`,
      [target]: 'Intended content',
      Decoy: 'Wrong content',
      James: 'Wrong content',
    });
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('.dialog-panel').waitFor();
    expect(await page.locator('.dialog-body').innerText()).toBe(
      'Intended content',
    );
    expect((await page.evaluate(() => Story.observe())).dialogs).toEqual([
      { passage: target, text: 'Intended content' },
    ]);
  },
);
