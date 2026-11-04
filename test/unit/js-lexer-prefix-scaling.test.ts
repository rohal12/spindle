import { expect, it, vi } from 'vitest';
import { builtinMacros } from '../../src/twine-editor/builtin-macros';
import { tokenizeMarkup, validateStoryMarkup } from '../../src/tooling';

it.each(['tokenize', 'validate'])(
  '%s bounds newline-prefix searches for valid macros on one line (#716)',
  (api) => {
    const measure = (count: number) => {
      const source = '{print 1} '.repeat(count);
      const lastIndexOf = String.prototype.lastIndexOf;
      let searched = 0;
      const scan = vi
        .spyOn(String.prototype, 'lastIndexOf')
        .mockImplementation(function (this: string, text, from) {
          const found = lastIndexOf.call(this, text, from);
          if (this === source && text === '\n')
            searched += (from ?? source.length) - found;
          return found;
        });
      try {
        if (api === 'tokenize') {
          const tokens = tokenizeMarkup(source);
          expect(tokens).toHaveLength(count * 2);
          expect(tokens[tokens.length - 2]).toMatchObject({
            type: 'macro',
            name: 'print',
            rawArgs: '1',
            start: source.length - 10,
            end: source.length - 1,
          });
        } else {
          expect(
            validateStoryMarkup(
              [{ name: 'Start', content: source }],
              builtinMacros,
            ),
          ).toEqual([]);
        }
      } finally {
        scan.mockRestore();
      }
      return searched;
    };
    const small = measure(100);
    expect(measure(800)).toBeLessThanOrEqual(small * 12 + 8000);
  },
);
