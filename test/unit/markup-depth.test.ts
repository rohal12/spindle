import { expect, it } from 'vitest';
import {
  MarkupError,
  parseMarkup,
  analyzeMarkup,
} from '../../src/markup/parse';
import { validateStoryMarkup } from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

it.each(['html', 'macro', 'mixed'])(
  'diagnoses deep %s markup before recursive AST construction (#667)',
  (kind) => {
    const depth = 4000;
    const opens = Array.from({ length: depth }, (_, i) =>
      kind === 'html' || (kind === 'mixed' && i % 2 === 0)
        ? '<div>'
        : '{if true}',
    );
    const closes = opens
      .map((s) => (s === '<div>' ? '</div>' : '{/if}'))
      .reverse();
    const content = opens.join('') + 'hello' + closes.join('');
    expect(() => parseMarkup(content)).toThrow(MarkupError);
    expect(analyzeMarkup(content).errors).toMatchObject([
      {
        code: 'nesting-limit',
        offset: opens.slice(0, 256).join('').length,
        line: 1,
      },
    ]);
    for (const tolerant of [false, true]) {
      expect(
        validateStoryMarkup([{ name: 'Start', content }], getMacroRegistry(), {
          tolerant,
        }),
      ).toMatchObject([
        {
          code: 'nesting-limit',
          passage: 'Start',
          line: 1,
          data: { limit: '256' },
        },
      ]);
    }
  },
);

it('accepts nesting up to the limit and arbitrarily many shallow siblings', () => {
  expect(() =>
    parseMarkup('<div>'.repeat(256) + 'ok' + '</div>'.repeat(256)),
  ).not.toThrow();
  expect(() => parseMarkup('<div>ok</div>'.repeat(4000))).not.toThrow();
});
