/**
 * Compiles the passage markup grammar (src/markup/spindle.peggy) when it is
 * imported, so the generated parser is never committed. The Vite plugin
 * serves vite builds and vitest; the Bun plugin (preloaded by bunfig.toml)
 * serves the scripts Bun runs directly.
 */
import { readFileSync } from 'node:fs';
import peggy from 'peggy';
import type { Plugin } from 'vite';

/** The grammar's start rules (see spindle.peggy). */
const START_RULES = ['Tokens', 'SelectorsPrefix'];

const PEGGY_FILE = /\.peggy$/;

/** The ES module source of the parser a grammar generates. */
export function compileGrammar(grammar: string, path: string): string {
  return peggy.generate(grammar, {
    output: 'source',
    format: 'es',
    allowedStartRules: START_RULES,
    dependencies: { shared: './grammar-shared' },
    grammarSource: path,
  });
}

/** Vite (and vitest) plugin: `.peggy` imports load as their parser. */
export function peggyPlugin(): Plugin {
  return {
    name: 'spindle-peggy',
    transform(code, id) {
      if (!PEGGY_FILE.test(id)) return null;
      return { code: compileGrammar(code, id), map: null };
    },
  };
}

/** Bun plugin: `.peggy` imports load as their parser. */
export const bunPeggyPlugin = {
  name: 'spindle-peggy',
  setup(build: {
    onLoad(
      options: { filter: RegExp },
      load: (args: { path: string }) => { contents: string; loader: 'js' },
    ): void;
  }) {
    build.onLoad({ filter: PEGGY_FILE }, ({ path }) => ({
      contents: compileGrammar(readFileSync(path, 'utf8'), path),
      loader: 'js',
    }));
  },
};
