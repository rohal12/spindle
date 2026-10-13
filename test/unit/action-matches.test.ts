import { describe, it, expect } from 'vitest';
import {
  actionMatches,
  checkActionMatcher,
  type StoryAction,
} from '../../src/action-registry';

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

  it('matches on id, label and variable', () => {
    expect(actionMatches(link, { id: 'link:A' })).toBe(true);
    expect(actionMatches(link, { id: 'link:B' })).toBe(false);
    expect(actionMatches(link, { label: 'A' })).toBe(true);
    expect(actionMatches(link, { label: 'a' })).toBe(false);
    const box: Omit<StoryAction, 'perform'> = {
      id: 'textbox:$name',
      type: 'textbox',
      label: 'Name',
      variable: 'name',
    };
    expect(actionMatches(box, { variable: 'name' })).toBe(true);
    expect(actionMatches(box, { variable: 'age' })).toBe(false);
    // The link sets no variable: a matcher that names one doesn't match it
    expect(actionMatches(link, { variable: 'name' })).toBe(false);
  });

  it('matches a disabled action with disabled: true', () => {
    const off = { ...link, disabled: true };
    expect(actionMatches(off, { disabled: true })).toBe(true);
    expect(actionMatches(off, { disabled: false })).toBe(false);
    expect(actionMatches(off, { type: 'link', disabled: true })).toBe(true);
  });

  it('copies a checked matcher', () => {
    const fail = (message: string): never => {
      throw new Error(message);
    };
    const matcher = { type: 'link' };
    const checked = checkActionMatcher(matcher, 'm', fail);
    expect(checked).toEqual(matcher);
    expect(checked).not.toBe(matcher);
  });
});
