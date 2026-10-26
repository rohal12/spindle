import { expect, it } from 'vitest';
import { isSpecialPassage, validateStoryMarkup } from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';

const macros = getMacroRegistry();

it.each([
  'StoryInit',
  'StoryVariables',
  'StoryTransients',
  'StoryInterface',
  'StoryLoading',
  'SaveTitle',
  'PassageReady',
  'PassageHeader',
  'PassageFooter',
  'PassageDone',
  'StoryContext',
])('exposes runtime navigation restrictions for %s (#672)', (name) => {
  expect(isSpecialPassage(name)).toBe(true);
  for (const content of [
    `[[${name}]]`,
    `{goto "${name}"}`,
    `{link "Go" "${name}"}{/link}`,
    `{watch "true" goto "${name}"}`,
  ]) {
    const result = validateStoryMarkup(
      [
        { name: 'Start', content },
        { name, content: '' },
      ],
      macros,
    );
    expect(result).toMatchObject([{ code: 'special-passage', data: { name } }]);
    expect(content.slice(result[0]!.start, result[0]!.end)).toContain(name);
  }
});

it('keeps include, dialog, widget and custom passage contracts separate from navigation (#672)', () => {
  const content =
    '{include "StoryInit"}{dialog "Open"}StoryInit{/dialog}{watch "true" dialog "StoryInit"}{custom "StoryInit"}';
  expect(
    validateStoryMarkup(
      [
        { name: 'Start', content },
        { name: 'StoryInit', content: '' },
      ],
      [
        ...macros,
        {
          name: 'custom',
          block: false,
          subMacros: [],
          parameters: [{ name: 'passage', type: 'passage' }],
        },
      ],
    ),
  ).toEqual([]);
  expect(
    validateStoryMarkup(
      [
        { name: 'Start', content: '{goto "StoryInit"}' },
        { name: 'StoryInit', content: '' },
      ],
      [
        ...macros,
        {
          name: 'goto',
          block: false,
          subMacros: [],
          parameters: [{ name: 'passage', type: 'passage' }],
        },
      ],
    ),
  ).toEqual([]);
  expect(
    validateStoryMarkup(
      [
        { name: 'Start', content: '{goto "StoryInit"}' },
        {
          name: 'StoryInit',
          content: '{widget "goto" @target:passage}Hello{/widget}',
        },
      ],
      macros,
    ),
  ).toEqual([]);
});

it('preserves case-sensitive names, partial-story checks and dynamic destinations (#672)', () => {
  expect(isSpecialPassage('storyinit')).toBe(false);
  expect(isSpecialPassage('Start')).toBe(false);
  expect(
    validateStoryMarkup(
      [{ name: 'Start', content: '{goto $destination} [[storyinit]]' }],
      macros,
      { checkPassageNames: false },
    ),
  ).toEqual([]);
  expect(
    validateStoryMarkup([{ name: 'Start', content: '[[StoryInit]]' }], macros, {
      checkPassageNames: false,
    }),
  ).toMatchObject([{ code: 'special-passage' }]);
});

it('applies bracket-link navigation restrictions only to the builtin link implementation (#672)', () => {
  expect(
    validateStoryMarkup(
      [
        { name: 'Start', content: '[[StoryInit]]' },
        { name: 'StoryInit', content: '' },
      ],
      [...macros, { name: 'link', block: false, subMacros: [] }],
    ),
  ).toEqual([]);
  expect(
    validateStoryMarkup(
      [
        { name: 'Start', content: '[[StoryInit]]' },
        {
          name: 'StoryInit',
          content: '{widget "link" @label @target:passage}Hello{/widget}',
        },
      ],
      macros,
    ),
  ).toEqual([]);
});
