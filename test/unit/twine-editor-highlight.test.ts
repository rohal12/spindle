import { describe, it, expect } from 'vitest';
import {
  highlightSpans,
  openConstructStart,
  type CmStyle,
} from '../../src/twine-editor/highlight';

/** The spans of `text` as [substring, style] pairs. */
function styled(text: string): [string, CmStyle][] {
  return highlightSpans(text).map((s) => [text.slice(s.start, s.end), s.style]);
}

describe('highlightSpans', () => {
  it.each<[string, [string, CmStyle][]]>([
    [
      '{if $hp > 0}ok{/if}',
      [
        ['{if', 'keyword'],
        ['$hp', 'variable-2'],
        ['>', 'operator'],
        ['0', 'number'],
        ['}', 'keyword'],
        ['{/if}', 'keyword'],
      ],
    ],
    [
      '{_t} {@i}',
      [
        ['_t', 'variable-3'],
        ['@i', 'variable-3'],
      ],
    ],
    ['{%x}', [['%x', 'variable-2']]],
    [
      '{set $n = "a"}',
      [
        ['{set', 'keyword'],
        ['$n', 'variable-2'],
        ['=', 'operator'],
        ['"a"', 'string'],
        ['}', 'keyword'],
      ],
    ],
    [
      '{$a + 1}',
      [
        ['$a', 'variable-2'],
        ['+', 'operator'],
        ['1', 'number'],
      ],
    ],
    ['[[Go->Cave]]', [['[[Go->Cave]]', 'link']]],
    [
      '{.big#x $a}',
      [
        ['.big#x', 'attribute'],
        ['$a', 'variable-2'],
      ],
    ],
    [
      '{.big print $a}',
      [
        ['{', 'keyword'],
        ['.big', 'attribute'],
        [' print', 'keyword'],
        ['$a', 'variable-2'],
        ['}', 'keyword'],
      ],
    ],
    [
      '<div class="a">x</div>',
      [
        ['<div', 'tag'],
        ['class', 'attribute'],
        ['"a"', 'string'],
        ['>', 'tag'],
        ['</div>', 'tag'],
      ],
    ],
    ['<br/>', [['<br/>', 'tag']]],
    [
      '<p id=a hidden>',
      [
        ['<p', 'tag'],
        ['id', 'attribute'],
        ['a', 'string'],
        ['hidden', 'attribute'],
        ['>', 'tag'],
      ],
    ],
    ['<!-- note -->', [['<!-- note -->', 'comment']]],
    ['a <!-- x {if $y} --> b', [['<!-- x {if $y} -->', 'comment']]],
    ['{if $x', [['{if $x', 'error']]],
    ['[[Go', [['[[Go', 'error']]],
    ['😀{$a}', [['$a', 'variable-2']]],
  ])('styles %j', (text, expected) => {
    expect(styled(text)).toEqual(expect.arrayContaining(expected));
  });

  it('styles exactly the spans of a small macro', () => {
    expect(styled('{if $hp > 0}ok{/if}')).toEqual([
      ['{if', 'keyword'],
      ['$hp', 'variable-2'],
      ['>', 'operator'],
      ['0', 'number'],
      ['}', 'keyword'],
      ['{/if}', 'keyword'],
    ]);
    expect(styled('plain *prose* text')).toEqual([]);
    expect(highlightSpans('')).toEqual([]);
  });

  it('gives offsets in UTF-16 units after an astral character', () => {
    const text = '😀{$a}';
    expect(highlightSpans(text)).toEqual([
      { start: 3, end: 5, style: 'variable-2' },
    ]);
  });

  it('styles atoms, literals and comments in code', () => {
    expect(styled('{set $a = true}')).toContainEqual(['true', 'atom']);
    expect(styled('{set $a = null}')).toContainEqual(['null', 'atom']);
    expect(styled('{print `t${_b}u` + 0x1F}')).toEqual(
      expect.arrayContaining([
        ['${', 'string'],
        ['_b', 'variable-3'],
        ['}', 'string'],
        ['0x1F', 'number'],
      ]),
    );
    expect(styled('{do}x /* c */ + 1; // d\n{/do}')).toEqual(
      expect.arrayContaining([
        ['/* c */', 'comment'],
        ['// d', 'comment'],
      ]),
    );
  });

  it('styles the strings of arguments that are not code', () => {
    expect(styled('{link "Go" "Cave"}{/link}')).toEqual(
      expect.arrayContaining([
        ['"Go"', 'string'],
        ['"Cave"', 'string'],
      ]),
    );
  });

  it('styles markup in a string argument', () => {
    const text = '{button "Go {$n}"}{/button}';
    expect(styled(text)).toEqual(
      expect.arrayContaining([
        ['"Go {', 'string'],
        ['$n', 'variable-2'],
        ['}"', 'string'],
      ]),
    );
  });

  it('maps code in a string with escapes back to its source offsets', () => {
    expect(styled('{watch "_a == \\"x\\" && $b" goto "D"}')).toEqual(
      expect.arrayContaining([
        ['_a', 'variable-3'],
        ['\\"x\\"', 'string'],
        ['$b', 'variable-2'],
        ['"D"', 'string'],
      ]),
    );
  });

  it('styles markup in attribute values', () => {
    expect(styled('<p class="{$c}">')).toContainEqual(['$c', 'variable-2']);
  });

  it('styles the body of a {do} that is not closed yet', () => {
    expect(styled('{do}\nlet a = $b + 1')).toEqual(
      expect.arrayContaining([
        ['{do}', 'keyword'],
        ['$b', 'variable-2'],
        ['1', 'number'],
      ]),
    );
  });

  it('does not read markup inside a {do} body', () => {
    expect(styled('{do}x = {if: 1};{/do}')).not.toContainEqual([
      '{if',
      'keyword',
    ]);
  });

  it('styles an unclosed comment as a comment, with markup in it', () => {
    expect(styled('a <!-- x {$b}')).toEqual([
      ['<!-- x {', 'comment'],
      ['$b', 'variable-2'],
      ['}', 'comment'],
    ]);
  });

  it('marks an unclosed attribute value from its tag on', () => {
    expect(styled('<div class="a')).toContainEqual(['<div class="a', 'error']);
  });

  it('keeps the markup inside an unclosed macro styled over its error', () => {
    expect(styled('{if {$a}')).toEqual([
      ['{if {', 'error'],
      ['$a', 'variable-2'],
      ['}', 'error'],
    ]);
  });

  it('marks a malformed closer', () => {
    expect(styled('{/if x}')).toEqual([['{/if x}', 'error']]);
  });

  it('returns ordered, non-overlapping spans for any prefix of a passage', () => {
    const passage =
      '{if $hp > 0}<b class="x">[[Go->Cave]]</b>{else}{do}\nlet a = `q${$z}`;\n{/do}{/if}<!-- n -->😀';
    for (let i = 0; i <= passage.length; i++) {
      const spans = highlightSpans(passage.slice(0, i));
      let end = 0;
      for (const span of spans) {
        expect(span.start).toBeGreaterThanOrEqual(end);
        expect(span.end).toBeGreaterThan(span.start);
        end = span.end;
      }
      expect(end).toBeLessThanOrEqual(i);
    }
  });

  it('handles CRLF text', () => {
    expect(styled('{if $a}\r\nx\r\n{/if}')).toContainEqual([
      '$a',
      'variable-2',
    ]);
  });
});

describe('<!-- in code', () => {
  it.each([
    ['{do} s = "<!--"; {/do} x'],
    ['<script>var s = "<!--"; {$x}</script> y'],
    ['<style>/* <!-- */ a{b:c}</style>{$x}'],
    ['{print "<!--"} {$x}'],
    ['{set $a = "<!--"} {$x}'],
    ['{$a + "<!--"} {$x}'],
  ])('is no comment in %j', (text) => {
    expect(openConstructStart(text)).toBe(-1);
    expect(highlightSpans(text).map((s) => s.style)).not.toContain('comment');
  });

  it('is only a JavaScript comment in a {do} body', () => {
    const text = '{do}\n//<!--\n{/do}\n{$x}';
    expect(openConstructStart(text)).toBe(-1);
    expect(styled(text)).toEqual(
      expect.arrayContaining([
        ['//<!--', 'comment'],
        ['$x', 'variable-2'],
      ]),
    );
    expect(styled(text).filter(([, style]) => style === 'comment')).toEqual([
      ['//<!--', 'comment'],
    ]);
  });

  it('is a comment after the code ends', () => {
    expect(openConstructStart('{do}"<!--"{/do} <!-- x')).toBe(16);
    expect(openConstructStart('<script>a</script><!-- x')).toBe(18);
    expect(styled('<script>"<!--"</script> a <!-- x')).toContainEqual([
      '<!-- x',
      'comment',
    ]);
  });

  it('is no comment in a {do} body that is not closed yet', () => {
    expect(openConstructStart('{do}\ns = "<!--"')).toBe(0);
    expect(styled('{do}\ns = "<!--"')).not.toContainEqual(
      expect.arrayContaining(['comment']),
    );
  });
});

describe('numbers in code', () => {
  it('reads an exponent with a sign as one number', () => {
    expect(styled('{print 1e+3 + 0xE+1}')).toEqual(
      expect.arrayContaining([
        ['1e+3', 'number'],
        ['0xE', 'number'],
      ]),
    );
  });
});

describe('openConstructStart', () => {
  it.each([
    ['a {if $x', 2],
    ['<!-- x', 0],
    ['a <!-- x', 2],
    ['{do}\nlet a', 0],
    ['<div class="a', 0],
    ['[[Go', 0],
    ['x {$a + ', 2],
    ['{if $x}', -1],
    ['{do}x{/do}', -1],
    ['<!-- x -->', -1],
    ['<div class="a">', -1],
    ['', -1],
  ])('%j starts an open construct at %d', (text, expected) =>
    expect(openConstructStart(text)).toBe(expected),
  );

  it('returns the earliest of several open constructs', () => {
    expect(openConstructStart('{do}\n<!-- x')).toBe(0);
    expect(openConstructStart('a <!-- x {if')).toBe(2);
  });
});
