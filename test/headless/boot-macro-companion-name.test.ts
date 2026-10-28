// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';
import { defineMacro } from '../../src/define-macro';
import { interpolateText } from '../../src/interpolation';

it('dispatches companion-named macros while retaining built-in option clauses (#689)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$answer = "Red"',
      StoryInit: `{do}
Story.defineMacro({ name: 'option', render() { return 'CUSTOM'; }, text() { return 'CUSTOM'; } });
{/do}`,
      Start: `Before {option} after
<span title="{OPTION}">hover</span> [[{option}->Hall]]
{cycle $answer}{option "Red"}{option "Green"}{/cycle}
{listbox $answer}{option "Red"}{option "Green"}{/listbox}`,
      Hall: 'Hall',
    }),
  });
  const passage = document.querySelector('.passage')!;
  expect(passage.textContent).toContain('Before CUSTOM after');
  expect(passage.querySelector('[title]')?.getAttribute('title')).toBe(
    'CUSTOM',
  );
  expect(passage.querySelector('a')?.textContent).toBe('CUSTOM');
  expect(
    Story.observe()
      .actions.filter((a) => a.type === 'cycle' || a.type === 'listbox')
      .map((a) => a.options),
  ).toEqual([
    ['Red', 'Green'],
    ['Red', 'Green'],
  ]);
  expect(Story.observe().errors).toEqual([]);
});

it('reports a companion-named macro without a text form (#689)', () => {
  defineMacro({
    name: 'option',
    render() {
      return 'DOM only';
    },
  });
  const result = interpolateText('{option}', {
    variables: {},
    temporary: {},
    locals: {},
    transient: {},
  });
  expect(result.text).toBe('');
  expect(result.errors).toHaveLength(1);
  expect(String(result.errors[0]!.error)).toContain('has no text form');
});
