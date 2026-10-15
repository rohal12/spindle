import { describe, expect, it } from 'vitest';
import {
  openPlaySessionWith,
  type PlaySessionOptions,
} from '../../src/play/session';

const stubUrl = new URL('./play-session/stub-worker.mjs', import.meta.url);
const open = (o: PlaySessionOptions) =>
  openPlaySessionWith(o, { workerUrl: stubUrl, headlessUrl: stubUrl });

describe('play session handle', () => {
  it('rejects open when the worker cannot boot', () =>
    expect(open({ html: 'fail' })).rejects.toThrow('boom'));

  it('rejects open when the story hangs while booting', () =>
    expect(open({ html: 'hang', stepTimeoutMs: 200 })).rejects.toThrow(
      'spindle: play session timed out after 200 ms (the story may be stuck in a loop)',
    ));

  it.each([0, -1, NaN, Infinity, 2_147_483_648, '5' as unknown as number])(
    'rejects open for an invalid stepTimeoutMs (%s)',
    (stepTimeoutMs) =>
      expect(open({ html: 'x', stepTimeoutMs })).rejects.toThrow(
        `spindle: openPlaySession(): "stepTimeoutMs" must be a positive number of milliseconds, got ${stepTimeoutMs}`,
      ),
  );

  it('runs calls one at a time in call order', async () => {
    const s = await open({ html: 'x' });
    const a = s.step('slow', 50);
    const b = s.step('echo', 1);
    expect(await Promise.all([a, b])).toEqual([
      { order: 1 },
      { echo: ['echo', 1] },
    ]);
    await s.close();
  });

  it('keeps the session open after a rejected call', async () => {
    const s = await open({ html: 'x' });
    await expect(s.step('bad')).rejects.toThrow('bad');
    expect(s.closed).toBe(false);
    await s.close();
  });

  it('terminates on timeout and rejects queued and later calls', async () => {
    const s = await open({ html: 'x', stepTimeoutMs: 200 });
    const hung = s.step('hang');
    const queued = s.observe();
    await expect(hung).rejects.toThrow(
      'spindle: play session timed out after 200 ms (the story may be stuck in a loop)',
    );
    await expect(queued).rejects.toThrow('spindle: play session is closed');
    await expect(s.observe()).rejects.toThrow(
      'spindle: play session is closed',
    );
    expect(s.closed).toBe(true);
    await s.close();
  });

  it('starts the timer when a call is sent, not when it is queued', async () => {
    // Each step is well under the timeout, but all three together exceed it.
    const s = await open({ html: 'x', stepTimeoutMs: 500 });
    const calls = [
      s.step('slow', 200),
      s.step('slow', 200),
      s.step('slow', 200),
    ];
    await expect(Promise.all(calls)).resolves.toEqual([
      { order: 1 },
      { order: 2 },
      { order: 3 },
    ]);
    await s.close();
  });

  it('rejects pending calls when the worker exits unexpectedly', async () => {
    const s = await open({ html: 'x' });
    const crashed = s.step('crash');
    const queued = s.observe();
    await expect(crashed).rejects.toThrow(/exited with code 3/);
    await expect(queued).rejects.toThrow(/exited with code 3/);
    expect(s.closed).toBe(true);
    await expect(s.observe()).rejects.toThrow(
      'spindle: play session is closed',
    );
    await s.close();
  });

  it('close() is idempotent and works after a timeout', async () => {
    const a = await open({ html: 'x' });
    await a.close();
    await a.close();
    expect(a.closed).toBe(true);
    await expect(a.observe()).rejects.toThrow(
      'spindle: play session is closed',
    );

    const b = await open({ html: 'x', stepTimeoutMs: 100 });
    await expect(b.step('hang')).rejects.toThrow(/timed out/);
    await b.close();
    expect(b.closed).toBe(true);
  });

  it('rejects the running and queued calls when closed during them', async () => {
    const s = await open({ html: 'x' });
    const checks = [
      expect(s.step('slow', 1000)).rejects.toThrow(
        'spindle: play session is closed',
      ),
      expect(s.observe()).rejects.toThrow('spindle: play session is closed'),
    ];
    await s.close();
    await Promise.all(checks);
  });
});
