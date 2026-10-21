import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  validateStoryMarkup,
  validateVariableReferences,
} from '../../src/tooling';

const macros = getMacroRegistry();

it.each([false, true])(
  'uses StoryInit widget holds regardless of passage order (reverse=%s) (#609)',
  (reverse) => {
    for (const [effective, obsolete] of [
      ['text', 'markup'],
      ['text', 'passage'],
      ['markup', 'text'],
      ['passage', 'text'],
    ]) {
      const definitions = [
        {
          name: 'StoryInit',
          content: `{widget "caption" @value:${effective}}{print @value}{/widget}`,
        },
        {
          name: 'Widgets',
          tags: ['widget'],
          content: `{widget "CAPTION" @old:${obsolete}}{print @old}{/widget}`,
        },
      ];
      if (reverse) definitions.reverse();
      const passages = [
        ...definitions,
        { name: 'Start', content: '{caption "{$missing}"}' },
      ];
      const variables = validateVariableReferences(
        passages,
        { variables: new Map() },
        macros,
      );
      const markup = validateStoryMarkup(passages, macros);
      expect(variables.map((d) => d.code)).toEqual(
        effective === 'markup' ? ['undeclared-variable'] : [],
      );
      expect(markup.map((d) => d.code)).toEqual(
        effective === 'passage' ? ['unknown-passage'] : [],
      );
    }
  },
);

it('ignores unclosed widget parameter metadata (#609)', () => {
  const passages = [
    {
      name: 'Widgets',
      tags: ['widget'],
      content: '{widget "caption" @value:text}{/widget}',
    },
    { name: 'StoryInit', content: '{widget "caption" @wrong:markup}' },
    { name: 'Start', content: '{caption "{$missing}"}' },
  ];
  expect(
    validateVariableReferences(passages, { variables: new Map() }, macros),
  ).toEqual([]);
  expect(
    validateStoryMarkup(passages, macros).filter((d) => d.passage === 'Start'),
  ).toEqual([]);
});
