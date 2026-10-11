/**
 * E2E tests of #525 and #536 in a real browser, with the issues' own
 * stories (state of the outgoing passage snapshot of a crossfade):
 * - #525: every selected option of a multiple select stays selected;
 * - #536: a video keeps the frame and position it showed, silent and paused.
 * Also the neighbours of those: scroll offsets, an open <details>, a range
 * input and audio position.
 *
 * Compiles its own stories with the built format (global setup builds it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'http';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { compileToFile } from '@rohal12/twee-ts';

const projectRoot = resolve(import.meta.dirname!, '../..');

/**
 * 64x48 WebM (VP8, 10 fps, no audio): red for the first second, then blue.
 * A data URL keeps it same-origin and seekable without a range server.
 */
const clip = `data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAU3EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggT77AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAp3AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIsZr1Lqh/AJ+cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgUC6gTCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIsZr1Lqh/AJ9nyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAzLjAwMDAwMDAwMAAfQ7Z1Q1LngQCjwoEAAICQAwCdASpAADAAAEcIhYWIhYSIAgICdaoD+AP6Agc7eeLPMx5eAP79bvP/45k3MMT/jm3/8WE8DijI//FRAKOWgQBkANEBAAEQEAAYABhYL/QACIwAAKOWgQDIANEBAAEQEAAYABhYL/QACIwAAKOWgQEsANEBAAEQEAAYABhYL/QACIwAAKOWgQGQANEBAAEQEAAYABhYL/QACIwAAKOWgQH0ANEBAAEQEAAYABhYL/QACIwAAKOWgQJYANEBAAEQEAAYABhYL/QACIwAAKOVgQK8ALEBAAEQEBRgAGFgv9AAIjAAo5aBAyAA0QEAARAQABgAGFgv9AAIjAAAo5aBA4QA0QEAARAQABgAGFgv9AAIjAAAo8GBA+iAUAMAnQEqQAAwAABHCIWFiIWEiAICAnWqA/gCBwjVZ5mPN9IA/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOWgQRMANEBAAEQEAAYABhYL/QACIwAAKOWgQSwANEBAAEQEAAYABhYL/QACIwAAKOWgQUUANEBAAEQEAAYABhYL/QACIwAAKOWgQV4ANEBAAEQEAAYABhYL/QACIwAAKOWgQXcANEBAAEQEAAYABhYL/QACIwAAKOWgQZAANEBAAEQEAAYABhYL/QACIwAAKOVgQakALEBAAEQEBRgAGFgv9AAIjAAo5aBBwgA0QEAARAQABgAGFgv9AAIjAAAo5aBB2wA0QEAARAQABgAGFgv9AAIjAAAo8GBB9CAUAMAnQEqQAAwAABHCIWFiIWEiAICAnWqA/gCBwjVZ5mPN9IA/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOWgQg0ANEBAAEQEAAYABhYL/QACIwAAKOWgQiYANEBAAEQEAAYABhYL/QACIwAAKOWgQj8ANEBAAEQEAAYABhYL/QACIwAAKOWgQlgANEBAAEQEAAYABhYL/QACIwAAKOWgQnEANEBAAEQEAAYABhYL/QACIwAAKOWgQooANEBAAEQEAAYABhYL/QACIwAAKOVgQqMALEBAAEQEBRgAGFgv9AAIjAAo5aBCvAA0QEAARAQABgAGFgv9AAIjAAAo5aBC1QA0QEAARAQABgAGFgv9AAIjAAAHFO7a7e7j7OBALeK94EB8YIBo/CBA7uRs4ID6LeL94EB8YIBo/CCAR67kbOCB9C3i/eBAfGCAaPwggI4`;

const story = `:: StoryTitle
Snapshots

:: StoryData
{"ifid":"52500000-0000-4000-8000-000000000525","format":"spindle","format-version":"0.1.0","start":"Start"}

:: StoryVariables

:: Start
<select id="choices" multiple><option>A</option><option>B</option><option>C</option><option>D</option></select>
<details id="more" open><summary>More</summary>Hidden text</details>
<input id="level" type="range" min="0" max="10" value="2">
<textarea id="notes" rows="3" cols="20">${Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')}</textarea>
<video id="clip" width="320" height="240" muted preload="auto" src="${clip}"></video>
[[Next]]

:: Next
Next passage
`;

let server: ReturnType<typeof createServer>;
let browser: Browser;
let page: Page;
let baseUrl: string;

beforeAll(async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'spindle-e2e-'));
  const src = resolve(dir, 'snapshots.twee');
  writeFileSync(src, story);
  await compileToFile({
    sources: [src],
    outFile: resolve(dir, 'snapshots.html'),
    formatPaths: [resolve(projectRoot, 'dist/storyformats')],
  });
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(resolve(dir, 'snapshots.html')));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
  });
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** Leave `Start` by a long crossfade, with its state set up by `prepare`. */
async function leaveStart(prepare: string): Promise<void> {
  await page.goto(baseUrl);
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(baseUrl);
  await page.waitForSelector('.passage');
  await page.evaluate(prepare);
  // The long duration is for inspection; pin the fade so nothing changes
  // under the screenshots
  await page.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = '.passage-snapshot, .passage { animation: none !important }';
    document.head.appendChild(style);
    Story.setTransition({ type: 'crossfade', duration: 10000 });
    Story.goto('Next');
  })()`);
  await page.waitForSelector('.passage-snapshot');
}

const snapshot = <T>(read: string): Promise<T> =>
  page.evaluate(
    `(() => { const s = document.querySelector('.passage-snapshot'); return ${read}; })()`,
  ) as Promise<T>;

/** The color of the middle of the snapshot's video, as the browser shows it. */
async function videoColor(): Promise<[number, number, number]> {
  const box = (await page.locator('.passage-snapshot video').boundingBox())!;
  const shot = await page.screenshot({
    clip: {
      x: box.x + box.width / 2 - 4,
      y: box.y + box.height / 2 - 4,
      width: 8,
      height: 8,
    },
  });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(4, 4, 1, 1).data;
    return [r!, g!, b!] as [number, number, number];
  }, shot.toString('base64'));
}

describe('a multiple select in the outgoing snapshot (#525)', () => {
  it('keeps every selected option', async () => {
    await leaveStart(`(() => {
      const options = document.querySelector('#choices').options;
      options[1].selected = true;
      options[2].selected = true;
    })()`);
    expect(
      await snapshot<string[]>(
        `[...s.querySelector('select').selectedOptions].map(o => o.value)`,
      ),
    ).toEqual(['B', 'C']);
  });
});

describe('a video in the outgoing snapshot (#536)', () => {
  it('shows the frame the live video showed, paused and silent', async () => {
    await leaveStart(`(async () => {
      const video = document.querySelector('#clip');
      video.muted = true;
      await new Promise(r => { video.onseeked = r; video.currentTime = 1.5; });
    })()`);
    // Give the clone time to load and seek, which must not bring back red
    await page.waitForTimeout(1000);
    const state = await snapshot<{
      time: number;
      paused: boolean;
      muted: boolean;
    }>(
      `({ time: s.querySelector('video').currentTime, paused: s.querySelector('video').paused, muted: s.querySelector('video').muted })`,
    );
    expect(state.paused).toBe(true);
    expect(state.muted).toBe(true);
    expect(state.time).toBeGreaterThan(1.3);
    const [r, , b] = await videoColor();
    expect(b).toBeGreaterThan(r + 100);
  });

  it('shows the first frame of a video that never played', async () => {
    await leaveStart('0');
    await page.waitForTimeout(500);
    const [r, , b] = await videoColor();
    expect(r).toBeGreaterThan(b + 100);
  });
});

describe('other state of the outgoing snapshot', () => {
  it('keeps scroll offsets, an open details and a range value', async () => {
    await leaveStart(`(() => {
      document.querySelector('#notes').scrollTop = 40;
      document.querySelector('#level').value = '8';
    })()`);
    expect(
      await snapshot<number>(`s.querySelector('textarea').scrollTop`),
    ).toBe(40);
    expect(await snapshot<boolean>(`s.querySelector('details').open`)).toBe(
      true,
    );
    expect(
      await snapshot<string>(`s.querySelector('input[type=range]').value`),
    ).toBe('8');
  });
});
