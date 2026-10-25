import { expect, it, vi } from 'vitest';
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
  } finally {
    scan.mockRestore();
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

it.each(['{foo{bar a b}', '{foo{bar @}', '{foo{bar $x + 1}'])(
  'preserves braces consumed as part of a macro name: %s',
  (source) => {
    expect(tokenizeMarkup(source)).toEqual(
      tokenizeMarkup(source, { hooks: defaultCodeEnd }),
    );
  },
);
