/**
 * E2E tests for how author HTML is parsed, in a real browser: happy-dom
 * neither loads images nor runs inline handlers, and constructs custom
 * elements in every document, so it can't show whether parsing is inert.
 *
 * Each test boots a story built from dist/format.js (the global setup builds
 * it) with its own <tw-storydata>.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { StoryAPI } from '../../types/index';
declare const Story: StoryAPI;

const projectRoot = resolve(import.meta.dirname!, '../..');
const STORY_URL = 'http://spindle.test/story.html';

let browser: Browser;
let page: Page;
let template: string;

/** Escape passage text as Twine and Tweego write it into story data. */
function encode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface StoryOptions {
  /** Passage name → its <tw-passagedata> content, as written into the HTML. */
  passages: Record<string, string>;
  script?: string;
}

/**
 * Boot a story in a new page, its start passage the first one, and wait for
 * the passage.
 */
async function boot({ passages, script = '' }: StoryOptions) {
  await page?.close();
  page = await browser.newPage();
  const all = { ...passages, StoryVariables: passages.StoryVariables ?? '' };
  const data =
    '<tw-storydata name="Probe" startnode="1" ifid="00000000-0000-4000-8000-000000000000" format="spindle" format-version="0">' +
    `<script role="script" id="twine-user-script" type="text/twine-javascript">${script}</script>` +
    Object.entries(all)
      .map(
        ([name, content], i) =>
          `<tw-passagedata pid="${i + 1}" name="${name}" tags="">${content}</tw-passagedata>`,
      )
      .join('') +
    '</tw-storydata>';
  const html = template
    .replace('{{STORY_NAME}}', () => 'Probe')
    .replace('{{STORY_DATA}}', () => data);
  await page.route(STORY_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.goto(STORY_URL);
  await page.waitForSelector('[data-passage]');
}

beforeAll(async () => {
  const formatJs = readFileSync(resolve(projectRoot, 'dist/format.js'), 'utf8');
  const json = formatJs.slice(
    formatJs.indexOf('(') + 1,
    formatJs.lastIndexOf(')'),
  );
  template = (JSON.parse(json) as { source: string }).source;
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

it('lets an asynchronous action wait for its rendered destination (#701)', async () => {
  await boot({
    passages: {
      Start: '{async-control}',
      Next: '{button "Ready"}Ready{/button}',
    },
    script: `Story.defineMacro({
      name: 'async-control',
      render(props, ctx) {
        const perform = async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          Story.goto('Next');
          const controls = await Story.waitForActions({ includeRunningActions: false });
          window.finished = controls.some(action => action.label === 'Ready');
        };
        const id = ctx.useAction({ type: 'button', key: 'async', label: 'Async', perform });
        return ctx.h('button', { 'data-action': id, onClick: perform }, 'Async');
      },
    });`,
  });
  const observation = await page.evaluate(async () => {
    return Promise.race([
      Story.step('button:async'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Action deadlocked')), 1000),
      ),
    ]);
  });
  expect(observation.passage).toBe('Next');
  expect(await page.evaluate(() => (window as any).finished)).toBe(true);
  // The outer default wait still completes after the action's render-only wait.
  expect(
    await page.evaluate(async () => (await Story.waitForActions()).length),
  ).toBeGreaterThan(0);
});

it.each([undefined, 'old-seed'])(
  'restores a reseeded history moment after reload from %s (#702)',
  async (seed) => {
    await boot({ passages: { Start: 'Start', Next: 'Next', End: 'End' } });
    await page.evaluate(async (seed) => {
      Story.setTransition({ type: 'none' });
      if (seed) Story.prng.init(seed, false);
      Story.goto('Next');
      await Story.waitForActions();
      Story.prng.init('reseed', false);
      Story.goto('End');
      await Story.waitForActions();
    }, seed);
    await page.reload();
    await page.waitForSelector('[data-passage="End"]');
    const result = await page.evaluate(async () => {
      Story.back();
      await Story.waitForActions();
      return {
        passage: Story.passage,
        seed: Story.prng.seed,
        enabled: Story.prng.isEnabled(),
      };
    });
    expect(result).toEqual({ passage: 'Next', seed: 'reseed', enabled: true });
  },
);

describe('HTML text-only elements (#703)', () => {
  it('keeps title and raw fallback bodies literal', async () => {
    await boot({
      passages: {
        Start: encode(
          '<title id="literal-title">Hello <b>world</b> &amp; rest</title>' +
            '<xmp id="literal-xmp">Hello <b>world</b> &amp; rest</xmp>' +
            '<iframe id="literal-frame">Hello <b>world</b> &amp; rest</iframe>',
        ),
      },
    });
    expect(await page.locator('#literal-title').textContent()).toBe(
      'Hello <b>world</b> & rest',
    );
    for (const id of ['literal-xmp', 'literal-frame']) {
      expect(await page.locator(`#${id}`).textContent()).toBe(
        'Hello <b>world</b> &amp; rest',
      );
      expect(await page.locator(`#${id} > *`).count()).toBe(0);
    }
  });

  it('boots scripts and styles with tag-shaped strings and preserves textarea defaults', async () => {
    await boot({
      passages: {
        Start: encode(
          '<script>window.tagSample = "<b>";</script>' +
            '<style>#sample::after { content: "<b> &amp;"; }</style>' +
            '<div id="sample">Sample</div>' +
            '<textarea id="literal">Hello <b>world</b> &amp; rest</textarea>' +
            '<textarea id="active">{print "<i>"}<!-- literal --></textarea>',
        ),
      },
    });
    expect(await page.evaluate(() => (window as any).tagSample)).toBe('<b>');
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('#sample')!, '::after')
            .content,
      ),
    ).toBe('"<b> &amp;"');
    expect(await page.locator('#literal').inputValue()).toBe(
      'Hello <b>world</b> & rest',
    );
    expect(await page.locator('#literal > *').count()).toBe(0);
    expect(await page.locator('#active').inputValue()).toBe(
      '<i><!-- literal -->',
    );
  });
});

describe('HTML in markdown output is parsed inertly', () => {
  /**
   * Passage markup parses every tag itself, so raw HTML reaches micromark's
   * output from text nodes a custom macro renders: `{raw …}` renders its
   * arguments as such a text node.
   */
  const RAW_MACRO = `
    Story.defineMacro({ name: 'raw', render: (props, ctx) =>
      ctx.renderNodes([{ type: 'text', value: props.rawArgs }]) });`;

  it('constructs a custom element only when it is rendered', async () => {
    await boot({
      passages: { Start: encode('{raw **Probe** <x-probe a.b>}') },
      script: `${RAW_MACRO}
        window.constructed = 0;
        customElements.define('x-probe', class extends HTMLElement {
          constructor() { super(); window.constructed++; }
        });`,
    });
    await page.waitForSelector('x-probe', { state: 'attached' });
    const { constructed, rendered } = await page.evaluate(() => ({
      constructed: (window as unknown as { constructed: number }).constructed,
      rendered: document.querySelectorAll('x-probe').length,
    }));
    expect(rendered).toBe(1);
    expect(constructed).toBe(rendered);
  });

  it('runs an inline handler only on the rendered element', async () => {
    await boot({
      passages: {
        Start: encode(
          '{raw **Probe** <img src="data:," a.b onerror="seen(this)">}',
        ),
      },
      script: `${RAW_MACRO}
        window.runs = { live: 0, detached: 0 };
        window.seen = (el) => el.isConnected ? runs.live++ : runs.detached++;`,
    });
    await page.waitForFunction(
      () => (window as unknown as { runs: { live: number } }).runs.live > 0,
    );
    const runs = await page.evaluate(
      () => (window as unknown as { runs: unknown }).runs,
    );
    expect(runs).toEqual({ live: 1, detached: 0 });
  });
});

describe('passage data', () => {
  it.each([false, true])(
    'executes inline script text with nobr=%s and keeps snapshots inert (#664)',
    async (nobr) => {
      const code =
        '\nwindow.inlineRuns = (window.inlineRuns || 0) + 1;\nwindow.literal = "&amp;lt;";\n';
      await boot({
        passages: {
          Start: encode(
            `<div><script id="inline">${code}</script>Hi</div>[[Next]]`,
          ),
          Next: 'Next',
        },
        script: `Story.setNobr(${nobr});`,
      });
      expect(
        await page
          .locator('#inline')
          .evaluate((el) => (el as HTMLScriptElement).text),
      ).toBe(code);
      expect(
        await page.evaluate(() => {
          const w = window as unknown as {
            inlineRuns: number;
            literal: string;
          };
          return [w.inlineRuns, w.literal];
        }),
      ).toEqual([1, '&amp;lt;']);
      await page.evaluate(() => {
        Story.setTransition({ type: 'crossfade', duration: 5000 });
        Story.goto('Next');
      });
      await page.locator('.passage-snapshot').waitFor();
      expect(
        await page.evaluate(
          () => (window as unknown as { inlineRuns: number }).inlineRuns,
        ),
      ).toBe(1);
      expect(
        await page.locator('.passage-snapshot script').getAttribute('type'),
      ).not.toBeNull();
    },
  );

  it.each(['listbox', 'cycle'])(
    'boots and edits the surviving option consumer after replacing %s (#665)',
    async (replaced) => {
      const surviving = replaced === 'cycle' ? 'listbox' : 'cycle';
      await boot({
        passages: {
          Start: encode(
            `{${surviving} $weapon}{option "Sword"}{option "Bow"}{/${surviving}}`,
          ),
          StoryVariables: '$weapon = "Sword"',
        },
        script: `Story.defineMacro({ name:'${replaced}', block:true, render(){ return null; } });`,
      });
      if (surviving === 'cycle')
        await page.getByRole('button', { name: 'Sword' }).click();
      else await page.locator('select').selectOption('Bow');
      expect(await page.evaluate(() => Story.get('weapon'))).toBe('Bow');
      expect(await page.locator('.error').count()).toBe(0);
    },
  );

  it('boots escaped members and computed targets and deletes a computed unset receiver (#666, #668, #669)', async () => {
    await boot({
      passages: {
        Start: encode(
          String.raw`{computed $\u0078 = 42}<span id="computed">{$x}</span><span id="length">{print $s.len\u0067th}</span>{unset $items[$idx]}<span id="items">{print $items.join(",")}</span>`,
        ),
        StoryVariables: '$x = 0\n$s = "abc"\n$items = ["one", "two"]\n$idx = 0',
      },
    });
    expect(await page.locator('#computed').textContent()).toBe('42');
    expect(await page.locator('#length').textContent()).toBe('3');
    expect(await page.locator('#items').textContent()).toBe(',two');
    expect(await page.locator('.error').count()).toBe(0);
  });

  /**
   * The value of `attribute` on the element with `id` in the passage shown.
   * Not encoded, the passage data holds such an element too.
   */
  const attributeOf = (id: string, attribute: string) =>
    page.getAttribute(`[data-passage] #${id}`, attribute, { timeout: 2000 });

  it('reads a no-break space as U+00A0', async () => {
    await boot({
      passages: {
        Start: encode(
          '{set _s = "a b"}<span id="n">{print _s === "a\\u00A0b"}</span>',
        ),
      },
    });
    expect(await page.textContent('[data-passage] #n')).toBe('true');
  });

  it('keeps quotes in attribute values of HTML that is not encoded', async () => {
    await boot({
      passages: {
        // As a compiler that doesn't HTML-escape passage text writes it
        Start:
          `<i id="a" title='say "hi"'>a</i>` +
          `<i id="b" title="it's &quot;x&quot;">b</i>` +
          `<i id="c" title="{print 'p' + &quot;q&quot;} it's">c</i>`,
      },
    });
    expect(await attributeOf('a', 'title')).toBe('say "hi"');
    expect(await attributeOf('b', 'title')).toBe(`it's "x"`);
    expect(await attributeOf('c', 'title')).toBe(`pq it's`);
  });

  it('keeps literal entities in text and attributes as written (#526)', async () => {
    await boot({
      passages: {
        // The browser's parse gives title and text the string `&lt;`
        Start: '<span id="example" title="&amp;lt;">&amp;lt;</span>',
      },
    });
    expect(await page.textContent('[data-passage] #example')).toBe('&lt;');
    expect(await attributeOf('example', 'title')).toBe('&lt;');
  });

  it('keeps escaped markup lookalikes as text, and bare ampersands (#526)', async () => {
    await boot({
      passages: {
        Start:
          '<p id="a">&lt;b&gt;x&lt;/b&gt; &amp;amp; Tom &amp; Jerry</p>' +
          '<i id="c" title="&amp;quot; &amp; {print 1 + 1}">c</i>',
      },
    });
    expect(await page.textContent('[data-passage] #a')).toBe(
      '<b>x</b> &amp; Tom & Jerry',
    );
    expect(await page.locator('[data-passage] #a b').count()).toBe(0);
    expect(await attributeOf('c', 'title')).toBe('&quot; & 2');
  });

  it('leaves the text of a style element as written (#526)', async () => {
    await boot({
      passages: {
        Start:
          '<style>#s::after { content: "&amp;lt;" }</style><b id="s">s</b>',
      },
    });
    const content = await page.evaluate(
      () => getComputedStyle(document.querySelector('#s')!, '::after').content,
    );
    expect(content).toBe('"&amp;lt;"');
  });

  it('keeps literal entities in preformatted, SVG and raw-text elements (#526)', async () => {
    await boot({
      passages: {
        Start:
          '<pre id="p">&amp;lt; &amp; &lt;</pre>' +
          '<textarea id="t">&amp;lt; &amp; &lt;</textarea>' +
          '<svg><text id="v">&amp;lt; &amp; &lt;</text></svg>' +
          '<script id="s">a &amp;lt; b && c</script>' +
          '<iframe id="f">&amp;lt; &amp;</iframe>',
      },
    });
    const text = (id: string) =>
      page.evaluate(
        (sel) => document.querySelector(`[data-passage] #${sel}`)!.textContent,
        id,
      );
    expect(await text('p')).toBe('&lt; & <');
    expect(await text('t')).toBe('&lt; & <');
    expect(await text('v')).toBe('&lt; & <');
    expect(await text('s')).toBe('a &amp;lt; b && c');
    expect(await text('f')).toBe('&amp;lt; &amp;');
  });

  it('keeps the arguments of macros in text as written (#526)', async () => {
    await boot({
      passages: {
        Start: '<p id="m">{if 2 < 3 && 3 > 2}yes{/if}</p>',
      },
    });
    expect(await page.textContent('[data-passage] #m')).toBe('yes');
  });
});

describe('native form defaults and edits (#528)', () => {
  it('restores the passage defaults on reset', async () => {
    await boot({
      passages: {
        Start:
          '<form><input id="text" value="Guest"><input id="check" type="checkbox" checked><button id="reset" type="reset">Reset</button></form>',
      },
    });
    expect(
      await page.evaluate(() => {
        const text = document.querySelector<HTMLInputElement>('#text')!;
        const check = document.querySelector<HTMLInputElement>('#check')!;
        return [text.defaultValue, text.value, check.defaultChecked];
      }),
    ).toEqual(['Guest', 'Guest', true]);
    await page.fill('#text', 'Alice');
    await page.uncheck('#check');
    await page.click('#reset');
    expect(await page.inputValue('#text')).toBe('Guest');
    expect(await page.isChecked('#check')).toBe(true);
  });

  it('keeps the reader edits after the store updates', async () => {
    await boot({
      passages: {
        Start:
          `<input id="text" value="Guest" oninput="Story.set('typed', this.value)">` +
          `<input id="check" type="checkbox" checked onchange="Story.set('flag', this.checked)">` +
          '<span id="out">{$typed}|{$flag}</span>',
        StoryVariables: '$typed = ""\n$flag = true',
      },
    });
    await page.fill('#text', 'Alice');
    await page.uncheck('#check');
    await page.waitForFunction(
      () => document.querySelector('#out')?.textContent === 'Alice|false',
    );
    expect(await page.inputValue('#text')).toBe('Alice');
    expect(await page.isChecked('#check')).toBe(false);
  });

  it('keeps an interpolated value bound to its variable', async () => {
    await boot({
      passages: {
        Start:
          '<input id="text" value="{$name}"><button id="b" onclick="Story.set(\'name\', \'Bob\')">Go</button>',
        StoryVariables: '$name = "Ann"',
      },
    });
    expect(await page.inputValue('#text')).toBe('Ann');
    await page.fill('#text', 'typed');
    await page.click('#b');
    await page.waitForFunction(
      () => document.querySelector<HTMLInputElement>('#text')!.value === 'Bob',
    );
  });
});
