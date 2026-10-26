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
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-646-651-'));
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Review regressions

:: StoryData
{"ifid":"64665100-0000-4000-8000-000000000000","format":"spindle","start":"Start"}

:: StoryVariables
$n = 0

:: Components [script]
Story.defineMacro({name:'if', block:true,
  parameters:[{name:'label', type:'text', holds:'text'}],
  render(props, ctx) { return ctx.args.label; }});
Story.defineMacro({name:'dialog', block:true, render() { return 'Custom dialog'; }});
Story.defineMacro({name:'print', render(props) { return props.rawArgs; }});
Story.defineMacro({name:'textbox',
  parameters:[{name:'label', type:'text', holds:'text'}],
  render(props, ctx) { return ctx.args.label; }});
Story.defineMacro({name:'shadow', render(props, ctx) {
  const host = ctx.hooks.useRef(null);
  const control = ctx.hooks.useRef(null);
  const key = props.rawArgs;
  ctx.hooks.useLayoutEffect(() => {
    const root = host.current.attachShadow({mode:'open'});
    const button = document.createElement('button');
    button.textContent = key;
    if (key === 'slotted') {
      root.innerHTML = '<div hidden><slot></slot></div>';
      host.current.append(button);
    } else root.append(button);
    if (key === 'hidden' || key === 'inert') host.current.setAttribute(key, '');
    if (key === 'display') host.current.style.display = 'none';
    control.current = button;
  }, []);
  ctx.useAction({type:'button', key, label:key, element:control, perform() {}});
  return ctx.h('div', {ref:host, 'data-shadow':key});
}});

:: StoryInit
{widget "Later"}{button "Forwarded"}{@children}{/button}{/widget}
{widget "span"}{timed 150ms}{set $n += 1}{/timed}{/widget}

:: Start
{if Hello world}ignored{/if}
{dialog "Caption"}ordinary text{/dialog}
{print hello world}
{textbox "$missing"}
{Later}{timed 150ms}{set $n += 1}{/timed}{/Later}
{button "Replacement"}{span}{/button}
{shadow hidden}{shadow inert}{shadow display}{shadow slotted}{shadow visible}
<div onclick="console.log('${'{$x '.repeat(2000)}')">Literal event attribute</div>

:: Numeric
${'1'.repeat(80000)}
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

it('boots with replacement contracts and literal code attributes (#641, #647, #648)', async () => {
  const text = await page.locator('.passage').textContent();
  expect(text).toContain('Hello world');
  expect(text).toContain('Custom dialog');
  expect(text).toContain('hello world');
  expect(text).toContain('$missing');
  expect(await page.locator('.error').count()).toBe(0);
});

it.each(['Forwarded', 'Replacement'])(
  'retains the %s timer after clicking (#646)',
  async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => Story.get('n') === 1);
  },
);

it('cancels forwarded work when its passage leaves (#646)', async () => {
  await page.getByRole('button', { name: 'Forwarded', exact: true }).click();
  await page.evaluate(() => Story.goto('Numeric'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => Story.get('n'))).toBe(0);
});

it('observes only visible shadow actions, including slotted content (#650)', async () => {
  const actions = await page.evaluate(() =>
    Story.observe().actions.map((action) => action.label),
  );
  expect(
    actions.filter((label) =>
      ['hidden', 'inert', 'display', 'slotted', 'visible'].includes(label),
    ),
  ).toEqual(['visible']);
  expect(await page.locator('[data-shadow="hidden"] button').isVisible()).toBe(
    false,
  );
  expect(await page.locator('[data-shadow="slotted"] button').isVisible()).toBe(
    false,
  );
  await page
    .locator('[data-shadow="hidden"]')
    .evaluate((host) => host.removeAttribute('hidden'));
  expect(
    await page.evaluate(() =>
      Story.observe().actions.map((action) => action.label),
    ),
  ).toContain('hidden');
});

it('renders 80,000 digits promptly in Chromium (#649)', async () => {
  const elapsed = await page.evaluate(async () => {
    const start = performance.now();
    Story.goto('Numeric');
    await Story.waitForActions();
    return performance.now() - start;
  });
  expect(elapsed).toBeLessThan(1500);
  expect((await page.locator('.passage').textContent())?.trim()).toBe(
    '1'.repeat(80000),
  );
});
