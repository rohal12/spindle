/**
 * Checks the npm package as published: every path declared in package.json
 * "exports" must be in the tarball, and the tooling entry point must load in
 * Node and expose its documented API. Requires `bun run build` first.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

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
    expect(() => tooling.parseStoryVariables('$x = null')).toThrow(
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
      'isSigil',
      'splitArgs',
      'splitTopLevel',
      'readQuoted',
      'unescapeQuoted',
      'stripLooseQuotes',
      'endsWithOperator',
      'splitIncludeFlag',
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
