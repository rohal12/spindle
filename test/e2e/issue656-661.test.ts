import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';
import type { StoryAPI } from '../../types/index';
declare const Story: StoryAPI;

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-656-661-'));
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Review fixes 656–661

:: StoryData
{"ifid":"65666100-0000-4000-8000-000000000000","format":"spindle","start":"Start"}

:: StoryVariables
$n = 0
$foo = "resolved"
$date = new Date("2020-01-01")

:: Components [script]
for (const name of ['if', 'switch', 'timed']) {
  Story.defineMacro({name, block:true, render(props, ctx) {
    return ctx.wrap(ctx.h('div', {'data-custom':name}, ctx.renderNodes(props.children)));
  }});
}

:: Start
{.badge#if-body if}visible if{/if}
{.badge#switch-body switch}visible switch{/switch}
{.badge#timed-body timed}visible timed{/timed}
<div id="host">{button "Invisible"}{set $n += 1}{/button}<span slot="named">Named light text</span>Default text</div>
<div id="escaped" title="{$\\u0066oo}" onclick="window.result='{$\\u0066oo}'" pattern="{$\\u0066oo}" srcdoc="{$\\u0066oo}">Click</div>
{textbox $date} [[Next]]

:: Next
End
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
  await page.evaluate(() => Story.waitForActions());
});

it('renders custom branching replacements with their selectors and bodies (#656)', async () => {
  for (const name of ['if', 'switch', 'timed']) {
    const wrapper = page.locator(`#${name}-body.badge`);
    expect(await wrapper.textContent()).toBe(`visible ${name}`);
  }
  expect(await page.locator('.error').count()).toBe(0);
});

it('isolates action values from live state and recorded history (#658)', async () => {
  const years = await page.evaluate(async () => {
    const value = Story.getActions().find((a) => a.type === 'textbox')!
      .value as Date;
    value.setUTCFullYear(1999);
    const current = (Story.get('date') as Date).getUTCFullYear();
    Story.goto('Next');
    await Story.waitForActions();
    Story.back();
    await Story.waitForActions();
    return [current, (Story.get('date') as Date).getUTCFullYear()];
  });
  expect(years).toEqual([2020, 2020]);
});

it('observes rendered shadow nodes, assigned text, slots and fallback (#659)', async () => {
  await page.locator('#host').evaluate((host) => {
    // Markdown wraps the authored body; slot assignment needs a direct child.
    host.append(host.querySelector('[slot="named"]')!);
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<p>Shadow text only</p><span class="error">Shadow error</span>';
  });
  let observed = await page.evaluate(() => Story.observe());
  expect(observed.text).toContain('Shadow text only');
  expect(observed.text).not.toContain('Invisible');
  expect(observed.text).not.toContain('Default text');
  expect(observed.actions.map((a) => a.label)).not.toContain('Invisible');
  expect(observed.errors).toContain('Shadow error');
  expect(
    await page.getByRole('button', { name: 'Invisible' }).isVisible(),
  ).toBe(false);

  await page.locator('#host').evaluate((host) => {
    host.shadowRoot!.innerHTML =
      '<slot name="named"><span class="error">Unused fallback</span></slot><slot name="empty"><span class="error">Fallback error</span></slot><slot></slot>';
  });
  observed = await page.evaluate(() => Story.observe());
  expect(observed.text).toContain('Named light text');
  expect(observed.text).toContain('Default text');
  expect(observed.text).not.toContain('Unused fallback');
  expect(observed.errors).toContain('Fallback error');
  expect(observed.errors).not.toContain('Unused fallback');
  expect(observed.actions.map((a) => a.label)).toContain('Invisible');
  await page.getByRole('button', { name: 'Invisible' }).click();
  expect(await page.evaluate(() => Story.get('n'))).toBe(1);

  await page.locator('#host').evaluate((host) => {
    host.querySelector('[slot="named"]')!.remove();
    host.shadowRoot!.querySelector<HTMLSlotElement>(
      'slot:not([name])',
    )!.style.visibility = 'hidden';
  });
  observed = await page.evaluate(() => Story.observe());
  expect(observed.errors).toContain('Unused fallback');
  expect(observed.text).not.toContain('Default text');
  expect(observed.actions.map((a) => a.label)).not.toContain('Invisible');
});

it.each(['aria-hidden="true"', 'class="dialog-overlay"'])(
  'preserves observation filters on nested fallback slots: %s (#659)',
  async (filter) => {
    await page.locator('#host').evaluate((host, attribute) => {
      host.attachShadow({ mode: 'open' }).innerHTML =
        `<slot name="outer"><slot name="inner" ${attribute}><span class="error">Filtered fallback</span></slot></slot>`;
    }, filter);
    let observed = await page.evaluate(() => Story.observe());
    expect(observed.text).not.toContain('Filtered fallback');
    expect(observed.errors).not.toContain('Filtered fallback');

    await page.locator('#host').evaluate((host) => {
      const inner = host.shadowRoot!.querySelector('slot[name="inner"]')!;
      inner.removeAttribute('aria-hidden');
      inner.removeAttribute('class');
    });
    observed = await page.evaluate(() => Story.observe());
    expect(observed.text).toContain('Filtered fallback');
    expect(observed.errors).toContain('Filtered fallback');
  },
);

it('resolves escaped variable roots before executing authored handlers (#661)', async () => {
  for (const name of ['title', 'pattern', 'srcdoc']) {
    expect(await page.locator('#escaped').getAttribute(name)).toBe('resolved');
  }
  await page.locator('#escaped').click();
  expect(
    await page.evaluate(() => (window as unknown as { result: string }).result),
  ).toBe('resolved');
});
