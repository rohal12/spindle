// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('renders companion-named widgets in passages, attributes and labels (#642)', async () => {
  await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInit: '{widget "option"}OPTION CONTENT{/widget}',
      Start:
        'BEFORE {option} AFTER <span title="{option}">label</span> [[{option}->Hall]]',
      Hall: 'Hall',
    }),
  });
  const passage = document.querySelector('.passage')!;
  expect(passage.textContent).toContain('BEFORE OPTION CONTENT AFTER');
  expect(passage.querySelector('span[title]')?.getAttribute('title')).toBe(
    'OPTION CONTENT',
  );
  expect(passage.querySelector('a')?.textContent).toBe('OPTION CONTENT');
  expect(document.querySelector('.error')).toBeNull();
});
