import { describe, it, expect } from 'vitest';
import { parsePassageText } from '../../src/twine-editor/references';

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
});
