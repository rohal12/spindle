import { describe, it, expect } from 'vitest';
import { parseIncludeArgs } from '../../src/components/macros/Include';

describe('parseIncludeArgs', () => {
  it('splits a trailing or leading inline flag off the expression', () => {
    expect(parseIncludeArgs('$target inline')).toEqual({
      nameExpr: '$target',
      inline: true,
    });
    expect(parseIncludeArgs('inline "Nav"')).toEqual({
      nameExpr: '"Nav"',
      inline: true,
    });
  });

  it('reads the word as an operand next to a binary operator', () => {
    expect(parseIncludeArgs('"a" + inline')).toEqual({
      nameExpr: '"a" + inline',
      inline: false,
    });
    expect(parseIncludeArgs('inline + "a"')).toEqual({
      nameExpr: 'inline + "a"',
      inline: false,
    });
  });

  // Counterexamples from the property tests.

  it('applies a trailing flag after a regex literal', () => {
    expect(parseIncludeArgs('$a ? "A" : "B" + /a/ inline')).toEqual({
      nameExpr: '$a ? "A" : "B" + /a/',
      inline: true,
    });
  });

  it('applies a leading flag before a transient variable', () => {
    expect(parseIncludeArgs('inline %tr')).toEqual({
      nameExpr: '%tr',
      inline: true,
    });
    expect(parseIncludeArgs('inline % 2')).toEqual({
      nameExpr: 'inline % 2',
      inline: false,
    });
  });

  it('skips a comment before a trailing flag', () => {
    expect(parseIncludeArgs('"a" + /* note */ inline')).toEqual({
      nameExpr: '"a" + /* note */ inline',
      inline: false,
    });
  });
});
