import { expect, it } from 'vitest';
import {
  passagePieces,
  pieceOffset,
  collectStoryPassageReferences,
  type PassagePiece,
} from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

const macros = getMacroRegistry();
const fixtures: [string, string][][] = [
  [['', '']],
  [['Hall', 'Hall']],
  [
    ['T{', 'T{'],
    [String.raw`\u0024`, '$'],
    ['n}', 'n}'],
  ],
  [
    ['T', 'T'],
    [String.raw`\u007b`, '{'],
    [String.raw`\x24`, '$'],
    ['n}', 'n}'],
  ],
  [
    ['T{$n + ', 'T{$n + '],
    [String.raw`\"`, '"'],
    ['}', '}'],
    [String.raw`\"`, '"'],
    ['}', '}'],
  ],
  [
    [String.raw`\u{1f600}`, '😀'],
    ['{$n}', '{$n}'],
  ],
  [
    [String.raw`\uD83D`, '\ud83d'],
    [String.raw`\uDE00`, '\ude00'],
    ['{$n}', '{$n}'],
  ],
  [
    ['\\\n', ''],
    ['T{$n}', 'T{$n}'],
    ['\\\r\n', ''],
  ],
  [
    ['T', 'T'],
    ['\\\r\n', ''],
    ['{$n}', '{$n}'],
  ],
  [['\\\n', '']],
  [
    ['T', 'T'],
    ['\\\r', ''],
  ],
  [
    ['T', 'T'],
    ['\\\u2028', ''],
  ],
  [
    ['T', 'T'],
    ['\\\u2029', ''],
  ],
  [
    [String.raw`\{`, '{'],
    [String.raw`\$`, '$'],
    ['n', 'n'],
    [String.raw`\}`, '}'],
  ],
];

it.each(fixtures.map((units) => [units] as const))(
  'maps every decoded passage-name boundary for %j (#793)',
  (units) => {
    const written = '"' + units.map(([raw]) => raw).join('') + '"';
    const name = units.map(([, value]) => value).join('');
    const source = '{link "Go" ' + written + '}{/link}';
    const at = source.indexOf(written);
    const expected: number[] = [];
    let cursor = at + 1;
    for (const [raw, value] of units) {
      for (let i = 0; i < value.length; i++)
        expected.push(cursor + (raw === value ? i : 0));
      cursor += raw.length;
    }
    expected.push(cursor);
    const piece = passagePieces(source, macros).find(
      (p) => p.kind === 'passage',
    ) as PassagePiece;
    expect(piece).toMatchObject({ name, offset: at, length: written.length });
    expect(piece.sourceOffsets).toEqual(expected);
    expect(
      Array.from({ length: name.length + 1 }, (_, i) => pieceOffset(piece, i)),
    ).toEqual(expected);
    expect(collectStoryPassageReferences(source, macros)).toContainEqual({
      macro: 'link',
      target: { kind: 'name', name },
      start: at,
      end: at + written.length,
    });
  },
);

it('composes passage-name maps through nested quoted labels and attributes (#793)', () => {
  let source = String.raw`{goto "T{\u0024n + \"}\"}"}`;
  let piece = passagePieces(source, macros).find(
    (p) => p.kind === 'passage',
  ) as PassagePiece;
  let expected = Array.from({ length: piece.name.length + 1 }, (_, i) => {
    const raw = [1, 2, 3, 9, 10, 11, 12, 13, 15, 16, 18, 19];
    return source.indexOf('"') + raw[i]!;
  });
  // The explicit decoded-name map is independent of the enclosing label's
  // quote/backslash encoding. Compose that encoding at every depth.
  expect(piece.name).toBe('T{$n + "}"}');
  for (let depth = 0; depth < 3; depth++) {
    const outer: number[] = [];
    let encoded = '';
    for (let i = 0; i < source.length; i++) {
      outer.push('{button "'.length + encoded.length);
      encoded += /["\\]/.test(source[i]!) ? '\\' + source[i] : source[i];
    }
    outer.push('{button "'.length + encoded.length);
    expected = expected.map((offset) => outer[offset]!);
    source = '{button "' + encoded + '"}x{/button}';
    piece = passagePieces(source, macros).find(
      (p) => p.kind === 'passage',
    ) as PassagePiece;
    expect(piece.name).toBe('T{$n + "}"}');
    expect(piece.sourceOffsets).toEqual(expected);
    const refs = collectStoryPassageReferences(source, macros);
    expect(refs[0]).toMatchObject({
      start: piece.offset,
      end: piece.offset + piece.length,
    });
  }
  const prefix = "<div title='";
  const attributed = prefix + source + "'></div>";
  const nested = passagePieces(attributed, macros).find(
    (p) => p.kind === 'passage',
  ) as PassagePiece;
  expect(nested.sourceOffsets).toEqual(
    expected.map((offset) => prefix.length + offset),
  );
});

it.each([
  '{watch "$ok" goto "H\\\"all"}',
  '{dialog "Title"}"H\\\"all"{/dialog}',
])(
  'maps quote-decoded passage holders without changing whole-name spans: %s (#793)',
  (source) => {
    const piece = passagePieces(source, macros).find(
      (p) => p.kind === 'passage',
    ) as PassagePiece;
    expect(piece.name).toBe('H"all');
    expect(
      source.slice(
        pieceOffset(piece, 0),
        pieceOffset(piece, piece.name.length),
      ),
    ).toBe('H\\"all');
    expect(source.slice(piece.offset, piece.offset + piece.length)).toBe(
      '"H\\"all"',
    );
  },
);

it('maps quoted nested names through escaped enclosing labels (#793)', () => {
  const source = '{button "{goto \\"Hall\\"}"}x{/button}';
  const piece = passagePieces(source, macros).find(
    (p) => p.kind === 'passage',
  ) as PassagePiece;
  expect(piece.name).toBe('Hall');
  expect(pieceOffset(piece, 0)).toBe(source.indexOf('Hall'));
  expect(pieceOffset(piece, piece.name.length)).toBe(
    source.indexOf('Hall') + 4,
  );
});

it('maps JavaScript-decoded widget passage holders and trailing continuations (#793)', () => {
  const source = String.raw`{mapped "\u{1f600}T{\u0024n}` + '\\\r\n"}';
  const piece = passagePieces(source, [
    ...macros,
    {
      name: 'mapped',
      block: false,
      subMacros: [],
      widget: { params: ['@target'], holds: { '@target': 'passage' } },
    },
  ]).find((p) => p.kind === 'passage') as PassagePiece;
  expect(piece.name).toBe('😀T{$n}');
  expect(piece.sourceOffsets).toHaveLength(piece.name.length + 1);
  expect(pieceOffset(piece, 0)).toBe(source.indexOf('\\u{1f600}'));
  expect(pieceOffset(piece, 1)).toBe(pieceOffset(piece, 0));
  expect(pieceOffset(piece, 4)).toBe(source.indexOf('\\u0024'));
  expect(pieceOffset(piece, piece.name.length)).toBe(source.lastIndexOf('"'));
});

it.each(['[[Go->Hall]]', '{dialog "Title"}Hall{/dialog}'])(
  'preserves direct boundary mapping for unquoted names in %s (#793)',
  (source) => {
    const piece = passagePieces(source, macros).find(
      (p) => p.kind === 'passage',
    ) as PassagePiece;
    expect(pieceOffset(piece, 0)).toBe(source.indexOf('Hall'));
    expect(pieceOffset(piece, 4)).toBe(source.indexOf('Hall') + 4);
  },
);
