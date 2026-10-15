import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { build } from 'vite';
import { peggyPlugin } from '../../scripts/peggy';

/** Fatal OOM must be contained outside the vitest worker. */
let directory: string;
let bundle: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'spindle-wrap-progress-'));
  bundle = join(directory, 'formatter.mjs');
  await build({
    configFile: false,
    // The subprocess imports a Node bundle, without a DOM.
    resolve: { conditions: ['module', 'node'] },
    logLevel: 'silent',
    plugins: [peggyPlugin()],
    build: {
      outDir: directory,
      minify: false,
      lib: {
        entry: resolve('src/format/format-passage.ts'),
        formats: ['es'],
        fileName: () => 'formatter.mjs',
      },
    },
  });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('formatPassage wrap progress (#560)', () => {
  for (const [indent, width] of [
    ['    ', 2],
    ['    ', 4],
    ['    ', 5],
    ['    ', 80],
    ['\t', 2],
    [' '.repeat(84), 80],
    ['', 2],
  ] as const) {
    for (const wrapper of ['plain', 'nested-list', 'nested-macro']) {
      it(`${wrapper}: indentation ${JSON.stringify(indent)} at width ${width} terminates and is idempotent`, () => {
        const line = `${indent}- a long list item many words`;
        const input =
          wrapper === 'nested-list'
            ? `- outer\n${line}`
            : wrapper === 'nested-macro'
              ? `{if true}\n${line}\n{/if}`
              : line;
        const script = `import {formatPassage} from ${JSON.stringify(pathToFileURL(bundle).href)};
const input = ${JSON.stringify(input)};
const options = {maxLineLength:${width}, isBlock:name=>name==='if'};
const once = await formatPassage(input, options);
const twice = await formatPassage(once, options);
console.log(JSON.stringify({once,twice}));`;
        const run = spawnSync(
          process.execPath,
          ['--max-old-space-size=64', '--input-type=module', '-e', script],
          { encoding: 'utf8', timeout: 8000 },
        );
        expect(run.error).toBeUndefined();
        expect(run.signal).toBeNull();
        expect(run.status, run.stderr).toBe(0);
        const output = JSON.parse(run.stdout);
        expect(output.twice).toBe(output.once);
        expect(output.once.replace(/\s+/g, ' ').trim()).toBe(
          input.replace(/\s+/g, ' ').trim(),
        );
      });
    }
  }
});
