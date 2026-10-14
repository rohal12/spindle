import { describe, it, expect } from 'vitest';
import { storyContextErrors } from '../../src/story-context-passage';

describe('storyContextErrors', () => {
  it('accepts display-only markup', () => {
    expect(storyContextErrors('Gold: {$gold}', [])).toEqual([]);
    expect(storyContextErrors('{if $gold > 1}rich{/if}', [])).toEqual([]);
  });

  it('rejects a macro that changes the story', () => {
    expect(storyContextErrors('{set $x = 1}', [])).toEqual([
      'StoryContext: {set} is not allowed; StoryContext is display-only',
    ]);
  });

  it.each([
    'do',
    'unset',
    'computed',
    'link',
    'button',
    'dialog',
    'goto',
    'watch',
  ])('rejects {%s}', (name) => {
    const errors = storyContextErrors(`{${name} "x"}`, []);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`{${name}}`);
  });

  it('matches macro names case-insensitively, as Spindle resolves them', () => {
    expect(storyContextErrors('{Set $x = 1}', [])).toEqual([
      'StoryContext: {set} is not allowed; StoryContext is display-only',
    ]);
    expect(storyContextErrors('{LINK "a"}x{/LINK}', [])).toHaveLength(1);
    expect(storyContextErrors('{TextBox "$n"}', ['textbox'])).toHaveLength(1);
    expect(storyContextErrors('{textbox "$n"}', ['TextBox'])).toHaveLength(1);
    // {set} and {SET} are one name, reported once
    expect(storyContextErrors('{set $a = 1}{SET $b = 2}', [])).toHaveLength(1);
  });

  it('rejects [[links]]', () => {
    expect(storyContextErrors('[[Forest]]', [])).toEqual([
      'StoryContext: [[links]] is not allowed; StoryContext is display-only',
    ]);
  });

  it('rejects the input macros it is given', () => {
    expect(storyContextErrors('{textbox $n}', ['textbox'])).toHaveLength(1);
    expect(storyContextErrors('{textbox $n}', [])).toEqual([]);
  });

  it('does not report a closing tag, and reports each name once', () => {
    expect(storyContextErrors('{link "a"}x{/link}', [])).toHaveLength(1);
    expect(
      storyContextErrors('{set $a = 1}{set $b = 2}[[A]][[B]]', []),
    ).toHaveLength(2);
  });

  it('leaves malformed markup to the markup validation', () => {
    expect(storyContextErrors('[[Forest', [])).toEqual([]);
  });
});

it.each(['{unwatch "alarm"}', '{widget "Greeting"}Changed{/widget}'])(
  'rejects stateful registry mutation %s (#549)',
  (markup) => {
    expect(storyContextErrors(markup, [])).toHaveLength(1);
  },
);
