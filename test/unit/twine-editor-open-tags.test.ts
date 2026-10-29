import { describe, expect, it } from 'vitest';
import { openConstructStart } from '../../src/twine-editor/highlight';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';
import { runLines } from '../support/twine-editor-mode';

describe('unfinished HTML tags in the editor', () => {
  it(
    'handles repeated incomplete tag candidates on one line in linear time (#709)',
    { timeout: LINEAR_TIMEOUT },
    () => {
      const small = `a ${'</x '.repeat(100)}`;
      const large = `a ${'</x '.repeat(800)}`;
      expect(openConstructStart(large)).toBe(large.length - 4);
      expect(runLines(large)).toEqual([[0, large, null]]);
      expectAboutLinear(
        () => runLines(small),
        () => runLines(large),
        { rounds: 3 },
      );
    },
  );

  it.each([
    ['a </x </x ', 6],
    ['a </x </x >', -1],
    ['a <b_r x=', 2],
    ['a <b_r x="</x "', 2],
    ['a <b_r x=</x ', 2],
    ['a <b_r title="a > b"', 2],
    ['a <b_r title="a > b', 2],
    ['<textarea><b_r x=', -1],
    ['<textarea></x </textarea ', 14],
  ])('retains the unfinished tag in %j at %d', (text, start) => {
    expect(openConstructStart(text)).toBe(start);
  });

  it('looks ahead from the last incomplete closer to its closing line', () => {
    expect(runLines('a </x </x \n>')).toEqual([
      [0, 'a </x ', null],
      [0, '</x', 'tag'],
      [0, ' ', null],
      [1, '>', 'tag'],
    ]);
  });
});
