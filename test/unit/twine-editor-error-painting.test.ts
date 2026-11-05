import { describe, expect, it } from 'vitest';
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
