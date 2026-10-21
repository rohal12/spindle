import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileToFile } from '@rohal12/twee-ts';

let directory: string;
let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-601-609-'));
  const source = resolve(directory, 'story.twee');
  const original = `Hello <button onclick="window.answer='hello world from here'">press</button> next words here.`;
  const toolingUrl = pathToFileURL(resolve('dist/pkg/tooling.js')).href;
  const { formatPassage } = (await import(
    toolingUrl
  )) as typeof import('../../src/tooling');
  const formatted = await formatPassage(original, { maxLineLength: 25 });
  const multiline = original.replace('<button ', '<button\n ');
  const formattedMultiline = await formatPassage(multiline, {
    maxLineLength: 25,
  });
  writeFileSync(
    source,
    `:: StoryTitle
Review regressions

:: StoryData
{"ifid":"60160900-0000-4000-8000-000000000000","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables
$n = 0

:: Script [script]
Story.defineMacro({name:'caption', parameters:[{name:'value', type:'string', holds:'markup'}], render(props, ctx) {return ctx.resolve(ctx.args.value);}});
window.constructed = 0;
window.connected = 0;
customElements.define('story-counter', class extends HTMLElement {
  constructor() {
    super(); window.constructed++; Story.set('n', Number(Story.get('n')) + 1);
    this.attachShadow({mode:'open'}).innerHTML = '<style>.shadow {font-size:23px} story-mark::before {content:"Shadow badge";color:rgb(12,34,56)}</style><slot></slot><span class="shadow">Shadow content</span><story-mark class="shadow-mark"></story-mark><input class="shadow-input"><div class="shadow-scroll" style="overflow:auto;width:20px;height:20px"><div style="height:100px">Scroll</div></div>';
  }
  connectedCallback() { window.connected++; }
});
customElements.define('story-button', class extends HTMLButtonElement {
  constructor() { super(); window.constructed++; Story.set('n', Number(Story.get('n')) + 1); }
  connectedCallback() { window.connected++; }
}, {extends:'button'});

:: Styles [stylesheet]
story-counter { display: block; color: rgb(123, 45, 67); padding: 7px; }
story-counter > b { display: block; color: rgb(23, 45, 67); }
story-counter::before { content: "★"; color: rgb(12, 34, 56); }
story-counter::after { content: "End component"; color: rgb(12, 34, 56); }
story-counter > b::after { content: "After component"; color: rgb(12, 34, 56); }
[is="story-button"]::before { content: "Button badge"; color: rgb(12, 34, 56); }
story-list-item { display: list-item; margin-left: 60px; }
story-list-item::marker { content: "Badge: "; color: rgb(12, 34, 56); }
.tail:last-child { color: rgb(255, 0, 0); }

:: StoryInit
{do}
Story.defineMacro({name:'caption', parameters:[{name:'value', type:'string'}], render(props, ctx) {return 'INIT:' + ctx.args.value;}});
{/do}
{widget "label" @value:text}{print @value}{/widget}

:: Widgets [widget]
{widget "label" @obsolete:markup}{print @obsolete}{/widget}

:: Start
{caption "{$missing}"} {label "{$alsoMissing}"}

:: Custom
<story-counter class="counter"><b xml:lang="en">Component content</b><story-list-item class="marker">Message</story-list-item></story-counter>

:: Next
Next {$n}

:: DisplayDialog
{passage}

:: Original
${original}

:: Formatted
${formatted}

:: OriginalMultiline
${multiline}

:: FormattedMultiline
${formattedMultiline}
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
  await page.waitForFunction(() => document.querySelector('.passage'));
  await page.evaluate(() => {
    (window as any).Story.setTransition({ type: 'none' });
    return (window as any).Story.waitForActions();
  });
});

it('boots with the effective macro and widget definitions (#601, #609)', async () => {
  expect(await page.locator('.passage').textContent()).toContain(
    'INIT:{$missing} {$alsoMissing}',
  );
  expect(await page.locator('.error').count()).toBe(0);
});

it.each(['fade-through', 'crossfade'])(
  'keeps custom-element lifecycles out of %s snapshots (#607)',
  async (type) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(async () => {
      const Story = (window as any).Story;
      Story.goto('Custom');
      await Story.waitForActions();
      // Cover customized built-ins both with and without their authored `is`.
      for (const keepAttribute of [true, false]) {
        const button = document.createElement('button', { is: 'story-button' });
        button.setAttribute('is', 'story-button');
        if (!keepAttribute) button.removeAttribute('is');
        button.className = 'customized';
        button.classList.add(keepAttribute ? 'with-is' : 'without-is');
        button.textContent = 'Custom button';
        document.querySelector('.passage')!.appendChild(button);
      }
      const script = document.createElement('script');
      script.textContent = 'window.scriptRuns = (window.scriptRuns || 0) + 1';
      document.querySelector('.passage')!.appendChild(script);
      const file = document.createElement('input');
      file.type = 'file';
      file.className = 'native-file';
      const selection = new DataTransfer();
      selection.items.add(new File(['chosen content'], 'picked.txt'));
      file.files = selection.files;
      document.querySelector('.passage')!.appendChild(file);
      const tail = document.createElement('p');
      tail.className = 'tail';
      tail.textContent = 'Final paragraph';
      document.querySelector('.passage')!.appendChild(tail);
      const shadow = document.querySelector('story-counter')!.shadowRoot!;
      shadow.querySelector('input')!.value = 'edited shadow value';
      shadow.querySelector('.shadow-scroll')!.scrollTop = 35;
    });
    expect(
      await page.evaluate(() => [
        (window as any).constructed,
        (window as any).connected,
        (window as any).Story.get('n'),
      ]),
    ).toEqual([3, 3, 3]);
    const pseudos = [
      ['.counter', '::before', '"★"'],
      ['.counter', '::after', '"End component"'],
      ['.counter b', '::after', '"After component"'],
      ['.customized.with-is', '::before', '"Button badge"'],
      ['.counter .shadow-mark', '::before', '"Shadow badge"'],
      ['.counter .marker', '::marker', '"Badge: "'],
    ] as const;
    const checkPseudos = async (root: string) => {
      for (const [selector, pseudo, content] of pseudos) {
        expect(
          await page.locator(`${root} ${selector}`).evaluate((el, pseudo) => {
            const style = getComputedStyle(el, pseudo);
            return [style.content, style.color];
          }, pseudo),
        ).toEqual([content, 'rgb(12, 34, 56)']);
      }
    };
    await checkPseudos('.passage');
    const sheetsBefore = await page.evaluate(
      () => document.adoptedStyleSheets.length,
    );
    await page.evaluate((type) => {
      (window as any).Story.setTransition({ type, duration: 1000 });
      (window as any).Story.goto('Next');
    }, type);
    await page.locator('.passage-snapshot').waitFor();
    expect(
      await page.locator('.passage-snapshot .tail').evaluate((el) => {
        return getComputedStyle(el).color;
      }),
    ).toBe('rgb(255, 0, 0)');
    await checkPseudos('.passage-snapshot');
    expect(
      await page.evaluate(() => [
        (window as any).constructed,
        (window as any).connected,
        (window as any).Story.get('n'),
        (window as any).scriptRuns,
      ]),
    ).toEqual([3, 3, 3, 1]);
    expect(
      await page.locator('.passage-snapshot .counter b').textContent(),
    ).toBe('Component content');
    expect(
      await page
        .locator('.passage-snapshot .counter b')
        .getAttribute('xml:lang'),
    ).toBe('en');
    expect(
      await page
        .locator('.passage-snapshot .native-file')
        .evaluate((element) => (element as HTMLInputElement).files?.[0]?.name),
    ).toBe('picked.txt');
    expect(
      await page.locator('.passage-snapshot .counter b').evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.display, style.color];
      }),
    ).toEqual(['block', 'rgb(23, 45, 67)']);
    expect(
      await page.locator('.passage-snapshot .counter .shadow').textContent(),
    ).toBe('Shadow content');
    expect(
      await page
        .locator('.passage-snapshot .counter .shadow')
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('23px');
    expect(
      await page.locator('.passage-snapshot .shadow-input').inputValue(),
    ).toBe('edited shadow value');
    expect(
      await page
        .locator('.passage-snapshot .shadow-scroll')
        .evaluate((element) => element.scrollTop),
    ).toBe(35);
    expect(
      await page.locator('.passage-snapshot .counter').evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.display, style.color, style.padding];
      }),
    ).toEqual(['block', 'rgb(123, 45, 67)', '7px']);
    expect(
      await page.locator('.passage-snapshot button.customized').count(),
    ).toBe(2);
    expect(await page.locator('.passage-snapshot [is]').count()).toBe(0);
    await page.waitForFunction(
      () => !document.querySelector('.passage-snapshot'),
    );
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(
      sheetsBefore,
    );
    expect(await page.locator('.passage').textContent()).toContain('Next 3');
    expect(
      await page.evaluate(() => [
        (window as any).constructed,
        (window as any).connected,
      ]),
    ).toEqual([3, 3]);
    expect(errors).toEqual([]);
  },
);

it('preserves click behavior when wrapping inline HTML (#608)', async () => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const passage of [
    'Original',
    'Formatted',
    'OriginalMultiline',
    'FormattedMultiline',
  ]) {
    await page.evaluate(async (passage) => {
      (window as any).answer = undefined;
      (window as any).Story.goto(passage);
      await (window as any).Story.waitForActions();
    }, passage);
    await page.locator('.passage button').click();
    expect(await page.evaluate(() => (window as any).answer)).toBe(
      'hello world from here',
    );
  }
  expect(errors).toEqual([]);
});

it.each(['fade-through', 'crossfade'])(
  'keeps embedded shadow documents passive in %s snapshots',
  async (type) => {
    await page.evaluate(async () => {
      const Story = (window as any).Story;
      Story.goto('Custom');
      await Story.waitForActions();
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const frame = document.createElement('iframe');
      frame.className = 'shadow-frame';
      frame.style.cssText = 'width:120px;height:60px;border:3px solid';
      frame.srcdoc =
        '<script>parent.shadowFrameRuns = (parent.shadowFrameRuns || 0) + 1</script>';
      shadow.appendChild(frame);
      document.querySelector('story-counter')!.shadowRoot!.appendChild(host);
      await new Promise<void>((done) => {
        frame.onload = () => done();
      });
    });
    expect(await page.evaluate(() => (window as any).shadowFrameRuns)).toBe(1);
    expect(
      await page.locator('.shadow-frame').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return [rect.width, rect.height];
      }),
    ).toEqual([126, 66]);
    await page.evaluate((type) => {
      (window as any).Story.setTransition({ type, duration: 1000 });
      (window as any).Story.goto('Next');
    }, type);
    await page.locator('.passage-snapshot').waitFor();
    expect(await page.locator('.passage-snapshot iframe').count()).toBe(0);
    const placeholder = page.locator('.passage-snapshot .shadow-frame');
    expect(await placeholder.evaluate((el) => el.localName)).toBe('div');
    const size = await placeholder.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return [rect.width, rect.height];
    });
    expect(size[0]).toBeCloseTo(126, 3);
    expect(size[1]).toBeCloseTo(66, 3);
    await page.waitForFunction(
      () => !document.querySelector('.passage-snapshot'),
    );
    expect(await page.evaluate(() => (window as any).shadowFrameRuns)).toBe(1);
  },
);

it('releases snapshot styles when displays unmount or transitions are cancelled', async () => {
  await page.evaluate(async () => {
    const Story = (window as any).Story;
    Story.goto('Custom');
    await Story.waitForActions();
    Story.openDialog('DisplayDialog');
    await Story.waitForActions();
  });
  const sheetsBefore = await page.evaluate(
    () => document.adoptedStyleSheets.length,
  );
  await page.evaluate(() => {
    (window as any).Story.setTransition({ type: 'crossfade', duration: 5000 });
    (window as any).Story.goto('Next');
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.passage-snapshot').length === 2,
  );
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(
    sheetsBefore + 2,
  );
  await page.evaluate(() => (window as any).Story.closeDialog());
  await page.waitForFunction(
    (count) => document.adoptedStyleSheets.length === count,
    sheetsBefore + 1,
  );
  await page.evaluate(async () => {
    const Story = (window as any).Story;
    Story.setTransition({ type: 'none' });
    Story.goto('Original');
    await Story.waitForActions();
  });
  expect(await page.locator('.passage-snapshot').count()).toBe(0);
  expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(
    sheetsBefore,
  );
});
