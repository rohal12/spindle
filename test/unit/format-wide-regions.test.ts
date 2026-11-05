import { expect, it } from 'vitest';
import { formatPassage } from '../../src/format/format-passage';

it.each(['div', 'script', 'svg', 'pre'])(
  'preserves a wide %s region without exceeding the argument limit (#719)',
  async (tag) => {
    const source = `<${tag}>\n` + 'x\n'.repeat(130_000) + `</${tag}>\n`;
    expect(await formatPassage(source)).toBe(source);
  },
  30_000,
);

it('preserves wide HTML when the supplied formatter fails (#719)', async () => {
  const source = '<div>\n' + 'x\n'.repeat(130_000) + '</div>\n';
  expect(
    await formatPassage(source, {
      prettier: {
        async format() {
          throw new Error('Cannot format');
        },
      },
    }),
  ).toBe(source);
}, 30_000);

it('wraps a long prose line into many lines without losing words (#719)', async () => {
  const source = 'x '.repeat(130_000).trim();
  expect(await formatPassage(source, { maxLineLength: 1 })).toBe(
    'x\n'.repeat(130_000),
  );
}, 30_000);
