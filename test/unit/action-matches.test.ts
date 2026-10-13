import { describe, it, expect } from 'vitest';
import { actionMatches, type StoryAction } from '../../src/action-registry';

const link: Omit<StoryAction, 'perform'> = {
  id: 'link:A',
  type: 'link',
  label: 'A',
  target: 'A',
};

describe('actionMatches', () => {
  it('matches on the fields the matcher sets', () => {
    expect(actionMatches(link, { type: 'link' })).toBe(true);
  });

  it('rejects an action whose target differs', () => {
    expect(actionMatches(link, { type: 'link', target: 'B' })).toBe(false);
  });

  it('treats an unset disabled field as enabled', () => {
    expect(actionMatches(link, { disabled: false })).toBe(true);
    expect(actionMatches(link, { disabled: true })).toBe(false);
  });
});
