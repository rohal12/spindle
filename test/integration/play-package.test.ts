// @vitest-environment node
/**
 * The play entry as published (`dist/pkg/play.js`): sessions run the story
 * in a worker on happy-dom. Requires `bun run build` first.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import type * as Play from '../../types/play';
import { storyHtml } from '../headless/story-html';

const projectRoot = resolve(import.meta.dirname!, '../..');
const playUrl = pathToFileURL(resolve(projectRoot, 'dist/pkg/play.js')).href;
const { openPlaySession, resolveStoryHtml } = (await import(
  playUrl
)) as typeof Play;

const html = storyHtml({
  StoryVariables: '$name = ""\n$weapon = ""',
  StoryInit: '{set $name = "?"}{set $weapon = "sword"}',
  StoryContext: 'Name: {$name}',
  Start: [
    'The start.',
    '{listbox $weapon}{option "sword"}{option "axe"}{/listbox}',
    '[[Hall]]',
    '{dialog "Open map"}Map{/dialog}',
  ].join('\n'),
  Hall: 'A hall.',
  Map: 'A map.',
});

describe('package: @rohal12/spindle/play (dist/pkg/play.js)', () => {
  it('requires explicit trust before authored code can touch host files (#583)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spindle-trust-'));
    const marker = join(dir, 'executed');
    const untrusted = storyHtml({
      StoryVariables: '',
      StoryInit: `{do}process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'){/do}`,
      Start: 'Hi',
    });
    try {
      for (const trusted of [undefined, false]) {
        await expect(
          openPlaySession({ html: untrusted, trusted }),
        ).rejects.toThrow(/trusted: true/);
        expect(existsSync(marker)).toBe(false);
      }
      const session = await openPlaySession({ html: untrusted, trusted: true });
      try {
        expect(existsSync(marker)).toBe(true);
      } finally {
        await session.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plays a story: observe, step, goto, get/set, transcript, close', async () => {
    const s = await openPlaySession({ trusted: true, html });
    const first = await s.observe();
    expect(first.passage).toBe('Start');
    expect(first.context).toBe('Name: ?');
    const link = first.actions.find((a) => a.type === 'link')!;
    const hall = await s.step(link.id);
    expect(hall.passage).toBe('Hall');
    expect((await s.transcript()).map((e) => e.passage)).toEqual(['Start']);
    await s.set({ name: 'Ada' });
    expect(await s.get(['$name', 'weapon'])).toEqual({
      name: 'Ada',
      weapon: 'sword',
    });
    expect(await s.get()).toMatchObject({ name: 'Ada', weapon: 'sword' });
    expect((await s.goto('Start')).context).toBe('Name: Ada');
    expect(await s.transcript()).toHaveLength(1); // goto not recorded
    await s.close();
    expect(s.closed).toBe(true);
  });

  it('steps with a value', async () => {
    const s = await openPlaySession({ trusted: true, html });
    const listbox = (await s.observe()).actions.find(
      (a) => a.type === 'listbox',
    )!;
    await s.step(listbox.id, 'axe');
    expect(await s.get(['weapon'])).toEqual({ weapon: 'axe' });
    expect((await s.transcript())[0]!.chose.value).toBe('axe');
    await s.close();
  });

  it('runs two sessions in isolation', async () => {
    const [a, b] = await Promise.all([
      openPlaySession({ trusted: true, html }),
      openPlaySession({ trusted: true, html }),
    ]);
    await a.set({ name: 'Ada' });
    await b.set({ $name: 'Bo' });
    expect(await a.get(['name'])).toEqual({ name: 'Ada' });
    expect(await b.get(['name'])).toEqual({ name: 'Bo' });
    await Promise.all([a.close(), b.close()]);
  });

  it('shares window properties with bare globals in scripts and passages (#635)', async () => {
    const compiled = storyHtml({
      StoryVariables: '$greeting = ""\n$same = false\n$keys = []',
      Start: `{do}
        Story.set('greeting', api.hello());
        api = { hello: () => 'updated' };
        Story.set('same', window === globalThis && self === window && window.api === api);
        Object.defineProperty(window, 'defined', { configurable: true, get: () => api.hello() });
        Story.set('keys', [defined, delete window.api, typeof api]);
      {/do}Greeting: {$greeting}`,
    }).replace(
      '</tw-storydata>',
      `<script type="text/twine-javascript">
      window.api = { hello: () => 'hi' };
    </script></tw-storydata>`,
    );
    const s = await openPlaySession({ trusted: true, html: compiled });
    try {
      expect(await s.get()).toMatchObject({
        greeting: 'hi',
        same: true,
        keys: ['updated', true, 'undefined'],
      });
      expect((await s.observe()).text).toContain('Greeting: hi');
    } finally {
      await s.close();
    }
  });

  it('keeps DOM window accessors and the DOM view Story API live (#635)', async () => {
    const s = await openPlaySession({
      trusted: true,
      html: storyHtml({
        StoryVariables: '$resizes = 0\n$size = []\n$domStory = false',
        Start: `{do}
          window.onresize = function () {
            this.Story.set('resizes', this.Story.get('resizes') + 1);
          };
          window.dispatchEvent(new Event('resize'));
          window.onresize = null;
          window.dispatchEvent(new Event('resize'));
          window.happyDOM.setViewport({ width: 900, height: 700 });
          Story.set('size', [window.innerWidth, innerHeight]);
          Story.set('domStory', document.defaultView.Story === Story);
        {/do}`,
      }),
    });
    try {
      expect(await s.get()).toMatchObject({
        resizes: 1,
        size: [900, 700],
        domStory: true,
      });
    } finally {
      await s.close();
    }
  });

  it('uses the story window in event callbacks without changing event identity (#635)', async () => {
    const s = await openPlaySession({
      trusted: true,
      html: storyHtml({
        StoryVariables:
          '$events = []\n$objectCalls = 0\n$abortCalls = 0\n$handlerSame = false',
        Start: `{do}
          window.api = { hello: () => 'hi' };
          const results = [];
          let activeEvent;
          let activeTarget;
          function callback(event) {
            'use strict';
            results.push([
              this === window, this?.api?.hello() ?? 'missing',
              event === activeEvent, event.target === activeTarget,
              event.currentTarget === window,
              event.composedPath().at(-1) === window,
            ]);
          }
          activeTarget = window;
          activeEvent = new CustomEvent('probe');
          window.addEventListener('probe', callback);
          window.addEventListener('probe', callback);
          window.dispatchEvent(activeEvent);
          window.removeEventListener('probe', callback);
          window.dispatchEvent(activeEvent);

          const button = document.createElement('button');
          document.body.append(button);
          activeTarget = button;
          activeEvent = new Event('probe', { bubbles: true });
          addEventListener('probe', callback, { once: true, capture: true });
          button.dispatchEvent(activeEvent);
          button.dispatchEvent(activeEvent);
          button.remove();

          activeTarget = window;
          activeEvent = new Event('resize');
          window.onresize = callback;
          Story.set('handlerSame', window.onresize === callback);
          window.dispatchEvent(activeEvent);
          window.onresize = null;
          window.dispatchEvent(activeEvent);
          const object = { handleEvent(event) {
            if (this === object && event.currentTarget === window) {
              Story.set('objectCalls', Story.get('objectCalls') + 1);
            }
          } };
          window.addEventListener('probe', object);
          window.dispatchEvent(new Event('probe'));
          window.removeEventListener('probe', object);
          window.dispatchEvent(new Event('probe'));
          const controller = new AbortController();
          window.addEventListener('probe', () => {
            Story.set('abortCalls', Story.get('abortCalls') + 1);
          }, { signal: controller.signal });
          window.dispatchEvent(new Event('probe'));
          controller.abort();
          window.dispatchEvent(new Event('probe'));
          Story.set('events', results);
        {/do}`,
      }),
    });
    try {
      expect(await s.get()).toMatchObject({
        events: [
          [true, 'hi', true, true, true, true],
          [true, 'hi', true, true, true, true],
          [true, 'hi', true, true, true, true],
        ],
        handlerSame: true,
        objectCalls: 1,
        abortCalls: 1,
      });
    } finally {
      await s.close();
    }
  });

  it('runs and cancels idle callbacks through window and bare globals (#635)', async () => {
    const s = await openPlaySession({
      trusted: true,
      html: storyHtml({
        StoryVariables:
          '$idle = false\n$cancelled = false\n$deadline = []\n$expired = []\n$handle = 0',
        StoryInit: `{do}
          Story.set('handle', window.requestIdleCallback((deadline) => {
            Story.set('idle', true);
            Story.set('deadline', [deadline.didTimeout, deadline.timeRemaining() >= 0, deadline.timeRemaining() <= 50]);
          }, { timeout: 1000 }));
          const cancelled = requestIdleCallback(() => Story.set('cancelled', true));
          window.cancelIdleCallback(cancelled);
          const alsoCancelled = window.requestIdleCallback(() => Story.set('cancelled', true));
          cancelIdleCallback(alsoCancelled);
          requestIdleCallback((deadline) => {
            Story.set('expired', [deadline.didTimeout, deadline.timeRemaining()]);
          }, { timeout: 0 });
          cancelIdleCallback(-1);
        {/do}`,
        Start: 'Idle callback test',
      }),
    });
    try {
      await vi.waitFor(async () => {
        expect(await s.get(['idle', 'expired'])).toEqual({
          idle: true,
          expired: [true, 0],
        });
      });
      expect(await s.get(['cancelled', 'deadline', 'handle'])).toEqual({
        cancelled: false,
        deadline: [false, true, true],
        handle: expect.any(Number),
      });
    } finally {
      await s.close();
    }
  });

  it('keeps the session usable after an unknown action', async () => {
    const s = await openPlaySession({ trusted: true, html });
    await expect(s.step('nope')).rejects.toThrow(/nope/);
    expect((await s.observe()).passage).toBe('Start');
    await s.close();
  });

  it('rejects goto to an unknown or special passage and stays open', async () => {
    const s = await openPlaySession({ trusted: true, html });
    await expect(s.goto('Nowhere')).rejects.toThrow(
      'spindle: No passage named "Nowhere"',
    );
    await expect(s.goto('StoryInit')).rejects.toThrow(
      'spindle: Cannot navigate to special passage "StoryInit".',
    );
    expect(s.closed).toBe(false);
    expect((await s.observe()).passage).toBe('Start');
    await s.close();
  });

  it("sends story console output to stderr, not the host's stdout", async () => {
    const written = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map((c) => String(c[0])).join('');
    const stdout = vi.spyOn(process.stdout, 'write');
    // Swallow the story's line; let anything else through.
    const realStderr = process.stderr.write.bind(process.stderr);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: unknown, ...rest: never[]) =>
        String(chunk).includes('STORY-LOG')
          ? true
          : realStderr(
              chunk as string,
              ...rest,
            )) as typeof process.stderr.write);
    try {
      const s = await openPlaySession({
        trusted: true,
        html: storyHtml({
          StoryVariables: '',
          Start: '{do}console.log("STORY-LOG"){/do}Hi',
        }),
      });
      await s.observe();
      await vi.waitFor(() => expect(written(stderr)).toContain('STORY-LOG'));
      await s.close();
      expect(written(stdout)).not.toContain('STORY-LOG');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it("uses happy-dom's storage and navigator, separate per session", async () => {
    const storyWith = storyHtml({
      StoryVariables: '$same = 0\n$seen = 0',
      StoryInit: [
        "{do}Story.set('same', [localStorage === window.localStorage, sessionStorage === window.sessionStorage, navigator === window.navigator]){/do}",
        "{do}Story.set('seen', localStorage.getItem('play-test')); localStorage.setItem('play-test', 'set'){/do}",
      ].join(''),
      Start: 'Hi',
    });
    const a = await openPlaySession({ trusted: true, html: storyWith });
    expect(await a.get(['same', 'seen'])).toEqual({
      same: [true, true, true],
      seen: null,
    });
    const b = await openPlaySession({ trusted: true, html: storyWith });
    expect(await b.get(['seen'])).toEqual({ seen: null });
    await Promise.all([a.close(), b.close()]);
  });

  it('times out an infinite {do} loop', { timeout: 30_000 }, async () => {
    const s = await openPlaySession({
      trusted: true,
      html: storyHtml({
        StoryVariables: '',
        Start: '[[Loop]]',
        Loop: '{do}for(;;){}{/do}',
      }),
      // Use the default budget to boot the real renderer before entering the loop.
    });
    const link = (await s.observe()).actions[0]!;
    await expect(s.step(link.id)).rejects.toThrow(
      'spindle: play session timed out after 10000 ms (the story may be stuck in a loop)',
    );
    expect(s.closed).toBe(true);
    await s.close();
  });

  it('lets Node exit with a session left open', () => {
    // The child opens a session and never closes it.
    const script = `
      const { openPlaySession } = await import(${JSON.stringify(playUrl)});
      let html = '';
      for await (const chunk of process.stdin) html += chunk;
      const s = await openPlaySession({ trusted: true, html });
      console.log((await s.observe()).passage);
    `;
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { input: html, encoding: 'utf8', timeout: 10_000 },
    );
    expect(child.stderr).toBe('');
    expect(child.signal).toBeNull(); // not killed by the timeout
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe('Start');
  });

  it('opens a session from a host run with --input-type', () => {
    // Workers inherit the host's execArgv; `--input-type` (both spellings)
    // would stop the worker from starting.
    const script = `
      const { openPlaySession } = await import(${JSON.stringify(playUrl)});
      let html = '';
      for await (const chunk of process.stdin) html += chunk;
      const s = await openPlaySession({ trusted: true, html });
      console.log((await s.observe()).passage);
      await s.close();
    `;
    for (const flags of [['--input-type=module'], ['--input-type', 'module']]) {
      const child = spawnSync(process.execPath, [...flags, '-e', script], {
        input: html,
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(child.stderr).toBe('');
      expect(child.status).toBe(0);
      expect(child.stdout.trim()).toBe('Start');
    }
  });

  it('rejects open when boot fails', async () => {
    await expect(
      openPlaySession({ trusted: true, html: '<html><body></body></html>' }),
    ).rejects.toThrow('no <tw-storydata>');
  });

  it('rejects open when StoryInit stops the story', async () => {
    await expect(
      openPlaySession({
        trusted: true,
        html: storyHtml({
          StoryVariables: '',
          StoryInit: '{nosuchmacro}',
          Start: 'Hi',
        }),
      }),
    ).rejects.toThrow(/validation error[\s\S]*nosuchmacro/);
  });

  it('clones values, with a marker for those that cannot be cloned', async () => {
    const s = await openPlaySession({
      trusted: true,
      html: storyHtml({
        StoryVariables:
          '$fn = 0\n$fnMap = 0\n$cycle = 0\n$map = 0\n$set = 0\n$date = 0\n$ok = 0',
        StoryInit: [
          "{do}Story.set('fn', () => 1){/do}",
          "{do}Story.set('fnMap', new Map([['f', () => 1]])){/do}",
          "{do}const c = { n: 1 }; c.self = c; Story.set('cycle', c){/do}",
          "{do}Story.set('map', new Map([['a', 1]])){/do}",
          "{do}Story.set('set', new Set(['x'])){/do}",
          "{do}Story.set('date', new Date(0)){/do}",
          "{do}Story.set('ok', { n: 1 }){/do}",
        ].join(''),
        Start: 'Hi',
      }),
    });
    const unclonable = expect.stringMatching(
      /^\[unserializable: .*could not be cloned/,
    );
    const got = await s.get([
      'fn',
      'fnMap',
      'cycle',
      'map',
      'set',
      'date',
      'ok',
    ]);
    expect(got).toMatchObject({
      fn: unclonable,
      fnMap: unclonable,
      ok: { n: 1 },
    });
    const cycle = got.cycle as { n: number; self: unknown };
    expect(cycle.n).toBe(1);
    expect(cycle.self).toBe(cycle);
    expect(got.map).toEqual(new Map([['a', 1]]));
    expect(got.map).toBeInstanceOf(Map);
    expect(got.set).toEqual(new Set(['x']));
    expect(got.set).toBeInstanceOf(Set);
    expect(got.date).toEqual(new Date(0));
    expect(got.date).toBeInstanceOf(Date);
    const all = await s.get();
    expect(all.fn).toEqual(unclonable);
    expect(all.map).toEqual(new Map([['a', 1]]));
    await s.close();
  });

  it('gives each session no BroadcastChannel, so sessions cannot hear each other', async () => {
    const s = await openPlaySession({
      trusted: true,
      html: storyHtml({
        StoryVariables: '$bc = ""',
        StoryInit: "{do}Story.set('bc', typeof BroadcastChannel){/do}",
        Start: 'Hi',
      }),
    });
    expect(await s.get(['bc'])).toEqual({ bc: 'undefined' });
    await s.close();
  });

  it('ends the worker on its own when boot fails', async () => {
    const worker = new Worker(
      new URL(pathToFileURL(resolve(projectRoot, 'dist/pkg/play-worker.js'))),
      {
        workerData: {
          html: '<html><body></body></html>',
          headlessUrl: pathToFileURL(
            resolve(projectRoot, 'dist/pkg/headless.js'),
          ).href,
          transcript: { limit: 10 },
          transitions: false,
        },
      },
    );
    const messages: unknown[] = [];
    worker.on('message', (m) => messages.push(m));
    // No terminate(): the worker must exit by itself.
    const code = await new Promise((r) => worker.on('exit', r));
    expect(code).toBe(1);
    expect(messages).toEqual([
      {
        ready: false,
        error: { message: expect.stringContaining('no <tw-storydata>') },
      },
    ]);
  });

  it('opens a session from resolved Twee', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spindle-play-'));
    try {
      const path = join(dir, 'story.twee');
      writeFileSync(
        path,
        [
          ':: StoryData',
          '{ "ifid": "D674C58C-DEFA-4F70-B7A2-27742230C0FC" }',
          '',
          ':: StoryTitle',
          'Twee',
          '',
          ':: StoryVariables',
          '',
          ':: Start',
          'Hello [[Next]]',
          '',
          ':: Next',
          'Bye',
          '',
        ].join('\n'),
      );
      const { html: compiled } = await resolveStoryHtml({ path });
      const s = await openPlaySession({ trusted: true, html: compiled });
      expect((await s.observe()).passage).toBe('Start');
      await s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
