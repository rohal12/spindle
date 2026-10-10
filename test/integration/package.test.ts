/**
 * Checks the npm package as published: every path declared in package.json
 * "exports" must be in the tarball, and the tooling entry point must load in
 * Node and expose its documented API. Requires `bun run build` first.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { build } from 'esbuild';

const projectRoot = resolve(import.meta.dirname!, '../..');
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf-8'),
);

function packedFiles(): Set<string> {
  // npm still runs the `prepare` script (husky) on pack despite
  // --ignore-scripts. HUSKY=0 makes it a no-op and --foreground-scripts=false
  // keeps its output out of the JSON on stdout.
  const out = execFileSync(
    'npm',
    [
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--foreground-scripts=false',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: { ...process.env, HUSKY: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const [pack] = JSON.parse(out) as [{ files: { path: string }[] }];
  return new Set(pack.files.map((f) => f.path));
}

describe('npm package', () => {
  const files = packedFiles();
  const exportTargets = Object.entries(
    packageJson.exports as Record<string, Record<string, string>>,
  ).flatMap(([entry, conditions]) =>
    Object.entries(conditions).map(([condition, target]) => ({
      entry,
      condition,
      path: target.replace(/^\.\//, ''),
    })),
  );

  it.each(exportTargets)('ships $path', ({ path }) => {
    expect(files.has(path)).toBe(true);
  });
});

describe('@rohal12/spindle/tooling', async () => {
  const tooling = await import(
    pathToFileURL(resolve(projectRoot, packageJson.exports['./tooling'].import))
      .href
  );

  it('exports defineMacro and getMacroRegistry', () => {
    expect(typeof tooling.defineMacro).toBe('function');
    expect(typeof tooling.getMacroRegistry).toBe('function');
    expect(
      tooling
        .getMacroRegistry()
        .some((m: { name: string }) => m.name === 'set'),
    ).toBe(true);
  });

  it('defineMacro throws for a parameter without a type, as Story.defineMacro does', () => {
    expect(() =>
      tooling.defineMacro({
        name: 'untyped',
        parameters: [{ name: 'amount' }],
        render: () => null,
      }),
    ).toThrow('The parameter "amount" of the macro {untyped} has no type.');
    expect(
      tooling
        .getMacroRegistry()
        .some((m: { name: string }) => m.name === 'untyped'),
    ).toBe(false);
  });

  it('exports parseStoryVariables for StoryVariables', () => {
    const schema = tooling.parseStoryVariables(
      '$hp = 100\n$name = "Hero"\n$pc = { stats: { str: 3 } }',
    );
    expect([...schema.keys()]).toEqual(['hp', 'name', 'pc']);
    expect(schema.get('hp')).toMatchObject({ type: 'number', default: 100 });
    expect(schema.get('pc').fields.get('stats').type).toBe('object');
  });

  it('exports parseStoryVariables for StoryTransients', () => {
    const schema = tooling.parseStoryVariables('%npcs = []', '%');
    expect(schema.get('npcs')).toMatchObject({ type: 'array', default: [] });
  });

  it('parseStoryVariables rejects unsupported values', () => {
    expect(() => tooling.parseStoryVariables('$x = undefined')).toThrow(
      /Unsupported type/,
    );
  });

  it('exports the parsing rules', () => {
    for (const name of [
      'lexJs',
      'lexTemplate',
      'findCodeEnd',
      'scanStringLiteral',
      'parseSelectors',
      'tokenizeMarkup',
      'tokenizeMarkupTolerant',
      'transform',
      'passageTarget',
      'evaluatePassageName',
      'collectPassageReferences',
      'validateStoryMarkup',
      'collectStoryPassageReferences',
      'passagePieces',
      'pieceOffset',
      'pairMarkup',
      'isBlockMacro',
      'parseDeclarations',
      'isSigil',
      'splitArgs',
      'splitTopLevel',
      'readQuoted',
      'unescapeQuoted',
      'stripLooseQuotes',
      'endsWithOperator',
      'splitIncludeFlag',
      'parseWidgetDef',
      'widgetDefinitions',
    ]) {
      expect(typeof tooling[name], name).toBe('function');
    }
    expect(tooling.SIGIL_SCOPES.$).toBe('variable');
    expect(tooling.parseSelectors('.a#b x')).toEqual({
      className: 'a',
      id: 'b',
      end: 5,
    });
    expect(tooling.tokenizeMarkup('{$x}')[0].type).toBe('variable');
    expect(tooling.tokenizeMarkupTolerant('{$x} {if').errors).toHaveLength(1);
    expect(tooling.transform('$x')).toBe('variables["x"]');
    expect(
      tooling
        .collectPassageReferences('[[Go->Hall]] {goto "Roof"}')
        .map((r: { macro: string }) => r.macro),
    ).toEqual(['link', 'goto']);
  });

  it('validates against the macros it is given, with no state', () => {
    const passages = [
      { name: 'Start', content: '{shout "hi"}x{/shout} {set $a = 1}' },
    ];
    const shout = { name: 'shout', block: true, subMacros: [] };
    const codes = (macros: unknown[]): string[] =>
      tooling
        .validateStoryMarkup(passages, macros)
        .map((d: { code: string }) => d.code);
    // Two sets in one process: what one knows does not leak into the other
    expect(codes([...tooling.builtinMacros, shout])).toEqual([]);
    // Not a block macro for them: its closer closes nothing
    expect(codes(tooling.builtinMacros)).toEqual(['stray-closer']);
    expect(codes([...tooling.builtinMacros, shout])).toEqual([]);
    // The global registry is for the convenience functions only
    expect(tooling.validateMarkup(passages).length).toBeGreaterThan(0);
  });

  it('exports the built-in macros as data', () => {
    expect(Array.isArray(tooling.builtinMacros)).toBe(true);
    expect(Object.isFrozen(tooling.builtinMacros)).toBe(true);
    expect(
      tooling.builtinMacros.some((m: { name: string }) => m.name === 'set'),
    ).toBe(true);
    expect(tooling.getMacroRegistry()).toHaveLength(
      tooling.builtinMacros.length,
    );
  });

  it('still sees the built-in macros when a bundler bundles it', async () => {
    // A bundle reads no file next to it: it has its own directory
    const dir = mkdtempSync(join(tmpdir(), 'spindle-bundle-'));
    try {
      const outfile = join(dir, 'bundle.mjs');
      await build({
        entryPoints: [
          resolve(projectRoot, packageJson.exports['./tooling'].import),
        ],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile,
        logLevel: 'silent',
      });
      const bundled = await import(pathToFileURL(outfile).href);
      expect(bundled.builtinMacros.length).toBeGreaterThan(0);
      expect(
        bundled
          .getMacroRegistry()
          .some((m: { name: string }) => m.name === 'set'),
      ).toBe(true);
      expect(
        bundled.validateMarkup([{ name: 'P', content: '{set $a = 1}' }]),
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not load or bundle the runtime', () => {
    // Imported or inlined, Preact, zustand, immer and micromark would show
    // by name in the bundle (their sources and import specifiers)
    const bundle = readFileSync(
      resolve(projectRoot, 'dist/pkg/story-variables.js'),
      'utf-8',
    );
    expect(bundle.match(/\b(?:preact|zustand|immer|micromark)\b/g)).toBeNull();
  });
});
