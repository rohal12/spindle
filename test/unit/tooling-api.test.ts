/**
 * The parsing rules `@rohal12/spindle/tooling` exports (src/tooling.ts):
 * the same functions the runtime parses with.
 */
import { describe, it, expect } from 'vitest';
import {
  MarkupError,
  SIGIL_SCOPES,
  endsWithOperator,
  findCodeEnd,
  isSigil,
  lexJs,
  lexTemplate,
  parseSelectors,
  readQuoted,
  scanStringLiteral,
  splitArgs,
  splitIncludeFlag,
  splitTopLevel,
  stripLooseQuotes,
  tokenizeMarkup,
  unescapeQuoted,
} from '../../src/tooling';

describe('tooling API: the JavaScript lexer', () => {
  it('lexJs reports code, literals and variables, every character once', () => {
    const code: string[] = [];
    const literals: string[] = [];
    const variables: string[] = [];
    const src = '$a + "$b" /* $c */ + `x${%t}`';
    expect(
      lexJs(src, {
        code: (ch) => code.push(ch),
        literal: (text) => literals.push(text),
        variable: (sigil, name) => variables.push(sigil + name),
      }),
    ).toBe(src.length);
    expect(variables).toEqual(['$a', '%t']);
    expect(literals).toContain('"$b"');
    expect(literals).toContain('/* $c */');
  });

  it('lexJs decides regex versus division by what precedes', () => {
    const literals: string[] = [];
    lexJs('a / b / c; x = /[`]/g', { literal: (t) => literals.push(t) });
    expect(literals).toEqual(['/[`]/g']);
    const after: string[] = [];
    lexJs('f(a) /x/ 2', { literal: (t) => after.push(t) });
    expect(after).toEqual([]);
  });

  it('lexTemplate returns the index past the closing backtick', () => {
    const src = '`a${`b`}c` rest';
    expect(lexTemplate(src, 0)).toBe(src.indexOf(' rest'));
  });

  it('scanStringLiteral stops at the closing quote', () => {
    expect(scanStringLiteral('"a\\"b" c', 0)).toEqual({
      end: 6,
      closed: true,
    });
    expect(scanStringLiteral('"open', 0)).toEqual({ end: 5, closed: false });
  });

  it('findCodeEnd finds the brace that closes the code', () => {
    const src = '{$a + "}" + 1} after';
    expect(findCodeEnd(src, 1)).toBe(src.indexOf('} after'));
    expect(findCodeEnd('{$a + "', 1)).toBe(-1);
  });
});

describe('tooling API: tokens and selectors', () => {
  it('tokenizeMarkup gives flat tokens with offsets', () => {
    const tokens = tokenizeMarkup('Hi {$name}, [[Go->Hall]]{if $x}');
    expect(tokens.map((t) => t.type)).toEqual([
      'text',
      'variable',
      'text',
      'link',
      'macro',
    ]);
    const link = tokens[3]!;
    expect(link).toMatchObject({ target: 'Hall', start: 12, end: 24 });
  });

  it('tokenizeMarkup throws a MarkupError for an unclosed brace', () => {
    expect(() => tokenizeMarkup('{if $x')).toThrow(MarkupError);
  });

  it('knows the sigils', () => {
    expect(SIGIL_SCOPES['$']).toBe('variable');
    expect(isSigil('%')).toBe(true);
    expect(isSigil('a')).toBe(false);
    expect(isSigil(undefined)).toBe(false);
  });

  it('parseSelectors reads class and id selectors and where they end', () => {
    expect(parseSelectors('.big.red#hero {$x}')).toEqual({
      className: 'big red',
      id: 'hero',
      end: 14,
    });
    expect(parseSelectors('.a-{$n} rest')).toEqual({
      className: 'a-{$n}',
      end: 8,
    });
    expect(parseSelectors('{.a ', 1)).toEqual({ className: 'a', end: 4 });
    expect(parseSelectors('plain')).toEqual({ end: 0 });
  });
});

describe('tooling API: argument rules', () => {
  it('splits arguments at top-level commas and values', () => {
    expect(splitArgs('"a, b", f(1, 2), [3, 4]')).toEqual([
      '"a, b"',
      'f(1, 2)',
      '[3, 4]',
    ]);
    expect(splitArgs('"Label" "target"')).toEqual(['"Label"', '"target"']);
    expect(splitTopLevel('a b(c d) e', (ch) => ch === ' ')).toEqual([
      'a',
      'b(c d)',
      'e',
    ]);
  });

  it('reads quoted strings', () => {
    expect(readQuoted('x "a\\"b" y', 2)).toEqual({ value: 'a"b', end: 8 });
    expect(readQuoted('"open', 0)).toBeNull();
    expect(unescapeQuoted('a\\"b\\\\n')).toBe('a"b\\n');
    expect(stripLooseQuotes('"Red')).toBe('Red');
  });

  it('endsWithOperator tells incomplete expressions', () => {
    expect(endsWithOperator('$a +')).toBe(true);
    expect(endsWithOperator('$a')).toBe(false);
    expect(endsWithOperator('/x+/')).toBe(false);
  });

  it('splitIncludeFlag takes the inline flag off either end', () => {
    expect(splitIncludeFlag('inline "Room"')).toEqual({
      inline: true,
      passage: '"Room"',
    });
    expect(splitIncludeFlag('$next inline')).toEqual({
      inline: true,
      passage: '$next',
    });
    expect(splitIncludeFlag('"inline"')).toEqual({
      inline: false,
      passage: '"inline"',
    });
    expect(splitIncludeFlag('"a" + inline')).toEqual({
      inline: false,
      passage: '"a" + inline',
    });
  });
});
