import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-620-625-'));
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Review regressions

:: StoryData
{"ifid":"62062500-0000-4000-8000-000000000000","format":"spindle","start":"Start"}

:: StoryVariables

:: Components [script]
customElements.define('x-fields', class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'}).innerHTML =
      '<input id="one"><input id="two"><slot></slot>';
  }
});
customElements.define('x-opener', class extends HTMLElement {
  constructor() {
    super();
    const button = document.createElement('button');
    button.id = 'open';
    button.textContent = 'Open shadow dialog';
    button.addEventListener('click', () => Story.openDialog('Panel'));
    this.attachShadow({mode: 'open'}).appendChild(button);
  }
});
customElements.define('x-nested', class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'}).innerHTML = '<x-fields id="inner"></x-fields>';
  }
});
customElements.define('x-slots', class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'}).innerHTML =
      '<button id="last" tabindex="2">Last</button><button id="first" tabindex="1">First</button><slot><button id="fallback">Fallback</button></slot>';
  }
});
customElements.define('x-fallback', class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'}).innerHTML = '<slot><input id="fallback"></slot>';
  }
});
customElements.define('x-visible', class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'}).innerHTML = '<input id="inside" style="visibility:visible">';
  }
});

:: Start
<x-opener id="opener"></x-opener>
{dialog "Frame"}Frame{/dialog}
{dialog "Nested"}Nested{/dialog}
{dialog "Slots"}Slots{/dialog}
{dialog "Text"}Text{/dialog}
{dialog "Visible"}Visible{/dialog}

:: Panel
<x-fields id="hidden" hidden></x-fields>
<x-fields id="inert" inert></x-fields>
<x-fields id="fields"><button id="slotted">Slotted</button></x-fields>
<button id="after">After</button>

:: Frame
<iframe id="frame" srcdoc="<input id='one'><input id='two'>"></iframe>
<button id="after">After</button>

:: Nested
<x-nested id="nested"></x-nested>
<button id="after">After</button>

:: Slots
<button id="priority" tabindex="1">Priority</button>
<x-fields tabindex="-1"></x-fields>
<x-slots id="slots">{nobr}Assigned text{/nobr}</x-slots>
<button id="after">After</button>

:: Text
<x-fallback id="text">{nobr}Assigned text{/nobr}</x-fallback>
<button id="after">After</button>

:: Visible
<x-visible id="visible" style="visibility:hidden"></x-visible>
<button id="after">After</button>
`,
  );
  const output = resolve(directory, 'story.html');
  await compileToFile({
    sources: [source],
    outFile: output,
    formatPaths: [resolve('dist/storyformats')],
  });
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(readFileSync(output));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  if (directory) rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage();
  await page.goto(baseUrl);
  await page.waitForSelector('.passage');
  await page.waitForFunction(() => !!customElements.get('x-nested'));
});

const active = () =>
  page.evaluate(() => {
    const path: string[] = [];
    let root: Document | ShadowRoot = document;
    while (root.activeElement) {
      const element: Element = root.activeElement;
      path.push(element.id || element.className);
      const next: Document | ShadowRoot | null =
        element.shadowRoot ??
        (element.localName === 'iframe'
          ? (element as HTMLIFrameElement).contentDocument
          : null);
      if (
        !next?.activeElement ||
        next.activeElement === (next as Document).body
      )
        break;
      root = next;
    }
    return path.join(':');
  });

it('visits shadow fields and slotted controls in both directions and restores the opener (#625)', async () => {
  await page.locator('#opener').evaluate((host) => {
    const button = host.shadowRoot!.querySelector('button')!;
    button.focus();
    button.click();
  });
  expect(await active()).toBe('fields:one');
  for (const expected of ['fields:two', 'slotted', 'after']) {
    await page.keyboard.press('Tab');
    expect(await active()).toBe(expected);
  }
  for (const expected of ['slotted', 'fields:two', 'fields:one']) {
    await page.keyboard.press('Shift+Tab');
    expect(await active()).toBe(expected);
  }
  await page.locator('#fields #one').click();
  await page.keyboard.press('Tab');
  expect(await active()).toBe('fields:two');
  await page.keyboard.press('Escape');
  expect(await active()).toBe('opener:open');
});

it('traverses nested authored shadow roots (#625)', async () => {
  await page.getByRole('button', { name: 'Nested', exact: true }).click();
  expect(await active()).toBe('nested:inner:one');
  await page.keyboard.press('Tab');
  expect(await active()).toBe('nested:inner:two');
  await page.keyboard.press('Tab');
  expect(await active()).toBe('after');
  await page.keyboard.press('Shift+Tab');
  expect(await active()).toBe('nested:inner:two');
});

it('keeps positive tabindexes scoped and skips fallback replaced by assigned text (#625)', async () => {
  await page.getByRole('button', { name: 'Slots', exact: true }).click();
  expect(await active()).toBe('priority');
  for (const expected of [
    'dialog-close',
    'slots:first',
    'slots:last',
    'after',
  ]) {
    await page.keyboard.press('Tab');
    expect(await active()).toBe(expected);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await active()).toBe('slots:last');
});

it('enters the first iframe control during initial focus, including a frame loaded later (#460)', async () => {
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await page.waitForFunction(
    () =>
      !!document
        .querySelector<HTMLIFrameElement>('#frame')
        ?.contentDocument?.getElementById('two'),
  );
  expect(await active()).toBe('frame:one');
  await page.keyboard.press('Tab');
  expect(await active()).toBe('frame:two');
  await page.keyboard.press('Tab');
  expect(await active()).toBe('after');
  await page.keyboard.press('Shift+Tab');
  expect(await active()).toBe('frame:two');
});

it('skips unrendered slot fallback during initial focus (#625)', async () => {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  expect(
    await page.locator('#text').evaluate((host) =>
      host
        .shadowRoot!.querySelector('slot')!
        .assignedNodes()
        .map((node) => node.nodeType),
    ),
  ).toEqual([3]);
  expect(await active()).toBe('after');
});

it('visits visible shadow controls when their host has visibility hidden (#625)', async () => {
  await page.getByRole('button', { name: 'Visible', exact: true }).click();
  expect(await active()).toBe('visible:inside');
  await page.keyboard.press('Tab');
  expect(await active()).toBe('after');
  await page.keyboard.press('Shift+Tab');
  expect(await active()).toBe('visible:inside');
});
