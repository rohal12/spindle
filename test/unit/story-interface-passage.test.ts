import { describe, it, expect } from 'vitest';
import { usesPassageMacro } from '../../src/components/StoryInterface';

describe('usesPassageMacro', () => {
  it.each([
    '{passage}',
    '<header>{story-title}</header>\n{passage}',
    // Selectors, as docs/story-interface.md writes the macro
    '{#my-story.custom-story passage}',
    '{#passages passage}',
    '{.story passage}',
    '{.main.wide#story passage}',
    '{.{$theme} passage}',
    // Macro names are case-insensitive
    '{Passage}',
    '{#story PASSAGE}',
    // Inside elements and other macros
    '<div class="layout"><main>{#passages passage}</main></div>',
    '{if $ready}{.story passage}{/if}',
  ])('finds the macro in %s', (markup) => {
    expect(usesPassageMacro(markup)).toBe(true);
  });

  it.each([
    '',
    '<header>{story-title}{back}{forward}</header>',
    // Text that only looks like the macro
    '\\{passage}',
    '\\{#passages passage}',
    '<div title="{passage}">Layout</div>',
    '<!-- {passage} goes here -->',
    '{button "{passage}"}{/button}',
    '{do}var note = "{passage}";{/do}',
    '{print "{passage}"}',
    '[[{passage}|Start]]',
    // Selectors are written without spaces between them: this is text
    '{#my-story .custom-story passage}',
    // Other names
    '{$passage}',
    '{passages}',
    '{include "passage"}',
  ])('finds no macro in %s', (markup) => {
    expect(usesPassageMacro(markup)).toBe(false);
  });

  it('leaves malformed markup to the error the interface shows', () => {
    expect(usesPassageMacro('<header>{story-title')).toBe(true);
  });
});
