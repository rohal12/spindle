import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileToFile } from '@rohal12/twee-ts';

let directory: string;
let server: ReturnType<typeof createServer>;
let cssServer: ReturnType<typeof createServer>;
let cssUrl: string;
let browser: Browser;
let page: Page;
let baseUrl: string;

const illustration = `<svg class="illustration" xmlns:xlink="http://www.w3.org/1999/xlink" width="160" height="80" viewBox="0 0 160 80">
<defs>
<linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
<clipPath id="clip"><circle cx="40" cy="40" r="30"/></clipPath>
<mask id="mask"><rect width="160" height="80" fill="white"/></mask>
<filter id="filter"><feGaussianBlur stdDeviation="1"/></filter>
<rect id="shape" width="60" height="60" fill="url(#paint)"/>
<rect id="100%" width="10" height="10" fill="lime"/>
</defs>
<rect class="painted" width="80" height="80" fill="url(#paint)" clip-path="url(#clip)" mask="url(#mask)" filter="url(#filter)"/>
<use class="modern-use" href="#shape" x="80" y="10"/>
<use class="legacy-use" xlink:href="#shape" x="90" y="20"/>
<use class="percent-use" href="#100%" x="145"/>
<a class="external" href="other.svg#shape"><title>External reference</title></a>
</svg>`;

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'spindle-615-616-'));
  const source = resolve(directory, 'story.twee');
  writeFileSync(
    source,
    `:: StoryTitle
Snapshot regressions

:: StoryData
{"ifid":"61561600-0000-4000-8000-000000000000","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables

:: Styles [stylesheet]
#hero { color: rgb(255, 0, 0); font-size: 40px; }
#hero::before { content: "Hero: "; color: rgb(12, 34, 56); }
.passage .painted { stroke: url("#paint"); stroke-width: 2px; }
.passage li::marker { color: rgb(12, 34, 56); }

:: Start
# Heading

A paragraph with ${'`code`'}.

> A quotation

- A list item

| A | B |
| - | - |
| 1 | 2 |

<span id="hero" class="hero">Red hero</span>
${illustration}
[[Next]]

:: Next
<span id="hero">Incoming hero</span>
${illustration}
Next
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
  cssServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/css' });
    response.end('.imported-art { stroke: green }');
  });
  await new Promise<void>((done) => cssServer.listen(0, '127.0.0.1', done));
  cssUrl = `http://127.0.0.1:${(cssServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) =>
    server ? server.close(() => done()) : done(),
  );
  await new Promise<void>((done) =>
    cssServer ? cssServer.close(() => done()) : done(),
  );
  if (directory) rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await page?.close();
  page = await browser.newPage();
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.querySelector('.passage'));
  await page.evaluate(async () => {
    await (window as any).Story.waitForActions();
    for (const animation of document.querySelector('.passage')!.getAnimations())
      animation.finish();
  });
});

async function navigate(type: string) {
  await page.evaluate((type) => {
    const Story = (window as any).Story;
    Story.setTransition({ type, duration: 10_000 });
    Story.goto('Next');
  }, type);
  await page.locator('.passage-snapshot').waitFor();
  // Compare a settled passage with the outgoing animation at its first frame.
  await page.locator('.passage-snapshot').evaluate((element) => {
    for (const animation of element.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
}

it('navigates with an opaque imported stylesheet in the outgoing passage', async () => {
  await page.locator('.passage').evaluate(async (element, url) => {
    const style = document.createElement('style');
    const loaded = new Promise<void>((resolve, reject) => {
      style.onload = () => resolve();
      style.onerror = () => reject(new Error('Stylesheet failed to load'));
    });
    style.textContent = `@import url("${url}/art.css");`;
    element.appendChild(style);
    element.insertAdjacentHTML(
      'beforeend',
      '<svg class="imported-svg" width="40" height="40"><rect class="imported-art" width="40" height="40"/></svg>',
    );
    await loaded;
    const imported = (style.sheet!.cssRules[0] as CSSImportRule).styleSheet!;
    try {
      void imported.cssRules;
      throw new Error('Expected an opaque cross-origin stylesheet');
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'SecurityError')
        throw error;
    }
  }, cssUrl);
  await navigate('fade-through');
  expect(await page.locator('.passage-snapshot').count()).toBe(1);
  await page.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector('.passage-snapshot .imported-art')!,
      ).stroke === 'rgb(0, 128, 0)',
  );
});

async function visualStyles(root: string) {
  return page.locator(root).evaluate((root) => {
    const properties = [
      'color',
      'font-size',
      'font-weight',
      'margin-bottom',
      'padding-left',
      'background-color',
      'border-left-width',
    ];
    const styles = ['h1', 'p', 'code', 'blockquote', 'table', '.hero'].map(
      (selector) => {
        const style = getComputedStyle(root.querySelector(selector)!);
        return properties.map((name) => style.getPropertyValue(name));
      },
    );
    const pseudo = getComputedStyle(root.querySelector('.hero')!, '::before');
    const marker = getComputedStyle(root.querySelector('li')!, '::marker');
    return {
      styles,
      pseudo: [pseudo.content, pseudo.color],
      marker: marker.color,
    };
  });
}

async function visualPositions(root: string) {
  return page.locator(root).evaluate((root) =>
    ['h1', 'p', 'code', 'blockquote', 'table', '.hero', 'svg'].map(
      (selector) => {
        const bounds = root.querySelector(selector)!.getBoundingClientRect();
        return [bounds.x, bounds.y, bounds.width, bounds.height];
      },
    ),
  );
}

/** Decode screenshots in Chromium; compositor rounding may differ by one. */
async function pixelDifference(before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async (images) => {
      const [before, after] = await Promise.all(
        images.map(async (source) => {
          const image = new Image();
          image.src = `data:image/png;base64,${source}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height);
        }),
      );
      if (before!.width !== after!.width || before!.height !== after!.height)
        return 256;
      let difference = 0;
      for (let i = 0; i < before!.data.length; i++) {
        difference = Math.max(
          difference,
          Math.abs(before!.data[i]! - after!.data[i]!),
        );
      }
      return difference;
    },
    [before.toString('base64'), after.toString('base64')],
  );
}

it.each(['fade-through', 'crossfade'])(
  'preserves native and generated styles in %s snapshots (#615)',
  async (type) => {
    const before = await visualStyles('.passage');
    const positions = await visualPositions('.passage');
    expect(before.styles[5]![0]).toBe('rgb(255, 0, 0)');
    expect(before.pseudo).toEqual(['"Hero: "', 'rgb(12, 34, 56)']);
    await navigate(type);
    expect(await visualStyles('.passage-snapshot')).toEqual(before);
    const snapshotPositions = await visualPositions('.passage-snapshot');
    positions.forEach((bounds, index) => {
      bounds.forEach((value, coordinate) => {
        expect(snapshotPositions[index]![coordinate]).toBeCloseTo(value, 1);
      });
    });
    expect(
      await page.locator('.passage-snapshot').evaluate((element) => {
        return getComputedStyle(element).animationName;
      }),
    ).toBe('passage-fade-out');
    expect(await page.locator('.passage-snapshot #hero').count()).toBe(0);
  },
);

it.each(['fade-through', 'crossfade'])(
  'preserves styles selected by important passage rules in %s snapshots (#615)',
  async (type) => {
    await page.addStyleTag({
      content:
        'h1 { color: blue !important } .passage h1 { color: red !important }',
    });
    expect(
      await page.locator('.passage h1').evaluate((element) => {
        return getComputedStyle(element).color;
      }),
    ).toBe('rgb(255, 0, 0)');
    await navigate(type);
    expect(
      await page.locator('.passage-snapshot h1').evaluate((element) => {
        return getComputedStyle(element).color;
      }),
    ).toBe('rgb(255, 0, 0)');
  },
);

it.each(['fade-through', 'crossfade'])(
  'preserves inherited colors of SVG use instances in %s snapshots (#616)',
  async (type) => {
    await page.addStyleTag({
      content:
        '#fixed-tile { fill: gold } .passage .ancestor-only { fill: red }' +
        '[id="attribute-tile"] { fill: blue } x-card .custom-in-svg { fill: red }' +
        '@media all { .passage { .css-nested { fill: lime } } }' +
        '@layer { .layered { fill:red } .layered-important { fill:red!important } }' +
        '@layer named { .layered { fill:blue } .layered-important { fill:blue!important } }' +
        '#absent, .specific-tile { fill: gold } .specific-tile.extra { fill: green }',
    });
    await page
      .addStyleTag({
        content: 'svg { fill: purple !important }',
      })
      .then((style) =>
        style.evaluate((element) => {
          (element as HTMLStyleElement).sheet!.disabled = true;
        }),
      );
    await page.locator('.passage').evaluate((element) => {
      element.insertAdjacentHTML(
        'beforeend',
        '<svg class="inherited-svg" width="400" height="40">' +
          '<defs><rect id="tile" width="40" height="40"/>' +
          '<rect id="color-tile" width="40" height="40" fill="currentColor"/>' +
          '<rect id="fixed-tile" width="40" height="40"/>' +
          '<rect id="specific-tile" class="specific-tile extra" width="40" height="40"/>' +
          '<rect id="ancestor-tile" class="ancestor-only" width="40" height="40"/></defs>' +
          '<use href="#tile" fill="red"/>' +
          '<use href="#tile" x="40" fill="blue"/>' +
          '<use href="#color-tile" x="80" color="red"/>' +
          '<use href="#color-tile" x="120" color="blue"/>' +
          '<use href="#fixed-tile" x="160" fill="blue"/>' +
          '<use href="#ancestor-tile" x="200" fill="blue"/>' +
          '<rect class="css-nested" x="240" width="40" height="40"/>' +
          '<use href="#specific-tile" x="280"/>' +
          '<rect class="layered" x="320" width="40" height="40"/>' +
          '<rect class="layered-important" x="360" width="40" height="40"/></svg>',
      );
      const host = document.createElement('span');
      host.className = 'shadow-svg-host';
      host.attachShadow({ mode: 'open' }).innerHTML =
        '<style>#tile {fill:currentColor}</style>' +
        '<svg width="40" height="40"><defs><rect id="tile" width="40" height="40"/></defs>' +
        '<use href="#tile" color="red"/></svg>';
      const adopted = new CSSStyleSheet();
      adopted.replaceSync('#tile { stroke: lime; stroke-width: 2px }');
      host.shadowRoot!.adoptedStyleSheets = [adopted];
      element.appendChild(host);
      element.insertAdjacentHTML(
        'beforeend',
        '<x-card class="custom-svg-host"><svg width="80" height="40">' +
          '<rect id="attribute-tile" width="40" height="40"/>' +
          '<rect class="custom-in-svg" x="40" width="40" height="40"/></svg></x-card>',
      );
      element.insertAdjacentHTML(
        'beforeend',
        '<style>#local-tile {fill:red}</style><svg class="local-svg" width="40" height="40">' +
          '<rect id="local-tile" width="40" height="40"/></svg>',
      );
    });
    const before = await page.locator('.passage .inherited-svg').screenshot();
    const shadowBefore = await page
      .locator('.passage .shadow-svg-host svg')
      .screenshot();
    const customBefore = await page
      .locator('.passage .custom-svg-host svg')
      .screenshot();
    const localBefore = await page.locator('.passage .local-svg').screenshot();
    const stylesheets = () =>
      page.evaluate(() =>
        [...document.styleSheets]
          .filter(
            (sheet) =>
              !sheet.ownerNode ||
              !document.querySelector('.passage')?.contains(sheet.ownerNode),
          )
          .map((sheet) =>
            [...sheet.cssRules].map((rule) => rule.cssText).join('\n'),
          ),
      );
    const stylesBefore = await stylesheets();
    await navigate(type);
    const after = await page
      .locator('.passage-snapshot .inherited-svg')
      .screenshot();
    expect(await pixelDifference(before, after)).toBeLessThanOrEqual(1);
    const shadowAfter = await page
      .locator('.passage-snapshot .shadow-svg-host svg')
      .screenshot();
    expect(
      await pixelDifference(shadowBefore, shadowAfter),
    ).toBeLessThanOrEqual(1);
    const customAfter = await page
      .locator('.passage-snapshot .custom-svg-host svg')
      .screenshot();
    expect(
      await pixelDifference(customBefore, customAfter),
    ).toBeLessThanOrEqual(1);
    const localAfter = await page
      .locator('.passage-snapshot .local-svg')
      .screenshot();
    expect(await pixelDifference(localBefore, localAfter)).toBeLessThanOrEqual(
      1,
    );
    await page.evaluate(() => {
      const Story = (window as any).Story;
      Story.setTransition({ type: 'none' });
      Story.goto('Start');
    });
    await page.waitForFunction(
      () => !document.querySelector('.passage-snapshot'),
    );
    expect(await stylesheets()).toEqual(stylesBefore);
  },
);

it.each(['fade-through', 'crossfade'])(
  'preserves rendered SVG and local references in %s snapshots (#616)',
  async (type) => {
    await page.locator('.passage').evaluate((element) => {
      // Exercise a real namespaced xlink reference as well as modern href.
      const legacy = element.querySelector('.legacy-use')!;
      legacy.removeAttribute('href');
      legacy.setAttributeNS(
        'http://www.w3.org/1999/xlink',
        'xlink:href',
        '#shape',
      );
      const template = document.createElement('template');
      template.className = 'svg-template';
      template.innerHTML =
        '<svg><rect id="template-shape" width="10" height="10"/><use href="#template-shape"/></svg>';
      element.appendChild(template);
    });
    const before = await page.locator('.passage svg').screenshot();
    await navigate(type);
    const references = await page
      .locator('.passage-snapshot svg')
      .evaluate((svg) => {
        const targets = [...svg.querySelectorAll('[id]')].map((el) => el.id);
        const urls = ['fill', 'stroke', 'clip-path', 'mask', 'filter'].map(
          (name) => {
            const value = getComputedStyle(
              svg.querySelector('.painted')!,
            ).getPropertyValue(name);
            const id = /#([^\s"')]+)/.exec(value)?.[1];
            return id && targets.includes(id);
          },
        );
        const uses = [...svg.querySelectorAll('use')].map((el) => {
          const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
          return !!href && targets.includes(href.slice(1));
        });
        return { targets, urls, uses };
      });
    expect(references.targets).toHaveLength(6);
    expect(references.targets).not.toContain('paint');
    expect(references.urls).toEqual([true, true, true, true, true]);
    expect(references.uses).toEqual([true, true, true]);
    expect(
      await page
        .locator('.passage-snapshot .svg-template')
        .evaluate((element) => {
          const content = (element as HTMLTemplateElement).content;
          const id = content.querySelector('rect')!.id;
          return [
            id.startsWith('spindle-snapshot-'),
            content.querySelector('use')!.getAttribute('href') === `#${id}`,
          ];
        }),
    ).toEqual([true, true]);
    expect(
      await page.locator('.passage-snapshot .external').getAttribute('href'),
    ).toBe('other.svg#shape');
    const after = await page.locator('.passage-snapshot svg').screenshot();
    expect(await pixelDifference(before, after)).toBeLessThanOrEqual(1);
    if (type === 'crossfade') {
      expect(await page.locator('[id="paint"]').count()).toBe(1);
      expect(await page.locator('[id="hero"]').count()).toBe(1);
    }
  },
);
