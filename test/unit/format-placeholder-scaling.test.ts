import { expect, it, vi } from 'vitest';
import { formatPassage } from '../../src/format/format-passage';
import {
  placeholdersIntact,
  SPINDLE_PLACEHOLDERS,
  SVG_PLACEHOLDERS,
} from '../../src/format/placeholders';

it.each([SPINDLE_PLACEHOLDERS, SVG_PLACEHOLDERS])(
  'requires exactly one spelling per expected placeholder (#611)',
  (family) => {
    const tokens = ['first', 'second'];
    const markers = tokens.map((_, i) => family(i)[0]!);
    expect(placeholdersIntact(markers.join(' text '), tokens, family)).toBe(
      true,
    );
    expect(placeholdersIntact(markers[0]!, tokens, family)).toBe(false);
    expect(
      placeholdersIntact(
        [...markers, family(0)[family(0).length - 1]!].join(''),
        tokens,
        family,
      ),
    ).toBe(false);
    expect(
      placeholdersIntact(markers.join('') + '<!--SVG:999-->', tokens, family),
    ).toBe(true);
  },
);

it('accepts mixed attribute/comment markers and rejects literal collisions (#611)', () => {
  expect(
    placeholdersIntact('<!--SP:0--> __SP1__', ['', ''], SPINDLE_PLACEHOLDERS),
  ).toBe(true);
  expect(
    placeholdersIntact('<!--SP:0--> __SP0__', [''], SPINDLE_PLACEHOLDERS),
  ).toBe(false);
  expect(placeholdersIntact('__SP00__', [''], SPINDLE_PLACEHOLDERS)).toBe(
    false,
  );
});

it('bounds whole-document placeholder scans (#611)', () => {
  const tokens = Array.from({ length: 1000 }, () => '{$x}');
  const text = tokens.map((_, i) => SPINDLE_PLACEHOLDERS(i)[0]).join('\n');
  const split = String.prototype.split;
  let scanned = 0;
  const spy = vi.spyOn(String.prototype, 'split').mockImplementation(function (
    this: string,
    ...args: Parameters<typeof split>
  ) {
    if (this === text) scanned += this.length;
    return split.apply(this, args);
  });
  try {
    expect(placeholdersIntact(text, tokens, SPINDLE_PLACEHOLDERS)).toBe(true);
  } finally {
    spy.mockRestore();
  }
  expect(scanned).toBeLessThanOrEqual(text.length * 2);
});

it('formats growing HTML regions with near-linear placeholder processing (#611)', async () => {
  const measure = async (count: number) => {
    const source = '<div>\n' + '<span>{$x}</span>\n'.repeat(count) + '</div>\n';
    const start = performance.now();
    const formatted = await formatPassage(source, {
      prettier: { format: async (code) => code },
    });
    const elapsed = performance.now() - start;
    expect(formatted).toBe(source);
    return elapsed;
  };
  let small = Infinity;
  let large = Infinity;
  for (let round = 0; round < 5; round++) {
    small = Math.min(small, await measure(1000));
    large = Math.min(large, await measure(8000));
  }
  expect(large).toBeLessThan(Math.max(small, 0.5) * 24);
}, 30_000);
