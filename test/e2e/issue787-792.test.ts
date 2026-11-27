import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { storyHtml } from '../headless/story-html';
import type { StoryAPI } from '../../types/index';
declare const Story: StoryAPI;

let browser: Browser;
let page: Page;
let template: string;

beforeAll(async () => {
  const format = readFileSync('dist/format.js', 'utf8');
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

it('normalizes uppercase and mixed-case HTML and MathML like native parsing (#787)', async () => {
  const source =
    '<FORM><INPUT id="text" value="Text"><BuTtOn id="button" type="button">Go</BuTtOn></FORM>' +
    '<MATH id="math"><MI>x</MI><MO>+</MO><MN>1</MN><ANNOTATION-XML encoding="text/html"><INPUT id="annotation"></ANNOTATION-XML></MATH>' +
    '<SVG><foreignObject><BUTTON id="foreign" type="button">Foreign</BUTTON></foreignObject></SVG>';
  await boot({ Start: source });
  const result = await page.evaluate((source) => {
    const native = document.createElement('template');
    native.innerHTML = source;
    const summarize = (root: ParentNode) =>
      Array.from(
        root.querySelectorAll(
          'form, input, button, math, mi, mo, mn, annotation-xml, svg, foreignObject',
        ),
        (el) => ({
          name: el.localName,
          namespace: el.namespaceURI,
          type: el.constructor.name,
        }),
      );
    return {
      actual: summarize(document.querySelector('.passage')!),
      expected: summarize(native.content),
    };
  }, source);
  expect(result.actual).toEqual(result.expected);
  await page.locator('#text').fill('Edited');
  await page.locator('#button').click();
  expect(await page.locator('#text').inputValue()).toBe('Edited');
});

const defaults = {
  name: 'Alice',
  number: 12,
  notes: 'Initial notes',
  flag: true,
  choice: 'Blue',
  radio: 'two',
  empty: '',
};
const edited = {
  name: 'Bob',
  number: 7,
  notes: 'New notes',
  flag: false,
  choice: 'Red',
  radio: 'one',
  empty: 'one',
};

async function bootForm() {
  await boot({
    StoryVariables: Object.entries(defaults)
      .map(([name, value]) => `$${name} = ${JSON.stringify(value)}`)
      .join('\n'),
    Start:
      '<form id="controls">' +
      '{#text textbox $name}{#number numberbox $number}{#notes textarea $notes}{#check checkbox $flag}' +
      '{#list listbox $choice}{option "Red"}{option "Blue"}{/listbox}' +
      '{#one radiobutton $radio "one"}{#two radiobutton $radio "two"}' +
      '{#empty-one radiobutton $empty "one"}{#empty-two radiobutton $empty "two"}' +
      '<input id="native" value="Native"><button type="reset" id="reset-button">Reset</button></form>',
  });
}

async function editForm() {
  await page.locator('#text').fill('Bob');
  await page.locator('#number').fill('7');
  await page.locator('#notes').fill('New notes');
  await page.locator('#check input').uncheck();
  await page.locator('#list').selectOption('Red');
  await page.locator('#one input').check();
  await page.locator('#empty-one input').check();
  await page.locator('#native').fill('Changed');
  await page.evaluate(() => Story.waitForActions());
}

async function values() {
  return page.evaluate(
    (keys) => Object.fromEntries(keys.map((key) => [key, Story.get(key)])),
    Object.keys(defaults),
  );
}

it.each(['button', 'programmatic'])(
  'synchronizes all macro bindings after a %s form reset (#788)',
  async (method) => {
    await bootForm();
    await editForm();
    expect(await values()).toEqual(edited);
    if (method === 'button') await page.locator('#reset-button').click();
    else
      await page.evaluate(() =>
        (document.querySelector('#controls') as HTMLFormElement).reset(),
      );
    await page.evaluate(() => Story.waitForActions());
    await page.waitForFunction(() => Story.get('name') === 'Alice');
    expect(await values()).toEqual(defaults);
    expect(await page.locator('#text').inputValue()).toBe('Alice');
    expect(await page.locator('#number').inputValue()).toBe('12');
    expect(await page.locator('#notes').inputValue()).toBe('Initial notes');
    expect(await page.locator('#check input').isChecked()).toBe(true);
    expect(await page.locator('#list').inputValue()).toBe('Blue');
    expect(await page.locator('#one input').isChecked()).toBe(false);
    expect(await page.locator('#two input').isChecked()).toBe(true);
    expect(await page.locator('#empty-one input').isChecked()).toBe(false);
    expect(await page.locator('#empty-two input').isChecked()).toBe(false);
    expect(await page.locator('#native').inputValue()).toBe('Native');
    const observed = await page.evaluate(() => Story.observe());
    expect(observed.text).toContain('[textbox $name: "Alice"]');
    expect(observed.text).toContain('[checkbox $flag: checked]');
    expect(
      observed.actions.find((action) => action.variable === 'name')?.value,
    ).toBe('Alice');
    expect(
      observed.actions.find((action) => action.variable === 'choice')?.value,
    ).toBe('Blue');
  },
);

it('honors cancelled resets without changing bindings or DOM values (#788)', async () => {
  await bootForm();
  await editForm();
  await page.evaluate(() =>
    document
      .querySelector('#controls')!
      .addEventListener('reset', (event) => event.preventDefault(), {
        once: true,
      }),
  );
  await page.locator('#reset-button').click();
  await page.evaluate(() => Story.waitForActions());
  expect(await values()).toEqual(edited);
  expect(await page.locator('#text').inputValue()).toBe('Bob');
  expect(await page.locator('#check input').isChecked()).toBe(false);
  expect(await page.locator('#list').inputValue()).toBe('Red');
  expect(await page.locator('#one input').isChecked()).toBe(true);
  expect(await page.locator('#native').inputValue()).toBe('Changed');
});

it('observes long interior preformatted whitespace without a quadratic stall (#792)', async () => {
  const line = '  a' + ' '.repeat(120_000) + 'z';
  await boot({ Start: '<pre>' + line + '</pre>' });
  const result = await page.evaluate(() => {
    const start = performance.now();
    const text = Story.observe().text;
    return { text, elapsed: performance.now() - start };
  });
  expect(result.text).toBe(line);
  expect(result.elapsed).toBeLessThan(1000);
});
