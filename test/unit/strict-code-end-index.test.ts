import { describe, expect, it, vi } from 'vitest';
import { Parser } from 'acorn';
import * as jsLexer from '../../src/js-lexer';
import {
  findCodeEnd,
  indexStrictCodeEnds,
  tokenizeMarkupTolerant,
} from '../../src/tooling';

describe('strict code-boundary index (#785)', () => {
  it.each([
    '{$x{$y}',
    '{$x + "unterminated} {$y}',
    '{print {a: }',
    '{$x + {a: }',
    '{#! ignored\n{$x }',
    '\r\n😀 literal {$x{$y}',
    '{$a + /}/.test($s)} {$b / 2}',
    '{$a /* } */ + "}" + `${"}"}` }',
    '{$a // }\n} {$b}',
    '{a b <!-- {\n}',
    '{a b\n --> {\n}',
    '{(a } {[1, 2}',
    "{typeof'}' } {class { static'}' } }",
    '{2s // }\n} {a → b }',
    '{ $s = `Hi ${$name`} after',
    '{`${class D { function\nstatic x; }} text`} {$y}',
    '{',
    '',
  ])('matches strict queries at every start in %j', (source) => {
    const endAt = indexStrictCodeEnds(source);
    // Include starts outside interpolations: queries have the same default
    // expression goal as findCodeEnd, independent of the surrounding prose.
    for (let start = source.length; start >= 0; start--) {
      expect(endAt(start), `start ${start}`).toBe(findCodeEnd(source, start));
      expect(endAt(start)).toBe(findCodeEnd(source, start));
    }
  });

  it('keeps strict failures distinct from tolerant markup recovery', () => {
    const source = '{$x + "unterminated} {$y}';
    const endAt = indexStrictCodeEnds(source);
    expect(endAt(1)).toBe(-1);
    expect(endAt(source.indexOf('{$y}') + 1)).toBe(source.length - 1);
    expect(tokenizeMarkupTolerant(source).tokens[0]).toMatchObject({
      type: 'expression',
      end: source.indexOf('}') + 1,
    });
  });

  it.each(['', '}', '{$y}', ' {a: }'])(
    'bounds scans of 4000 failed prefixes with suffix %j',
    (suffix) => {
      const source = '{$x'.repeat(4000) + suffix;
      const scan = vi.spyOn(jsLexer, 'findCodeEnd');
      const parse = vi.spyOn(jsLexer, 'parsedCodeEnd');
      const nextToken = vi.spyOn(
        Parser.prototype as Parser & { nextToken(): void },
        'nextToken',
      );
      try {
        const endAt = indexStrictCodeEnds(source);
        for (let start = 1; start < 12000; start += 3) {
          const expected = suffix === '}' && start === 11998 ? 12000 : -1;
          expect(endAt(start)).toBe(expected);
        }
        if (suffix === '{$y}') expect(endAt(12001)).toBe(source.length - 1);
        // Impossible plain-code openers skip the token scanner. The parser
        // still gets a chance to recover at an inner syntax-error brace.
        expect(scan.mock.calls.length).toBeLessThanOrEqual(2);
        expect(
          scan.mock.calls.reduce((n, [s, start]) => n + s.length - start, 0),
        ).toBeLessThan(source.length * 2);
        // Parser errors must not scan an ever-growing source prefix either.
        expect(parse.mock.calls.every(([, start]) => start <= 1)).toBe(true);
        // Count actual Acorn token work, including parser fallback, rather
        // than only counting calls whose individual cost could grow.
        expect(nextToken.mock.calls.length).toBeLessThan(source.length * 2);
        const counts = [scan.mock.calls.length, parse.mock.calls.length];
        for (let start = 1; start < 12000; start += 3) endAt(start);
        expect([scan.mock.calls.length, parse.mock.calls.length]).toEqual(
          counts,
        );
      } finally {
        scan.mockRestore();
        parse.mockRestore();
        nextToken.mockRestore();
      }
    },
  );

  it('keeps indexes independent when queries are interleaved', () => {
    const a = indexStrictCodeEnds('{$a');
    const b = indexStrictCodeEnds('{$a}');
    expect(a(1)).toBe(-1);
    expect(b(1)).toBe(3);
    expect(a(1)).toBe(-1);
  });
});
