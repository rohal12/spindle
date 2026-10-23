import { describe, expect, it } from 'vitest';
import {
  completionContext,
  pieceOffset,
  type ToolingMacro,
} from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

const macros = getMacroRegistry();
const atEnd = (source: string, custom: Iterable<ToolingMacro> = macros) =>
  completionContext(source, source.length, custom);

describe('completionContext (#632)', () => {
  it.each([
    '{print $obj.',
    '{$obj.',
    '{$',
    '{%',
    '{_',
    '{@',
    '<span title="{$obj.',
    '{button "{$obj.',
    '{print `$obj. ${$obj.',
    '{print `${',
    '{if $obj.',
    '{set $obj.',
    '{do}$obj.',
    '[[Go {$obj.',
  ])('exposes executable code while typing %s', (source) => {
    const context = atEnd(source);
    expect(context.kind).toBe('code');
    if (context.kind !== 'code') return;
    expect(context.cursor).toBe(context.code.length);
    expect(pieceOffset(context, context.cursor)).toBe(source.length);
  });

  it.each([
    'prose $obj.',
    '{print "$obj.',
    "{print '$obj.",
    '{print `$obj.',
    '{print `${$x} $obj.',
    '{print /* $obj.',
    '{print // $obj.',
    '{print /$obj.',
    '{button "$obj.',
    '<span title="$obj.',
    '<!-- {$obj.',
    '\\{$obj.',
    '{unknown $obj.',
    '{checkbox "$obj.',
    '{print $obj.} prose',
  ])('suppresses completion in literal text %s', (source) => {
    expect(atEnd(source)).toEqual({ kind: 'literal' });
  });

  it('uses the cursor prefix even with finished markup after it', () => {
    const source = '{print "$obj." + $obj.field} prose';
    expect(completionContext(source, source.indexOf('."') + 1, macros)).toEqual(
      { kind: 'literal' },
    );
    expect(
      completionContext(source, source.indexOf('field') + 2, macros),
    ).toMatchObject({ kind: 'code', code: '"$obj." + $obj.fi' });
    expect(atEnd(source)).toEqual({ kind: 'literal' });
  });

  it('resumes code after strings, regexes, comments and template literals', () => {
    for (const value of ['"x"', '/x/', '/* x */', '`x`']) {
      expect(atEnd(`{print ${value}`)).toMatchObject({ kind: 'code' });
    }
  });

  it('uses parameter metadata, including nested options and interpolation defaults', () => {
    const custom: ToolingMacro[] = [
      {
        name: 'plain',
        block: false,
        subMacros: [],
        parameters: [{ name: 'label', type: 'text' }],
      },
      {
        name: 'label',
        block: false,
        subMacros: [],
        interpolate: true,
        parameters: [{ name: 'label', type: 'string' }],
      },
      {
        name: 'custom',
        block: false,
        subMacros: [],
        parameters: [
          {
            name: 'options',
            type: 'options',
            parameters: [
              { name: 'run', type: 'string', holds: 'statements' },
              { name: 'label', type: 'string', holds: 'markup' },
            ],
          },
        ],
      },
    ];
    expect(atEnd('{plain "{$obj.', custom)).toEqual({ kind: 'literal' });
    expect(atEnd('{label "{$obj.', custom)).toMatchObject({
      kind: 'code',
      code: '$obj.',
    });
    expect(atEnd('{custom run "$obj.', custom)).toMatchObject({
      kind: 'code',
      code: '$obj.',
      goal: 'statements',
    });
    expect(atEnd('{custom label "{$obj.', custom)).toMatchObject({
      kind: 'code',
      code: '$obj.',
    });
  });

  it('maps UTF-16 offsets through multiple escaped quoted markup labels', () => {
    const source = '😀 {button "say \\"hi\\" {button \\"inner {$obj.';
    const context = atEnd(source);
    expect(context).toMatchObject({ kind: 'code', code: '$obj.' });
    if (context.kind !== 'code') return;
    expect(pieceOffset(context, 0)).toBe(source.indexOf('$obj.'));
    expect(pieceOffset(context, context.cursor)).toBe(source.length);
  });

  it('keeps nested unfinished macro quotes inside an HTML attribute', () => {
    const source = '<span title="{button "label {$obj.';
    const context = atEnd(source);
    expect(context).toMatchObject({ kind: 'code', code: '$obj.' });
    if (context.kind !== 'code') return;
    expect(pieceOffset(context, 0)).toBe(source.indexOf('$'));
    expect(pieceOffset(context, context.cursor)).toBe(source.length);
  });

  it('maps escapes inside code-holding strings', () => {
    const source = '{watch "\\"hello\\" + $obj.';
    const context = atEnd(source);
    expect(context).toMatchObject({ kind: 'code', code: '"hello" + $obj.' });
    if (context.kind !== 'code') return;
    expect(pieceOffset(context, context.code.indexOf('$'))).toBe(
      source.indexOf('$'),
    );
    expect(pieceOffset(context, context.cursor)).toBe(source.length);
  });

  it('finds sigil displays in code attributes without treating arbitrary braces as markup', () => {
    expect(atEnd('<a onclick="{$obj.')).toMatchObject({
      kind: 'code',
      code: '$obj.',
    });
    expect(atEnd('<a onclick="() => {print $obj.')).toEqual({
      kind: 'literal',
    });
  });

  it('recovers around earlier malformed markup and ignores duplicate attributes', () => {
    expect(atEnd('{/bad arg} prose {print $obj.')).toMatchObject({
      kind: 'code',
    });
    expect(atEnd('<span title="one" TITLE="{$obj.')).toEqual({
      kind: 'literal',
    });
  });

  it('reads code-attribute sigils inside other literal braces', () => {
    expect(atEnd('<a onclick="() => { const x = {$obj.')).toMatchObject({
      kind: 'code',
      code: '$obj.',
    });
    expect(atEnd('<a onclick="{$')).toMatchObject({ kind: 'code', code: '$' });
  });

  it('maps JavaScript escapes in unfinished widget arguments', () => {
    const custom: ToolingMacro[] = [
      {
        name: 'Card',
        block: false,
        subMacros: [],
        widget: { params: ['@label'], holds: { '@label': 'markup' } },
      },
    ];
    const source = '{Card "\\x7b$obj.';
    const context = atEnd(source, custom);
    expect(context).toMatchObject({ kind: 'code', code: '$obj.' });
    if (context.kind !== 'code') return;
    expect(pieceOffset(context, 0)).toBe(source.indexOf('$'));
    expect(pieceOffset(context, context.cursor)).toBe(source.length);
  });

  it('requires a UTF-16 cursor within the source', () => {
    for (const cursor of [-1, 2, 0.5, NaN]) {
      expect(() => completionContext('x', cursor, macros)).toThrow(RangeError);
    }
    expect(completionContext('', 0)).toEqual({ kind: 'literal' });
  });
});
