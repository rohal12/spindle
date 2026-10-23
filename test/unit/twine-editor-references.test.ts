import { describe, it, expect, vi } from 'vitest';
import { parsePassageText } from '../../src/twine-editor/references';

const work = vi.hoisted(() => ({ tokenizations: 0, targetReads: 0 }));
vi.mock('../../src/markup/parse', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/markup/parse')>();
  return {
    ...original,
    tokenizeMarkupTolerant: (
      ...args: Parameters<typeof original.tokenizeMarkupTolerant>
    ) => {
      work.tokenizations++;
      const result = original.tokenizeMarkupTolerant(...args);
      for (const token of result.tokens) {
        if (token.type !== 'link') continue;
        const start = token.targetStart;
        Object.defineProperty(token, 'targetStart', {
          get() {
            work.targetReads++;
            return start;
          },
        });
      }
      return result;
    },
  };
});

describe('parsePassageText', () => {
  it.each([
    ['{goto "Hall"}', ['Hall']],
    ['{include "Box"}', ['Box']],
    ['{link "Go" "Cave"}{/link}', ['Cave']],
    ['{dialog "Map"}World Map{/dialog}', ['World Map']],
    [`{watch '$hp <= 0' goto "Death"}`, ['Death']],
    [`{watch '$x' dialog "Note"}`, ['Note']],
  ])('finds %s', (text, expected) =>
    expect(parsePassageText(text)).toEqual(expected),
  );

  it('leaves out [[links]]', () =>
    expect(parsePassageText('[[Hall]] [[Go->Cave]] {goto "Hall"}')).toEqual([
      'Hall',
    ]));

  it('leaves out expressions', () =>
    expect(parsePassageText('{goto $room}')).toEqual([]));

  it('returns each passage once', () =>
    expect(parsePassageText('{goto "A"}{include "A"}')).toEqual(['A']));

  it('reads half-typed markup', () =>
    expect(parsePassageText('{goto "A"} {if $x')).toEqual(['A']));

  it('handles empty and CRLF text', () => {
    expect(parsePassageText('')).toEqual([]);
    expect(parsePassageText('{goto "A"}\r\n{goto "B"}')).toEqual(['A', 'B']);
  });

  it('filters bracket links with linear lookup work and one tokenization (#629)', () => {
    const count = 400;
    const source = Array.from(
      { length: count },
      (_, i) => `[[Bracket ${i}]] {goto "Macro ${i}"}`,
    ).join('\n');
    work.tokenizations = 0;
    work.targetReads = 0;
    expect(parsePassageText(source)).toEqual(
      Array.from({ length: count }, (_, i) => `Macro ${i}`),
    );
    expect(work.tokenizations).toBe(1);
    expect(work.targetReads).toBeLessThan(count * 10);
  });
});
