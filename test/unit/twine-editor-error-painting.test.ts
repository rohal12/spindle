import { describe, expect, it, vi } from 'vitest';
import { highlightWithOpenStart } from '../../src/twine-editor/highlight';
import { runLines } from '../support/twine-editor-mode';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';

describe('overlapping editor errors (#725)', () => {
  it('retains error span boundaries and later valid token styles', () => {
    const text = 'a [[b a [[b {$ok}';
    expect(highlightWithOpenStart(text)).toEqual({
      openStart: 2,
      context: '',
      spans: [
        { start: 2, end: 8, style: 'error' },
        { start: 8, end: 13, style: 'error' },
        { start: 13, end: 16, style: 'variable-2' },
        { start: 16, end: 17, style: 'error' },
      ],
    });
  });

  it(
    'highlights many unclosed links through CodeMirror in bounded time',
    { timeout: LINEAR_TIMEOUT },
    () => {
      const small = 'a [[b '.repeat(1000);
      const large = 'a [[b '.repeat(8000);
      const tokens = runLines(large);
      expect(tokens[0]).toEqual([0, 'a ', null]);
      expect(tokens.slice(1).every(([, , style]) => style === 'error')).toBe(
        true,
      );
      expect(tokens.map(([, text]) => text).join('')).toBe(large);
      expectAboutLinear(
        () => runLines(small),
        () => runLines(large),
        { rounds: 3 },
      );
    },
  );
});

describe('unfinished macro ownership (#737)', () => {
  it('bounds recovery ownership searches through the actual mode', () => {
    const text = '{print '.repeat(2000);
    const findIndex = Array.prototype.findIndex;
    let comparisons = 0;
    const search = vi
      .spyOn(Array.prototype, 'findIndex')
      .mockImplementation(function (this: unknown[], predicate, thisArg) {
        return findIndex.call(this, (value, index, array) => {
          comparisons++;
          return predicate.call(thisArg, value, index, array);
        });
      });
    let tokens;
    try {
      tokens = runLines(text);
    } finally {
      search.mockRestore();
    }
    expect(tokens.map(([, token]) => token).join('')).toBe(text);
    expect(comparisons).toBeLessThan(text.length * 10);
  });

  it(
    'highlights repeated unfinished macro heads through CodeMirror in bounded time',
    { timeout: LINEAR_TIMEOUT },
    () => {
      const small = '{print '.repeat(1000);
      const large = '{print '.repeat(8000);
      expect(highlightWithOpenStart(large).openStart).toBe(0);
      const tokens = runLines(large);
      expect(tokens.map(([, text]) => text).join('')).toBe(large);
      expect(tokens.every(([, , style]) => style === 'error')).toBe(true);
      expectAboutLinear(
        () => runLines(small),
        () => runLines(large),
        { rounds: 3 },
      );
    },
  );

  it('retains recovery styles and continues the last macro on the next line', () => {
    expect(runLines('prefix {print {print\n 1}')).toEqual([
      [0, 'prefix ', null],
      [0, '{print ', 'error'],
      [0, '{print', 'keyword'],
      [1, ' ', 'error'],
      [1, '1', 'number'],
      [1, '}', 'keyword'],
    ]);
  });
});
