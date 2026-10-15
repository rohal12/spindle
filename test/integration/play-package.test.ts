// @vitest-environment node
/**
 * The play entry as published (`dist/pkg/play.js`): sessions run the story
 * in a worker on happy-dom. Requires `bun run build` first.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
  it('plays a story: observe, step, goto, get/set, transcript, close', async () => {
    const s = await openPlaySession({ html });
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
    const s = await openPlaySession({ html });
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
      openPlaySession({ html }),
      openPlaySession({ html }),
    ]);
    await a.set({ name: 'Ada' });
    await b.set({ $name: 'Bo' });
    expect(await a.get(['name'])).toEqual({ name: 'Ada' });
    expect(await b.get(['name'])).toEqual({ name: 'Bo' });
    await Promise.all([a.close(), b.close()]);
  });

  it('keeps the session usable after an unknown action', async () => {
    const s = await openPlaySession({ html });
    await expect(s.step('nope')).rejects.toThrow(/nope/);
    expect((await s.observe()).passage).toBe('Start');
    await s.close();
  });

  it('times out an infinite {do} loop', async () => {
    const s = await openPlaySession({
      html: storyHtml({
        StoryVariables: '',
        Start: '[[Loop]]',
        Loop: '{do}for(;;){}{/do}',
      }),
      stepTimeoutMs: 1000,
    });
    const link = (await s.observe()).actions[0]!;
    await expect(s.step(link.id)).rejects.toThrow(
      'spindle: play session timed out after 1000 ms (the story may be stuck in a loop)',
    );
    expect(s.closed).toBe(true);
    await s.close();
  });

  it('rejects open when boot fails', async () => {
    await expect(
      openPlaySession({ html: '<html><body></body></html>' }),
    ).rejects.toThrow('no <tw-storydata>');
  });

  it('rejects open when StoryInit stops the story', async () => {
    await expect(
      openPlaySession({
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
      const s = await openPlaySession({ html: compiled });
      expect((await s.observe()).passage).toBe('Start');
      await s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
