import { expect, it } from 'vitest';
import {
  discoverMacros,
  tokenizeMarkupTolerant,
  validateStoryMarkup,
  type ToolingMacro,
} from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';
import { validateMarkup } from '../../src/markup/validate';
import { sourcePositions } from '../../src/markup/line-column';
import { splitSigilTemplate } from '../../src/markup/code-attributes';
import { defaultCodeEnd } from '../../src/markup/code-end';
import { vi } from 'vitest';

it('indexes companion metadata once for many definitions and tokens (#684)', () => {
  const n = 2000;
  let reads = 0;
  const macros: ToolingMacro[] = Array.from({ length: n }, (_, i) => ({
    get name() {
      reads++;
      return `m${i}`;
    },
    block: false,
    get subMacros() {
      reads++;
      return [];
    },
  }));
  const source = '{m0}'.repeat(n);
  expect(
    validateStoryMarkup([{ name: 'Start', content: source }], macros),
  ).toEqual([]);
  expect(tokenizeMarkupTolerant(source, { macros }).errors).toEqual([]);
  expect(reads).toBeLessThan(n * 100);
});

it('discovers a macro after many unmatched bracket kinds in bounded time (#640)', () => {
  const source =
    'const cfg={name:"Valid"};\n' +
    '('.repeat(24000) +
    ']'.repeat(24000) +
    '\nStory.defineMacro(cfg);';
  const start = performance.now();
  expect(discoverMacros(source).map(({ name }) => name)).toEqual(['Valid']);
  expect(performance.now() - start).toBeLessThan(1500);
});

it.each(['', '}', '{$ok}'])(
  'does not rescan unclosed code-attribute sigils before %j (#641)',
  (suffix) => {
    const literal = '{$x '.repeat(2000);
    const value = "console.log('" + literal + suffix + "')";
    const scan = vi.spyOn(defaultCodeEnd, 'closeBrace');
    try {
      expect(splitSigilTemplate(value)).toEqual(
        suffix
          ? [
              {
                text:
                  "console.log('" +
                  (suffix === '}' ? literal.slice(0, -4) : literal),
              },
              { expr: suffix === '}' ? '$x ' : '$ok' },
              { text: "')" },
            ]
          : [{ text: value }],
      );
      expect(scan.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      scan.mockRestore();
    }
    if (!suffix)
      expect(
        validateStoryMarkup(
          [{ name: 'Start', content: `<div onclick="${value}"></div>` }],
          [],
          { tolerant: true },
        ),
      ).toEqual([]);
  },
);

it('keeps later closed and incomplete attribute expressions (#641)', () => {
  // Syntax-error recovery can end at an inner brace even though the outer
  // interpolation is not balanced; indexing must retain that diagnostic span.
  expect(splitSigilTemplate('{$x + {a: }')).toEqual([{ expr: '$x + {a: ' }]);
  expect(splitSigilTemplate('{$x + "}"}')).toEqual([{ expr: '$x + "}"' }]);
  expect(splitSigilTemplate('{$x { {$ok} tail')).toEqual([
    { text: '{$x { ' },
    { expr: '$ok' },
    { text: ' tail' },
  ]);
  expect(splitSigilTemplate('literal {$x {', true)).toEqual([
    { text: 'literal ' },
    { expr: '$x {' },
  ]);
});

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

it.each([
  ['arrays', '['.repeat(3000) + '0' + ']'.repeat(3000)],
  ['objects', '{extra:'.repeat(3000) + '0' + '}'.repeat(3000)],
  ['spreads', '{...'.repeat(3000) + '{}' + '}'.repeat(3000)],
  ['groups', '('.repeat(3000) + '0' + ')'.repeat(3000)],
  ['templates', '`x${'.repeat(3000) + '0' + '}`'.repeat(3000)],
])('bounds config reading for deeply nested %s (#631)', (_kind, value) => {
  const source = `Story.defineMacro({extra: ${value}, name: "First", block: true});
Story.defineMacro({name: "Later"});`;
  expect(
    discoverMacros(source).map(({ name, block }) => [name, block]),
  ).toEqual([
    ['First', true],
    ['Later', false],
  ]);
});

it('keeps properties after a deeply nested config spread (#631)', () => {
  const source = `Story.defineMacro({...${'{...'.repeat(3000)}{}${'}'.repeat(3000)}, name: "After"});`;
  expect(discoverMacros(source).map(({ name }) => name)).toEqual(['After']);
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
