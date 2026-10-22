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
