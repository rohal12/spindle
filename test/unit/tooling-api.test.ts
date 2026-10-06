/**
 * The parsing rules `@rohal12/spindle/tooling` exports (src/tooling.ts):
 * the same functions the runtime parses with.
 */
import { describe, it, expect } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
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
  tokenizeMarkupTolerant,
  transform,
  unescapeQuoted,
  collectStoryPassageReferences,
  evaluatePassageName,
  passageTarget,
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

describe('tooling API: tolerant tokens', () => {
  const tolerant = (src: string) => tokenizeMarkupTolerant(src);

  it('gives the tokens of well-formed markup, and no errors', () => {
    const src = 'Hi {$a}, [[Go->Hall]] {if $x}yes{/if}';
    expect(tolerant(src)).toEqual({ tokens: tokenizeMarkup(src), errors: [] });
  });

  it.each([
    ['an unclosed macro', 'Hi {$a} then {if $x', 13],
    ['an unclosed link', 'a {$b} [[Go->Hal', 7],
    ['an unclosed attribute value', 'x {$b} <a href="oops', 15],
  ])('keeps the tokens before %s', (_, src, offset) => {
    const { tokens, errors } = tolerant(src);
    expect(errors.map((e) => e.offset)).toEqual([offset]);
    expect(tokens.filter((t) => t.type === 'variable')).toHaveLength(1);
    // Every character is in exactly one token, in order
    let at = 0;
    for (const t of tokens) {
      expect(t.start).toBe(at);
      at = t.end;
    }
    expect(at).toBe(src.length);
  });

  it('reads on after an error, with offsets in the source', () => {
    const src = '{if $x\n[[a]] {$b} [[open\n{$c}';
    const { tokens, errors } = tolerant(src);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ offset: 0, line: 1, column: 1 });
    expect(errors[1]).toMatchObject({ line: 2 });
    const link = tokens.find((t) => t.type === 'link')!;
    expect(src.slice(link.start, link.end)).toBe('[[a]]');
    const variables = tokens.filter((t) => t.type === 'variable');
    expect(variables.map((t) => src.slice(t.start, t.end))).toEqual([
      '{$b}',
      '{$c}',
    ]);
  });
});

describe('tooling API: passage targets', () => {
  it('reads a quoted name as its JavaScript literal, else an expression', () => {
    expect(passageTarget('"Hall"')).toEqual({ kind: 'name', name: 'Hall' });
    expect(passageTarget(' "\\u0048all" ')).toEqual({
      kind: 'name',
      name: 'Hall',
    });
    expect(passageTarget('$room')).toEqual({
      kind: 'expression',
      expression: '$room',
    });
    expect(passageTarget('"a" + $b')).toEqual({
      kind: 'expression',
      expression: '"a" + $b',
    });
  });

  it('evaluates a name as the story does', () => {
    const state = {
      storyData: { passages: new Map([['Hall', {}]]) },
      currentPassage: 'Start',
    } as never;
    expect(evaluatePassageName('$x', () => 'Hall', state)).toBe('Hall');
    expect(() => evaluatePassageName('$x', () => 'Nope', state)).toThrow(
      'No passage named "Nope" (in passage "Start")',
    );
  });

  it('transforms sigil references into namespace lookups', () => {
    expect(transform('$a + _b + @c + %d + "$e"')).toBe(
      'variables["a"] + temporary["b"] + locals["c"] + transient["d"] + "$e"',
    );
    expect(transform('$a = 1; _b++', 'statements')).toBe(
      'variables["a"] = 1; temporary["b"]++',
    );
    expect(() => transform('$__proto__')).toThrow(SyntaxError);
  });
});

describe('tooling API: passage references', () => {
  const macros = getMacroRegistry();
  const refs = (src: string) => collectStoryPassageReferences(src, macros);
  const at = (src: string, ref: { start: number; end: number }) =>
    src.slice(ref.start, ref.end);

  it('finds links, macro arguments, watch actions and dialog bodies', () => {
    const src = [
      '[[Go->Hall]]',
      '{goto "Cellar"}',
      '{include $room}',
      '{link "Go" "Attic"}{/link}',
      '{watch "$x" goto "Roof" dialog "Hint"}',
      '{dialog "Title"}Basement{/dialog}',
    ].join('\n');
    const found = refs(src);
    expect(found.map((r) => [r.macro, r.target, at(src, r)])).toEqual([
      ['link', { kind: 'name', name: 'Hall' }, 'Hall'],
      ['goto', { kind: 'name', name: 'Cellar' }, '"Cellar"'],
      ['include', { kind: 'expression', expression: '$room' }, '$room'],
      ['link', { kind: 'name', name: 'Attic' }, '"Attic"'],
      ['watch', { kind: 'name', name: 'Roof' }, 'Roof'],
      ['watch', { kind: 'name', name: 'Hint' }, 'Hint'],
      ['dialog', { kind: 'name', name: 'Basement' }, 'Basement'],
    ]);
  });

  it('reads half-typed markup', () => {
    const src = '[[Go->Hall]] {goto "Cellar"} {goto "Att';
    expect(refs(src).map((r) => at(src, r))).toEqual(['Hall', '"Cellar"']);
  });
});
