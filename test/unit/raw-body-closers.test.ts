import { expect, it } from 'vitest';
import { jsCodeEnd } from '../../src/markup/code-end';

it('selects JavaScript-aware closers from the indexed candidates (#791)', () => {
  const read = jsCodeEnd();
  const source = '"{/DO}"; /* {/do} */ const re = /x/; {/Do   } tail {/do}';
  expect(read.rawBodyEnd(source, 0, 'DO')).toBe(source.indexOf('{/Do   }'));
  expect(read.rawBodyEnd(source, source.indexOf(' tail'), 'do')).toBe(
    source.lastIndexOf('{/do}'),
  );
  expect(read.rawBodyEnd(source, source.length, 'do')).toBe(-1);
  expect(read.rawBodyEnd(source, 0, 'other')).toBe(-1);
  expect(read.rawBodyEnd('no closer', 0, 'do')).toBe(-1);
  expect(read.rawBodyEnd(source, 0, 'do')).toBe(source.indexOf('{/Do   }'));
});

it('retains malformed-code fallback and editor open-end notifications (#791)', () => {
  const open: number[] = [];
  const read = jsCodeEnd((_input, start) => open.push(start));
  const source = '`unclosed {/do}';
  expect(read.rawBodyEnd(source, 0, 'do')).toBe(source.indexOf('{/do}'));
  expect(open).toEqual([0]);
  // A newly completed source must discard the previous absence result.
  expect(read.rawBodyEnd('{do}', 4, 'do')).toBe(-1);
  expect(read.rawBodyEnd('{do}{/do}', 4, 'do')).toBe(4);
});
