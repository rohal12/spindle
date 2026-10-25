import { expect, it, vi } from 'vitest';
import {
  analyzeMarkup,
  scanMarkupTolerant,
  MarkupError,
} from '../../src/markup/parse';
import { pairMarkup } from '../../src/markup/pair';
import { isBlockMacro, isRawMacro } from '../../src/markup/ast';
import * as jsLexer from '../../src/js-lexer';
import { defaultCodeEnd } from '../../src/markup/code-end';
import {
  tokenizeMarkup,
  tokenizeMarkupTolerant,
  validateStoryMarkup,
} from '../../src/tooling';

it.each(['', '}', '{$ok}'])(
  'bounds strict code-attribute scans before %j (#641)',
  (suffix) => {
    const content = `<div onclick="console.log('${'{$x '.repeat(500)}${suffix}')"></div>`;
    const scan = vi.spyOn(jsLexer, 'findCodeEnd');
    try {
      const tokens = tokenizeMarkup(content);
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toMatchObject({
        type: 'html',
        attributes: { onclick: content.slice(14, -8) },
      });
      expect(scan.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      scan.mockRestore();
    }
    if (!suffix)
      expect(validateStoryMarkup([{ name: 'Start', content }], [])).toEqual([]);
  },
);

it('bounds code-reader work during recovery with a trailing brace (#265)', () => {
  const count = 500;
  const source = 'text {if $x '.repeat(count) + '}';
  const scan = vi.spyOn(jsLexer, 'findCodeEnd');
  const parse = vi.spyOn(jsLexer, 'parsedCodeEnd');
  try {
    const { tokens, errors } = tokenizeMarkupTolerant(source);
    expect(errors).toHaveLength(count - 1);
    expect(tokens[tokens.length - 1]).toMatchObject({
      type: 'macro',
      name: 'if',
      rawArgs: '$x',
    });
    // Token spans still cover the source exactly once.
    expect(tokens[0]!.start).toBe(0);
    expect(tokens[tokens.length - 1]!.end).toBe(source.length);
    for (let i = 1; i < tokens.length; i++)
      expect(tokens[i]!.start).toBe(tokens[i - 1]!.end);
    const scanned = scan.mock.calls.reduce(
      (total, [input, codeStart]) => total + input.length - codeStart,
      0,
    );
    expect(scanned).toBeLessThan(source.length * 4);
    // Acorn also scans the prefix before codeStart to locate its tokens
    // and errors. Passing the whole passage here repeats that work.
    const prefixes = parse.mock.calls.reduce(
      (total, [, codeStart]) => total + codeStart,
      0,
    );
    expect(prefixes).toBeLessThan(source.length * 4);
  } finally {
    scan.mockRestore();
    parse.mockRestore();
  }
});

it('preserves custom code-end hooks and their relative offsets', () => {
  const calls: string[] = [];
  const closeBrace = (input: string, start: number) => {
    calls.push(input.slice(start));
    return input.indexOf('}', start);
  };
  expect(tokenizeMarkup('{print 1}', { hooks: { closeBrace } })).toMatchObject([
    { rawArgs: '1' },
  ]);
  expect(calls).toEqual([' 1}']);
});

it.each([
  '{print {a: }',
  '{$x + {a: }',
  '{print #! ignored\n{$x }',
  '\r\ntext {if $x {if $y }',
])('preserves fallback code ends and source offsets: %j', (source) => {
  expect(tokenizeMarkupTolerant(source)).toEqual(
    tokenizeMarkupTolerant(source, { hooks: defaultCodeEnd }),
  );
});

it.each(['{foo{bar a b}', '{foo{bar @}', '{foo{bar $x + 1}'])(
  'preserves braces consumed as part of a macro name: %s',
  (source) => {
    expect(tokenizeMarkup(source)).toEqual(
      tokenizeMarkup(source, { hooks: defaultCodeEnd }),
    );
  },
);

it('bounds recovery damage filtering with many independent pairing errors (#657)', () => {
  const count = 2000;
  const source = '[[\n'.repeat(count) + '{/span}'.repeat(count);
  const some = Array.prototype.some;
  let damageVisits = 0;
  const scan = vi.spyOn(Array.prototype, 'some').mockImplementation(function (
    this: unknown[],
    predicate,
    thisArg,
  ) {
    if (!(this[0] instanceof MarkupError))
      return some.call(this, predicate, thisArg);
    return some.call(this, (value, index, array) => {
      damageVisits++;
      return predicate.call(thisArg, value, index, array);
    });
  });
  try {
    const result = analyzeMarkup(source);
    expect(result.errors).toHaveLength(count * 2);
    expect(result.errors.filter((e) => e.code === 'stray-closer')).toHaveLength(
      count,
    );
    expect(damageVisits).toBeLessThan(count * 20);
  } finally {
    scan.mockRestore();
  }
});

it.each([
  '<div title="{if}">{/span}',
  '<div title="{if}"><b title="{switch}">{/span}',
  '[[\n{/span}[[\n{/if}',
])(
  'preserves suppression inside overlapping recovered damage: %s',
  (source) => {
    const { tokens, errors, damage } = scanMarkupTolerant(source);
    const paired = pairMarkup(tokens, {
      source,
      isBlock: isBlockMacro,
      isRaw: isRawMacro,
    });
    const expected = paired.errors.filter(
      (e) =>
        !errors.some(
          (error, i) => e.start >= damage[i]! && e.start <= error.offset,
        ),
    );
    const actual = analyzeMarkup(source).errors.filter(
      (e) =>
        !errors.some(
          (error) => error.code === e.code && error.offset === e.offset,
        ),
    );
    expect(actual.map((e) => [e.code, e.offset])).toEqual(
      expected
        .sort((a, b) => a.noticedAt - b.noticedAt)
        .map((e) => [e.code, e.start]),
    );
  },
);
