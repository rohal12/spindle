import { expect, it } from 'vitest';
import { discoverMacros, validateStoryMarkup } from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';
import { validateMarkup } from '../../src/markup/validate';
import { sourcePositions } from '../../src/markup/line-column';

it('indexes UTF-16 columns, CRLF, newline offsets and EOF', () => {
  const position = sourcePositions('a\r\n😀b\n');
  expect([0, 1, 2, 3, 5, 6, 7].map(position)).toEqual([
    { line: 1, column: 1 },
    { line: 1, column: 2 },
    { line: 1, column: 3 },
    { line: 2, column: 1 },
    { line: 2, column: 3 },
    { line: 2, column: 4 },
    { line: 3, column: 1 },
  ]);
});

it('resolves a reused macro config without repeatedly scanning its uses (#622)', () => {
  const source =
    'const c={name:"foo",description:"' +
    'a'.repeat(2000) +
    '"};\n' +
    'Story.defineMacro(c);\n'.repeat(200);
  const matchAll = String.prototype.matchAll;
  let bindingScans = 0;
  String.prototype.matchAll = function (this: string, pattern: RegExp) {
    if (pattern.source === '(?<![\\w$])c(?![\\w$])') bindingScans++;
    return matchAll.call(this, pattern);
  };
  let found;
  try {
    found = discoverMacros(source);
  } finally {
    String.prototype.matchAll = matchAll;
  }
  expect(found).toHaveLength(200);
  expect(found!.every((macro) => macro.name === 'foo')).toBe(true);
  expect(bindingScans).toBeLessThanOrEqual(1);
});

it('reports long unknown names without quadratic suggestion work (#623)', () => {
  const name = 'a'.repeat(2000);
  const min = Math.min;
  let comparisons = 0;
  Math.min = (...values: number[]) => {
    comparisons++;
    return min(...values);
  };
  let diagnostics;
  try {
    diagnostics = validateStoryMarkup(
      [
        { name: 'Start', content: `[[${name}b]]` },
        { name: name + 'c', content: '' },
      ],
      getMacroRegistry(),
    );
  } finally {
    Math.min = min;
  }
  expect(diagnostics).toMatchObject([
    { code: 'unknown-passage', data: { name: name + 'b' } },
  ]);
  expect(comparisons).toBeLessThan(100_000);
});

it('bounds suggestion comparisons across many candidate macros (#623)', () => {
  const min = Math.min;
  let comparisons = 0;
  Math.min = (...values: number[]) => {
    comparisons++;
    return min(...values);
  };
  let diagnostics;
  try {
    diagnostics = validateMarkup(
      [{ name: 'Start', content: `{${'b'.repeat(80)}}` }],
      {
        isKnownMacro: () => false,
        macroNames: Array.from({ length: 1000 }, (_, i) => 'a'.repeat(80) + i),
      },
    );
  } finally {
    Math.min = min;
  }
  expect(diagnostics).toMatchObject([{ code: 'unknown-macro' }]);
  expect(comparisons).toBeLessThan(110_000);
});

it.each([false, true])(
  'positions many diagnostics without rescanning source prefixes (tolerant: %s, #624)',
  (tolerant) => {
    const source = (tolerant ? '{/bad}\n' : '{bad}\n').repeat(400);
    const indexOf = String.prototype.indexOf;
    let scans = 0;
    String.prototype.indexOf = function (this: string, search, position) {
      if (this === source && search === '\n') scans++;
      return indexOf.call(this, search, position);
    };
    let diagnostics;
    try {
      diagnostics = validateMarkup([{ name: 'Start', content: source }], {
        isKnownMacro: () => false,
        tolerant,
      });
    } finally {
      String.prototype.indexOf = indexOf;
    }
    expect(diagnostics).toHaveLength(400);
    expect(diagnostics![0]).toMatchObject({ line: 1, column: 1, start: 0 });
    expect(diagnostics![399]).toMatchObject({
      line: 400,
      column: 1,
      start: (tolerant ? 7 : 6) * 399,
    });
    expect(scans).toBeLessThan(2000);
  },
);
