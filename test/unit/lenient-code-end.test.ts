import { expect, it } from 'vitest';
import { lenientClose } from '../../src/markup/code-end';
import { MarkupError, tokenizeMarkup } from '../../src/markup/parse';
import { validateStoryMarkup } from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

it('reads deeply nested complete and incomplete templates without recursion (#727)', () => {
  const nested = '`x${'.repeat(8000) + '0' + '}`'.repeat(8000);
  const complete = `? ${nested}}after`;
  expect(lenientClose(complete, 0)).toBe(complete.indexOf('}after'));
  const onRunOut = () => {
    ranOut = true;
  };
  let ranOut = false;
  expect(lenientClose('? ' + '`x${'.repeat(8000) + '0}', 0, onRunOut)).toBe(-1);
  expect(ranOut).toBe(true);
});

it.each([false, true])(
  'returns positioned diagnostics for deep malformed templates (tolerant=%s, #727)',
  (tolerant) => {
    const content = '{print ? ' + '`x${'.repeat(8000) + '0}';
    expect(() => tokenizeMarkup(content)).toThrow(MarkupError);
    const diagnostics = validateStoryMarkup(
      [{ name: 'Unvisited', content }],
      getMacroRegistry(),
      { tolerant },
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]).toMatchObject({
      passage: 'Unvisited',
      line: 1,
      column: 1,
    });
  },
);

it.each([
  ['? `a${ {x: "}"} }b`}tail', false],
  ['? `unterminated }tail', true],
  ["? 'not closed\n}tail", false],
  ["? Bob's room}tail", false],
  ['? `escaped \\` and \\${ text`}tail', false],
] as const)('preserves lenient literal recovery for %j', (source, ranOut) => {
  let observed = false;
  expect(
    lenientClose(source, 0, () => {
      observed = true;
    }),
  ).toBe(source.indexOf('}tail'));
  expect(observed).toBe(ranOut);
});
