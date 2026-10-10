import { describe, it, expect } from 'vitest';
import {
  collectStoryPassageReferences,
  passagePieces,
  pieceOffset,
  type Piece,
} from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

const macros = getMacroRegistry();

/** The pieces of `src`, each as its kind, the text it is at, and nested or not. */
function summary(
  src: string,
  list: readonly Piece[] = passagePieces(src, macros),
) {
  return list.map((p) => {
    const length =
      p.kind === 'code'
        ? p.code.length
        : p.kind === 'text'
          ? p.text.length
          : p.length;
    return [
      p.kind + (p.nested ? ' (nested)' : ''),
      src.slice(p.offset, p.offset + length),
    ];
  });
}

describe('passagePieces (#451)', () => {
  it('finds the code, the passage names and the texts of a passage', () => {
    const src =
      '{$gold + 1} {do}$a = 1;{/do} {if $a > 1}x{elseif $b}y{/if} ' +
      '{set $c = 2} [[Go->Hall]] {goto "Roof"} {button "Pay {$gold}"}x{/button}';
    expect(summary(src)).toEqual([
      ['code', '$gold + 1'],
      ['code', '$a = 1;'],
      ['code', '$a > 1'],
      ['code', '$b'],
      ['code', '$c = 2'],
      ['passage', 'Hall'],
      ['passage', '"Roof"'],
      ['text', 'Pay {$gold}'],
    ]);
  });

  it('gives goals and labels, and marks a passage expression', () => {
    const src = '{do}x{/do}{$a + 1}{if $b}1{/if}{goto $room}';
    const pieces = passagePieces(src, macros);
    expect(
      pieces.map((p) => p.kind === 'code' && [p.goal, p.label, p.passage]),
    ).toEqual([
      ['statements', '{do}', undefined],
      ['expression', '{$a + 1}', undefined],
      ['expression', '{if $b}', undefined],
      ['expression', '{goto $room}', true],
    ]);
  });

  it('finds the code in a string a macro declares to hold code', () => {
    const src = '{watch "$gold > 5" run "$x = 1" goto "Hall"}';
    const pieces = passagePieces(src, macros);
    expect(summary(src, pieces)).toEqual([
      ['code', '$gold > 5'],
      ['code', '$x = 1'],
      ['passage', '"Hall"'],
    ]);
    expect(pieces.map((p) => p.kind === 'code' && p.inString)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('finds the body of {dialog} as a passage name', () => {
    const src = 'a {dialog "Title"}Hall{/dialog}';
    expect(summary(src)).toContainEqual(['passage', 'Hall']);
  });

  it("reports arguments that do not have their parameters' forms", () => {
    const src = '{link Go}x{/link}';
    const [piece] = passagePieces(src, macros);
    expect(piece).toMatchObject({ kind: 'argument-error', macro: 'link' });
    expect(
      src.slice(
        piece!.offset,
        piece!.offset + (piece as { length: number }).length,
      ),
    ).toBe('Go');
  });

  it('finds the code of attributes that hold code and the text of the others', () => {
    const src = `<a onclick="{$a}" title='Hi {$b}' class=x>t</a>`;
    expect(summary(src)).toEqual([
      ['code', '$a'],
      ['text', 'Hi {$b}'],
      ['text', 'x'],
    ]);
  });

  it('skips a duplicate attribute, which the browser ignores', () => {
    const src = '<a title="one {$a}" TITLE="two {$b}">';
    expect(summary(src)).toEqual([['text', 'one {$a}']]);
  });

  it('puts nested pieces after their text, with offsets in the source', () => {
    const src = 'é {button "a {if $x > }b{/if} [[c]]"}y{/button}';
    const pieces = passagePieces(src, macros);
    const [text, ...nested] = pieces;
    expect(text).toMatchObject({
      kind: 'text',
      where: 'In the label of {button}: ',
    });
    expect(
      nested.every((p) => p.nested && p.where === 'In the label of {button}: '),
    ).toBe(true);
    expect(summary(src, nested)).toEqual([['code (nested)', '$x >']]);
  });

  it('carries the tokens and errors of the markup in a text', () => {
    const src = '\r\n😀 {button "go {if $a}"}x{/button}';
    const [text] = passagePieces(src, macros);
    if (text?.kind !== 'text') throw new Error('not a text');
    expect(text.errors).toHaveLength(1);
    const [error] = text.errors;
    expect(error).toMatchObject({ code: 'unclosed-block' });
    expect(src.slice(error!.offset, error!.end)).toBe('{if $a}');
    expect(error!.line).toBe(2);
    expect(text.tokens.map((t) => src.slice(t.start, t.end))).toContain(
      '{if $a}',
    );
    // Well-formed: no errors
    const [ok] = passagePieces('{button "a {$b}"}x{/button}', macros);
    expect(ok).toMatchObject({ kind: 'text', errors: [] });
  });

  it('maps nested offsets back over escapes, two deep', () => {
    const src =
      '{button "say \\"hi\\" {button \\"{if $deep > }\\"}x{/button}"}y{/button}';
    const deep = passagePieces(src, macros).find(
      (p) => p.kind === 'code',
    ) as Extract<Piece, { kind: 'code' }>;
    expect(deep).toMatchObject({ nested: true, code: '$deep >' });
    expect(src.slice(deep.offset, deep.offset + deep.code.length)).toBe(
      '$deep >',
    );
    // Characters of a nested piece with escapes in it are not where its
    // length says
    const named = passagePieces(
      '{button "{goto \\"Roof\\"}"}x{/button}',
      macros,
    ).find((p) => p.kind === 'passage')!;
    expect(named).toMatchObject({ name: 'Roof', nested: true, length: 8 });
  });

  it('maps the offsets of the code in a string with escapes', () => {
    const src = '{watch "$a == \\"x\\" +" run "$y = 1"}';
    const code = passagePieces(src, macros).find((p) => p.kind === 'code')!;
    if (code.kind !== 'code') throw new Error('not code');
    expect(code.code).toBe('$a == "x" +');
    expect(code.sourceOffsets).toHaveLength(code.code.length + 1);
    // The character at an index is where the offsets say
    const at = pieceOffset(code, code.code.indexOf('x'));
    expect(src[at]).toBe('x');
    expect(
      src.slice(pieceOffset(code, 0), pieceOffset(code, code.code.length)),
    ).toBe('$a == \\"x\\" +');
  });

  it('reads half-typed markup', () => {
    const src = '{if $a > } [[Hall]] {$b + } {goto "Roof"} {oops <div';
    expect(summary(src)).toEqual([
      ['code', '$a >'],
      ['passage', 'Hall'],
      ['code', '$b + '],
      ['passage', '"Roof"'],
    ]);
  });

  it('counts offsets in UTF-16 over CRLF and multibyte text', () => {
    const src = '😀é\r\n[[é->Hall]]\r\n{$a}';
    expect(summary(src)).toEqual([['passage', 'Hall']]);
  });

  it('needs no macros for the code that needs no declaration', () => {
    const src = '{$a} {do}b{/do} [[Hall]] {if $c}d{/if}';
    expect(summary(src, passagePieces(src))).toEqual([
      ['code', 'b'],
      ['passage', 'Hall'],
      ['code', '$c'],
    ]);
  });

  it('takes the block macros from the macros given', () => {
    const src = '{card "{unclosed"}x{/card}';
    const custom = [
      {
        name: 'card',
        block: true,
        subMacros: [],
        interpolate: true,
        parameters: [{ name: 'label', type: 'string' as const }],
      },
    ];
    const pieces = passagePieces(src, custom);
    const text = pieces.find((p) => p.kind === 'text');
    expect(text).toMatchObject({ kind: 'text', text: '{unclosed' });
  });

  it('is what collectStoryPassageReferences filters, nested names included', () => {
    const src =
      '[[Go->Hall]] {button "{goto \\"Roof\\"}"}x{/button} {goto $room}';
    const refs = collectStoryPassageReferences(src, macros);
    expect(refs.map((r) => [r.macro, src.slice(r.start, r.end)])).toEqual([
      ['link', 'Hall'],
      ['goto', '\\"Roof\\"'],
      ['goto', '$room'],
    ]);
  });
});
