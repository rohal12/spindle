import { describe, it, expect } from 'vitest';
import { sourceLocationOf } from '../../src/utils/source-location';
import type { Passage } from '../../src/parser';

function makePassage(metadata: Record<string, string>): Passage {
  return { pid: 1, name: 'Test', tags: [], metadata, content: '' };
}

describe('sourceLocationOf', () => {
  it('returns file:line when both are present', () => {
    expect(
      sourceLocationOf(
        makePassage({
          'data-source-file': 'story.twee',
          'data-source-line': '5',
        }),
      ),
    ).toBe(' (story.twee:5)');
  });

  it('returns file only when line is absent', () => {
    expect(
      sourceLocationOf(makePassage({ 'data-source-file': 'story.twee' })),
    ).toBe(' (story.twee)');
  });

  it('returns empty string when metadata has no source info', () => {
    expect(sourceLocationOf(makePassage({}))).toBe('');
  });
});
