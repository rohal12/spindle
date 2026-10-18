import { expect, it, vi } from 'vitest';
import { markdownLines } from '../../src/format/markdown-lines';
import { sourceLines } from '../../src/format/source-lines';

it.each([
  ['', [0]],
  ['a\nb', [0, 0, 1, 1]],
  ['a\r\nb\n', [0, 0, 0, 1, 1, 2]],
])('maps newline and EOF boundaries in %j', (source, expected) => {
  const lineAt = sourceLines(source);
  expect(
    Array.from({ length: source.length + 1 }, (_, i) => lineAt(i)),
  ).toEqual(expected);
});

it.each(['do', 'DO', 'Do'])(
  'does not parse %s raw bodies as Markdown',
  (name) => {
    const source = `{${name}}\nconst text = \`\n~~~\nbody\n~~~\n\`;\n{/${name}}\n`;
    expect(markdownLines(source, () => true, new Set(['codeFenced']))).toEqual(
      new Set(),
    );
  },
);

it('maps many Markdown constructs with bounded scan work (#585)', () => {
  const measure = (count: number) => {
    const source = '```\nhello\n```\n{$x}\n'.repeat(count);
    let prefixCharacters = 0;
    let spanComparisons = 0;
    const slice = String.prototype.slice;
    const max = Math.max;
    // Count work, not elapsed time: the result is independent of CPU load.
    const slices = vi
      .spyOn(String.prototype, 'slice')
      .mockImplementation(function (this: string, start, end) {
        if (this === source && start === 0)
          prefixCharacters += end ?? source.length;
        return slice.call(this, start, end);
      });
    const comparisons = vi
      .spyOn(Math, 'max')
      .mockImplementation((...values) => {
        spanComparisons++;
        return max(...values);
      });
    let lines: Set<number>;
    try {
      lines = markdownLines(source, () => false, new Set(['codeFenced']));
    } finally {
      slices.mockRestore();
      comparisons.mockRestore();
    }
    expect(lines.size).toBe(count * 3);
    expect(lines.has(0)).toBe(true);
    expect(lines.has(count * 4 - 2)).toBe(true);
    expect(lines.has(count * 4 - 1)).toBe(false);
    return { prefixCharacters, spanComparisons };
  };
  const small = measure(100);
  const large = measure(400);
  expect(large.prefixCharacters).toBeLessThanOrEqual(
    small.prefixCharacters * 6 + 1,
  );
  expect(large.spanComparisons).toBeLessThanOrEqual(small.spanComparisons * 6);
});
