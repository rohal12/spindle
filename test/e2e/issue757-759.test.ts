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
  const url = 'http://spindle.test/issues757-759.html';
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body }),
  );
  await page.goto(url);
  await page.waitForSelector('.passage');
  await page.evaluate(() => Story.waitForActions());
}

it.each(['external', 'recreated', 'ancestor', 'internal'])(
  'isolates snapshot fields with %s form ownership from submission and validation (#757)',
  async (owner) => {
    const explicit = owner === 'external' || owner === 'recreated';
    const fields = [
      '<input name="old" required>',
      '<input name="hidden" type="hidden" value="secret">',
      '<input name="checked" type="checkbox" checked>',
      '<input name="radio" type="radio" checked>',
      '<textarea name="note">Old note</textarea>',
      '<select name="choice"><option>Old choice</option></select>',
      '<button name="submit" value="old">Old submit</button>',
      '<fieldset><legend>Old fields</legend></fieldset>',
      '<output name="result">Old result</output>',
      '<object name="embedded"></object>',
    ]
      .map((field) =>
        explicit ? field.replace(' ', ' form="shared" ') : field,
      )
      .join('');
    const incoming = '<input name="new" value="ok"><button>Submit</button>';
    const form = (content: string) => `<form id="shared">${content}</form>`;
    await boot({
      StoryInterface:
        owner === 'ancestor'
          ? form('{passage}')
          : (owner === 'external' ? form('') : '') + '{passage}',
      Start:
        (owner === 'internal'
          ? form(fields)
          : (owner === 'recreated' ? form('') : '') + fields) + '[[Next]]',
      Next: explicit
        ? (owner === 'recreated' ? form('') : '') +
          incoming
            .replace('<input ', '<input form="shared" ')
            .replace('<button>', '<button form="shared">')
        : owner === 'internal'
          ? form(incoming)
          : incoming,
    });
    expect(
      await page
        .locator('#shared')
        .evaluate((el) => (el as HTMLFormElement).checkValidity()),
    ).toBe(false);
    await page.evaluate(async () => {
      Story.setTransition({ type: 'crossfade', duration: 60_000 });
      Story.goto('Next');
      await Story.waitForActions();
    });
    expect(await page.locator('.passage-snapshot').count()).toBe(1);
    expect(
      await page.locator('.passage-snapshot input[name=old]').inputValue(),
    ).toBe('');
    expect(
      await page.locator('.passage-snapshot input[type=checkbox]').isChecked(),
    ).toBe(true);
    expect(await page.locator('.passage-snapshot select').inputValue()).toBe(
      'Old choice',
    );
    expect(await page.locator('.passage-snapshot textarea').inputValue()).toBe(
      'Old note',
    );
    expect(
      await page
        .locator('.passage-snapshot')
        .evaluate((snapshot) =>
          [
            ...snapshot.querySelectorAll(
              'input, textarea, select, button, fieldset, output, object',
            ),
          ].every((el) => (el as HTMLInputElement).form === null),
        ),
    ).toBe(true);
    expect(
      await page
        .locator('.passage-snapshot form')
        .evaluateAll((forms) =>
          forms.map((form) => [...new FormData(form as HTMLFormElement)]),
        ),
    ).toEqual(owner === 'internal' || owner === 'recreated' ? [[]] : []);
    expect(
      await page.locator('#shared').evaluate((el) => {
        const form = el as HTMLFormElement;
        let submitted = false;
        form.addEventListener(
          'submit',
          (event) => {
            event.preventDefault();
            submitted = true;
          },
          { once: true },
        );
        form.requestSubmit();
        return {
          valid: form.checkValidity(),
          data: [...new FormData(form)],
          submitted,
        };
      }),
    ).toEqual({ valid: true, data: [['new', 'ok']], submitted: true });
  },
);

it('isolates snapshot fields during the incoming fade-through phase (#757)', async () => {
  await boot({
    StoryInterface: '<form id="shared"></form>{passage}',
    Start: '<input form="shared" name="old" required>[[Next]]',
    Next: '<input form="shared" name="new" value="ok">',
  });
  await page.clock.install();
  await page.evaluate(() => {
    Story.setTransition({ type: 'fade-through', duration: 1000 });
    Story.goto('Next');
  });
  await page.clock.runFor(1100);
  await page.locator('.passage input[name=new]').waitFor();
  expect(await page.locator('.passage-snapshot').count()).toBe(1);
  expect(
    await page.locator('#shared').evaluate((el) => ({
      valid: (el as HTMLFormElement).checkValidity(),
      data: [...new FormData(el as HTMLFormElement)],
    })),
  ).toEqual({ valid: true, data: [['new', 'ok']] });
});

it('isolates cloned form controls inside shadow roots (#757)', async () => {
  await boot({ Start: '<div class="host"></div>[[Next]]', Next: 'Done' });
  await page.locator('.host').evaluate((host) => {
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<form><input name="old" required><input name="checked" type="checkbox" checked></form>';
  });
  await page.evaluate(async () => {
    Story.setTransition({ type: 'crossfade', duration: 60_000 });
    Story.goto('Next');
    await Story.waitForActions();
  });
  expect(
    await page.locator('.passage-snapshot .host').evaluate((host) => {
      const form = host.shadowRoot!.querySelector('form')!;
      return {
        valid: form.checkValidity(),
        data: [...new FormData(form)],
        owners: [...form.querySelectorAll('input')].map(
          (input) => input.form === null,
        ),
      };
    }),
  ).toEqual({ valid: true, data: [], owners: [true, true] });
});

it('keeps frozen accordions open when incoming accordions join the same group (#758)', async () => {
  await boot({
    Start:
      '<details name="sections" open><summary>Old section</summary>Old body</details>[[Next]]',
    Next: '<details name="sections" open><summary>New section</summary>New body</details>',
  });
  await page.evaluate(async () => {
    Story.setTransition({ type: 'crossfade', duration: 60_000 });
    Story.goto('Next');
    await Story.waitForActions();
  });
  const openStates = () =>
    page.locator('details').evaluateAll((elements) =>
      elements.map((el) => ({
        snapshot: !!el.closest('.passage-snapshot'),
        open: (el as HTMLDetailsElement).open,
      })),
    );
  expect(await openStates()).toEqual([
    { snapshot: true, open: true },
    { snapshot: false, open: true },
  ]);
  await page.locator('.passage details').evaluate((details) => {
    (details as HTMLDetailsElement).open = false;
    (details as HTMLDetailsElement).open = true;
  });
  expect(await openStates()).toEqual([
    { snapshot: true, open: true },
    { snapshot: false, open: true },
  ]);
  expect(
    await page
      .locator('.passage-snapshot details')
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(
    await page
      .locator('.passage-snapshot summary')
      .evaluate((el) => el.getBoundingClientRect().height),
  );
});

it('keeps the cycle label, state and action consistent before and after a choice (#759)', async () => {
  await boot({
    StoryVariables: '$stance = null',
    Start: '{cycle $stance}{option "Red"}{option "Blue"}{/cycle}[[Next]]',
    Next: '{if $stance === null}No selection{else}{$stance}{/if}',
  });
  const cycle = page.locator('.macro-cycle');
  expect(await cycle.textContent()).toBe('Choose an option');
  expect(await page.evaluate(() => Story.get('stance'))).toBeNull();
  expect(
    await page.evaluate(() =>
      Story.getActions().find((a) => a.type === 'cycle'),
    ),
  ).toMatchObject({
    label: 'Choose an option',
    value: null,
  });
  expect(await page.evaluate(() => Story.observe().text)).toContain(
    '[cycle $stance: null]',
  );
  await cycle.click();
  await page.evaluate(() => Story.waitForActions());
  expect(await cycle.textContent()).toBe('Red');
  expect(await page.evaluate(() => Story.get('stance'))).toBe('Red');
  expect(await page.evaluate(() => Story.observe().text)).toContain(
    '[cycle $stance: "Red"]',
  );
  await page.evaluate(async () => {
    const action = Story.getActions().find((a) => a.type === 'cycle')!;
    await Story.performAction(action.id);
    await Story.waitForActions();
  });
  expect(await cycle.textContent()).toBe('Blue');
  expect(await page.evaluate(() => Story.get('stance'))).toBe('Blue');
});
