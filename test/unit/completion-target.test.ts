import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  completionTarget,
  passagePieces,
  pieceOffset,
  validateStoryMarkup,
} from '../../src/tooling';

const macros = getMacroRegistry();

it.each([String.raw`\u006f`, String.raw`\u{6f}`])(
  'replaces the escaped suffix of a story root (%s, #706)',
  (suffix) => {
    const source = `{print $fo${suffix}} prose`;
    const target = completionTarget(source, 10, macros);
    expect(target).toMatchObject({
      kind: 'code',
      code: `$fo${suffix}`,
      cursor: 3,
      identifier: {
        kind: 'root',
        start: 0,
        end: 3 + suffix.length,
        name: 'foo',
      },
    });
    if (target.kind !== 'code' || !target.identifier) return;
    const edited =
      source.slice(0, pieceOffset(target, target.identifier.start)) +
      '$foobar' +
      source.slice(pieceOffset(target, target.identifier.end));
    expect(edited).toBe('{print $foobar} prose');
    expect(
      validateStoryMarkup([{ name: 'Start', content: edited }], macros),
    ).toEqual([]);
  },
);

it.each(['$foo', 'fóo', String.raw`fo\u006f`, String.raw`fo\u{6f}`])(
  'exposes the complete member %s and its dot (#706)',
  (field) => {
    const source = `{print $obj.${field}}`;
    const target = completionTarget(source, source.indexOf(field) + 2, macros);
    expect(target).toMatchObject({
      kind: 'code',
      identifier: {
        kind: 'member',
        start: 5,
        end: 5 + field.length,
        dotStart: 4,
      },
    });
    if (target.kind !== 'code' || !target.identifier) return;
    const edited =
      source.slice(0, pieceOffset(target, target.identifier.dotStart!)) +
      '["first-name"]' +
      source.slice(pieceOffset(target, target.identifier.end));
    expect(edited).toBe('{print $obj["first-name"]}');
    expect(
      validateStoryMarkup([{ name: 'Start', content: edited }], macros),
    ).toEqual([]);
  },
);

it.each([
  ['{button "{print $obj.fo\\\\u006f}', '}"}x{/button}'],
  ['{button "{print $obj.fo\\\\u006f}"}x{/button}', ''],
  [
    '<span title=\'{button "{print $obj.fo\\\\u006f}',
    '}"}x{/button}\'></span>',
  ],
  [
    '{button "{button \\"{print $obj.fo\\\\\\\\u006f}',
    '}\\"}x{/button}"}x{/button}',
  ],
])(
  'maps the suffix through complete or unfinished labels (%s, #706)',
  (source, closing) => {
    const cursor = source.indexOf('.fo') + 3;
    const target = completionTarget(source, cursor, macros);
    expect(target).toMatchObject({
      kind: 'code',
      identifier: { kind: 'member', name: 'foo' },
    });
    if (target.kind !== 'code' || !target.identifier) return;
    let text = '["first-name"]';
    for (const container of [...(target.containers ?? [])].reverse()) {
      if (container.kind === 'string') text = text.replace(/[\\'"]/g, '\\$&');
    }
    const start = pieceOffset(target, target.identifier.dotStart!);
    const end = pieceOffset(target, target.identifier.end);
    expect(source.slice(end).startsWith('}')).toBe(true);
    const edited = source.slice(0, start) + text + source.slice(end) + closing;
    expect(
      validateStoryMarkup([{ name: 'Start', content: edited }], macros),
    ).toEqual([]);
    expect(passagePieces(edited, macros)).toContainEqual(
      expect.objectContaining({ kind: 'code', code: '$obj["first-name"]' }),
    );
  },
);

it('supports transient repair, empty members, and suppresses literal cursors (#706)', () => {
  expect(completionTarget('{print %fo}', 9, macros)).toMatchObject({
    kind: 'code',
    identifier: { kind: 'root', name: 'fo', start: 0, end: 3 },
  });
  expect(completionTarget('{print %}', 8, macros)).toMatchObject({
    kind: 'code',
    identifier: { kind: 'root', name: '', start: 0, end: 1 },
  });
  expect(completionTarget('{print $obj.}', 12, macros)).toMatchObject({
    kind: 'code',
    identifier: { kind: 'member', start: 5, end: 5, dotStart: 4 },
  });
  expect(completionTarget('{print "$foo"}', 11, macros)).toEqual({
    kind: 'literal',
  });
});

it.each([
  '<a onclick="{$obj.fo\\u006f}">x</a>',
  '[[Go {print $obj.fo\\u006f}->Hall]]',
  '<span title="{print $obj.fo\\u{6f}}">x</span>',
])(
  'maps full identifier suffixes in attributes and links (%s, #706)',
  (source) => {
    const target = completionTarget(source, source.indexOf('.fo') + 3, macros);
    expect(target).toMatchObject({
      kind: 'code',
      identifier: { kind: 'member', name: 'foo' },
    });
    if (target.kind !== 'code' || !target.identifier) return;
    expect(
      source.slice(
        pieceOffset(target, target.identifier.start),
        pieceOffset(target, target.identifier.end),
      ),
    ).toMatch(/^fo\\u(?:006f|\{6f\})$/);
  },
);

it('maps JavaScript encoded widget labels including the identifier suffix (#706)', () => {
  const custom = [
    ...macros,
    {
      name: 'Card',
      block: false,
      subMacros: [],
      widget: { params: ['@label'], holds: { '@label': 'markup' as const } },
    },
  ];
  const source = String.raw`😀\r\n{Card "\x7bprint $fo\\u{6f}}"}`;
  const target = completionTarget(source, source.indexOf('$fo') + 3, custom);
  expect(target).toMatchObject({
    kind: 'code',
    identifier: { kind: 'root', name: 'foo' },
    containers: [{ kind: 'string', escapes: 'javascript' }],
  });
  if (target.kind !== 'code' || !target.identifier) return;
  expect(
    source.slice(
      pieceOffset(target, target.identifier.start),
      pieceOffset(target, target.identifier.end),
    ),
  ).toBe(String.raw`$fo\\u{6f}`);
});

it('repairs a bare transient sigil where an operand is expected (#706)', () => {
  const source = '{print ($x + %)}';
  expect(
    completionTarget(source, source.indexOf('%') + 1, macros),
  ).toMatchObject({
    kind: 'code',
    identifier: { kind: 'root', name: '', start: 6, end: 7 },
  });
});
