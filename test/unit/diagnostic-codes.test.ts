import { describe, it, expect } from 'vitest';
import { formatDiagnostic } from '../../src/markup/validate';
import { validateStoryMarkup } from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

/** Validate `content` as a passage of a story that also has a "Hall". */
function diagnose(content: string) {
  return validateStoryMarkup(
    [
      { name: 'Start', content },
      { name: 'Hall', content: 'The hall.' },
    ],
    getMacroRegistry(),
  );
}

/** The text of the passage a diagnostic points at. */
const slice = (content: string, d: { start: number; end: number }) =>
  content.slice(d.start, d.end);

describe('diagnostic codes and ranges (#447)', () => {
  // content, code, the offending text, the data
  it.each([
    ['{if $a}x', 'unclosed-block', '{if $a}', { name: 'if' }],
    [
      '{if $a}{for $x of $y}z{/if}{/for}',
      'mismatched-closer',
      '{/if}',
      { name: 'for', closer: 'if' },
    ],
    ['x{/if}', 'stray-closer', '{/if}', { name: 'if' }],
    ['{else}', 'misplaced-branch', '{else}', { name: 'else', parent: 'if' }],
    ['a [[b', 'unclosed-link', '[[', undefined],
    ['{$a + ', 'unclosed-expression', '{', undefined],
    ['{if $a', 'unclosed-macro', '{if', undefined],
    ['{/ if}', 'invalid-closer', '{/', undefined],
    ['{if}{/if x}', 'closer-with-arguments', '{/if x}', undefined],
    ['{if}{.a /if}', 'closer-with-selectors', '{.a /if}', undefined],
    ['<div', 'unclosed-tag', '<div', undefined],
    ['<div "x">', 'unexpected-character', '"', undefined],
    ['<a title="x>', 'unclosed-attribute', '"', undefined],
    [
      '{sett 1}',
      'unknown-macro',
      '{sett 1}',
      { name: 'sett', suggestions: ['set'] },
    ],
    ['{link Go}x{/link}', 'argument-error', 'Go', { macro: 'link' }],
    ['{$a b}', 'code-syntax', 'b', undefined],
    [
      '[[Go->Nowhere]]',
      'unknown-passage',
      'Nowhere',
      { name: 'Nowhere', macro: 'link', suggestions: [] },
    ],
    [
      'See [[Hal]]',
      'unknown-passage',
      'Hal',
      { name: 'Hal', macro: 'link', suggestions: ['Hall'] },
    ],
    [
      '{goto Kitchen}',
      'unquoted-passage-name',
      'Kitchen',
      { name: 'Kitchen', macro: 'goto' },
    ],
  ])('%s is %s', (content, code, text, data) => {
    const diagnostics = diagnose(content);
    expect(diagnostics.map((d) => d.code)).toContain(code);
    const d = diagnostics.find((x) => x.code === code)!;
    expect(slice(content, d)).toBe(text);
    if (data) expect(d.data).toEqual(data);
    // The line and column are those of the start
    const before = content.slice(0, d.start).split('\n');
    expect(d.line).toBe(before.length);
    expect(d.column).toBe(before[before.length - 1]!.length + 1);
  });

  it('puts the range of a diagnostic in markup inside a label in the passage', () => {
    const content = 'x\r\n\u{1F600} {button "go {sett}"}y{/button}';
    const [d] = diagnose(content);
    expect(d).toMatchObject({
      code: 'unknown-macro',
      message:
        'In the label of {button}: Unknown macro {sett}. Did you mean {set}?',
    });
    expect(slice(content, d!)).toBe('{sett}');
  });

  it('puts the range of malformed markup inside a label in the passage', () => {
    const content = '<b>é</b>\n{button "{if $a}"}y{/button}';
    const [d] = diagnose(content);
    expect(d).toMatchObject({ code: 'unclosed-block' });
    expect(d!.message).toBe(
      'In the label of {button}: Unclosed {if}: no {/if} closes it',
    );
    expect(slice(content, d!)).toBe('{if $a}');
  });

  it('puts the range of a diagnostic in an attribute value in the passage', () => {
    const content = '<a title=\'a{sett}b\' href="{set}">x</a>';
    const diagnostics = diagnose(content);
    expect(diagnostics.map((d) => slice(content, d))).toEqual(['{sett}']);
    expect(diagnostics[0]!.message).toBe(
      'In the title attribute of <a>: Unknown macro {sett}. Did you mean {set}?',
    );
  });

  it('keeps the message and its one line', () => {
    const [d] = diagnose('x\n{sett 1}');
    expect(formatDiagnostic(d!)).toBe(
      'Passage "Start", line 2, column 1: Unknown macro {sett}. Did you mean {set}?',
    );
  });
});
