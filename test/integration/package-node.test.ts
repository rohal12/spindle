/**
 * Smoke-checks the built package under native Node module resolution. Vitest
 * transforms imports (aliases, inlined deps), which can hide a bundle that
 * only works with this repo's config, so each check spawns a plain `node`.
 * Requires `bun run build` first; skipped locally when dist/ is absent, never
 * in CI.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { STORY_HTML } from '../headless/fixture';

const projectRoot = resolve(import.meta.dirname!, '../..');
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf-8'),
) as {
  dependencies: Record<string, string>;
  exports: { './headless': { import: string } } & Record<
    string,
    { import: string }
  >;
};
const headlessPath = resolve(
  projectRoot,
  packageJson.exports['./headless'].import,
);
const built = existsSync(headlessPath);

function node(args: string[], input?: string): string {
  return execFileSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Package name of a bare import specifier (`a/b` → `a`, `@s/a/b` → `@s/a`). */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

describe.skipIf(!built && !process.env.CI)('package under native Node', () => {
  const entries = Object.entries(packageJson.exports).map(
    ([entry, { import: target }]) => ({
      entry,
      url: pathToFileURL(resolve(projectRoot, target)).href,
    }),
  );

  it.each(entries)('imports $entry', ({ url }) => {
    expect(() =>
      node([
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(url)})`,
      ]),
    ).not.toThrow();
  });

  it('headless bundle only imports declared runtime dependencies', () => {
    const code = readFileSync(headlessPath, 'utf-8');
    const bare = [...code.matchAll(/^import [^'"]*["']([^'"./][^'"]*)["']/gm)]
      .map((m) => m[1]!)
      .map(packageName);
    expect(bare.length).toBeGreaterThan(0);
    const declared = Object.keys(packageJson.dependencies);
    expect(bare.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it('boots a story through the headless bundle', () => {
    const out = node(
      ['test/integration/headless-node-smoke.mjs', headlessPath],
      STORY_HTML,
    );
    const summary = JSON.parse(out);
    expect(summary).toMatchObject({
      booted: true,
      start: 'Start',
      gold: 1,
      after: 'Hallway',
    });
    expect(summary.startText).toContain('1 gold');
    expect(summary.actions).toContain('link:Start');
    expect(summary.text).toContain('You are rich.');
  });

  it('releases unsubscribed runtime captures before restart (#599)', () => {
    const out = node([
      '--expose-gc',
      '--input-type=module',
      '-e',
      `import { Window } from 'happy-dom';
      const dom = new Window({ url: 'http://localhost/' });
      for (const key of Object.getOwnPropertyNames(dom)) {
        if (!(key in globalThis) || ['Event', 'EventTarget', 'CustomEvent'].includes(key))
          globalThis[key] = dom[key];
      }
      globalThis.window = globalThis;
      globalThis.document = dom.document;
      const { bootStory } = await import(${JSON.stringify(pathToFileURL(headlessPath).href)});
      const Story = await bootStory({ html: ${JSON.stringify(STORY_HTML)} });
      await Story.waitForActions();
      function subscribe() {
        const captured = { data: new Uint8Array(1024 * 1024) };
        const ref = new WeakRef(captured);
        const off = Story.on('afternavigate', () => captured.data.length);
        return { ref, off };
      }
      async function collect() {
        for (let i = 0; i < 8; i++) {
          await new Promise(resolve => setTimeout(resolve, 0));
          globalThis.gc();
        }
      }
      const subscription = subscribe();
      await collect();
      const active = subscription.ref.deref() !== undefined;
      subscription.off();
      await collect();
      const released = subscription.ref.deref() === undefined;
      subscription.off();
      Story.restart();
      console.log(JSON.stringify({ active, released }));
      await dom.happyDOM.abort();
      process.exit(0);`,
    ]);
    expect(JSON.parse(out)).toEqual({ active: true, released: true });
  });
});
