import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  tokenizeMarkup,
  tokenizeMarkupTolerant,
  type ToolingMacro,
} from '../../src/tooling';

const builtins = getMacroRegistry();
const macros: ToolingMacro[] = [
  ...builtins,
  {
    name: 'DO',
    block: true,
    subMacros: [],
    widget: { params: [] },
  },
];
const source = '{do}<span>{caption "x"}</span>{/do}';

it('exposes live invocations inside a do widget with original offsets (#652)', () => {
  for (const tokens of [
    tokenizeMarkup(source, { macros }),
    tokenizeMarkupTolerant(source, { macros }).tokens,
  ]) {
    expect(tokens.map((token) => token.type)).toEqual([
      'macro',
      'html',
      'macro',
      'html',
      'macro',
    ]);
    expect(tokens[2]).toMatchObject({
      name: 'caption',
      start: source.indexOf('{caption'),
      end: source.indexOf('</span>'),
    });
  }
});

it('preserves builtin raw-do behavior and stateless metadata selection (#652)', () => {
  for (const options of [{}, { macros: builtins }, { macros: [] }]) {
    expect(tokenizeMarkup(source, options)).toMatchObject([
      { type: 'macro', name: 'do' },
      { type: 'text', value: '<span>{caption "x"}</span>' },
      { type: 'macro', name: 'do', isClose: true },
    ]);
  }
  expect(tokenizeMarkup(source, { macros })).toHaveLength(5);
  expect(tokenizeMarkup(source)).toHaveLength(3);
});

it('keeps tolerant recovery, text mode and single-use metadata iterables (#652)', () => {
  const content = '{do}{/bad arg}<span>{caption "x"}{/do}';
  function* metadata() {
    yield* macros;
  }
  const result = tokenizeMarkupTolerant(content, {
    macros: metadata(),
    text: true,
  });
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toMatchObject({
    code: 'closer-with-arguments',
    offset: 4,
  });
  expect(
    result.tokens.some(
      (token) => token.type === 'macro' && token.name === 'caption',
    ),
  ).toBe(true);
  expect(result.tokens.some((token) => token.type === 'html')).toBe(false);
});
