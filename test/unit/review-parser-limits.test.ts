import { expect, it } from 'vitest';
import {
  passagePieces,
  parseCode,
  tokenizeMarkupTolerant,
  validateStoryMarkup,
  variableReferences,
  type ToolingMacro,
} from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';
import { widgetDefinitions } from '../../src/widgets/widget-def';
import { parameterLookup, type ParametersOf } from '../../src/code-check';

const macros = getMacroRegistry();

it('bounds recursive label scanning during pre-validation widget discovery (#673)', () => {
  const content =
    '{widget "deep"}' +
    '{button '.repeat(400) +
    'x' +
    '}{/button}'.repeat(400) +
    '{/widget}';
  const lookup = parameterLookup(macros);
  let reads = 0;
  const counted: ParametersOf = (name) => {
    reads++;
    return lookup(name);
  };
  counted.source = lookup.source;
  expect(
    widgetDefinitions([{ name: 'StoryInit', content }], counted),
  ).toMatchObject([{ name: 'deep', block: false }]);
  expect(reads).toBeLessThan(100);
});

it.each([false, true])(
  'appends large shallow token batches, including recovery prefixes (%s) (#674)',
  (recover) => {
    const content = '<br>'.repeat(150_000) + (recover ? '{print ' : '');
    const result = tokenizeMarkupTolerant(content);
    expect(result.tokens.filter((t) => t.type === 'html')).toHaveLength(
      150_000,
    );
    expect(result.errors).toHaveLength(recover ? 1 : 0);
    expect(
      validateStoryMarkup([{ name: 'Unvisited', content }], macros, {
        tolerant: true,
      }).map((d) => d.code),
    ).toEqual(recover ? ['unclosed-macro'] : []);
  },
  20_000,
);

it.each([400, 1200])(
  'bounds nested label scans at %i levels, including variable collection (#673)',
  (depth) => {
    const content =
      '{button '.repeat(depth) + '{$x}' + '}{/button}'.repeat(depth);
    const pieces = passagePieces(content, macros);
    const texts = pieces.filter((p) => p.kind === 'text');
    expect(texts.length).toBeLessThanOrEqual(65);
    expect(texts[texts.length - 1]?.errors).toMatchObject([
      { code: 'nesting-limit' },
    ]);
    expect(variableReferences(content, macros)).toEqual([]);
    for (const tolerant of [false, true]) {
      const diagnostics = validateStoryMarkup(
        [{ name: 'Unvisited', content }],
        macros,
        { tolerant },
      );
      expect(diagnostics).toMatchObject([
        { code: 'nesting-limit', passage: 'Unvisited' },
      ]);
      expect(diagnostics[0]!.start).toBeGreaterThan(0);
      expect(diagnostics[0]!.end).toBeLessThan(content.length);
    }
  },
);

it('bounds unquoted markup-holding arguments without recursive offset overflow (#673)', () => {
  const all: ToolingMacro[] = [
    ...macros,
    {
      name: 'label',
      block: false,
      subMacros: [],
      parameters: [{ name: 'text', type: 'text', holds: 'markup' }],
    },
  ];
  const content = '{label '.repeat(3000) + '{$x}' + '}'.repeat(3000);
  expect(validateStoryMarkup([{ name: 'Start', content }], all)).toMatchObject([
    { code: 'nesting-limit' },
  ]);
  expect(variableReferences(content, all)).toEqual([]);
});

it('retains ordinary nested labels and exact reference positions (#673)', () => {
  const content = '{button '.repeat(12) + '{$x}' + '}{/button}'.repeat(12);
  expect(validateStoryMarkup([{ name: 'Start', content }], macros)).toEqual([]);
  expect(variableReferences(content, macros)).toEqual([
    {
      sigil: '$',
      name: 'x',
      path: [],
      start: content.indexOf('$x'),
      end: content.indexOf('$x') + 2,
    },
  ]);
});

it.each([
  '$x' + '+1'.repeat(4000) + '+%y+"last"',
  '$x' + '.field'.repeat(12_000) + '+%y+"last"',
])(
  'walks long flat expressions without losing references or strings (#675)',
  (code) => {
    const result = parseCode(code);
    expect(result.refs.map((r) => [r.name, r.start, r.read, r.write])).toEqual([
      ['x', 0, true, false],
      ['y', code.indexOf('%y'), true, false],
    ]);
    expect(result.strings).toEqual(['last']);
    expect(
      validateStoryMarkup(
        [{ name: 'Unvisited', content: `{print ${code}}` }],
        macros,
      ),
    ).toEqual([]);
  },
);
