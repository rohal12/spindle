// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('does not execute or validate the source body of a replaced do macro (#644)', async () => {
  const html = storyHtml({
    StoryVariables: '$value = "initial"',
    StoryInit:
      '{do}$missing = 1; Story.defineMacro({name:"textbox",render(){}});{/do}',
    Start: '{textbox $value}',
  }).replace(
    '</tw-storydata>',
    '<script role="script" id="twine-user-script" type="text/twine-javascript">Story.defineMacro({name:"do",block:true,render(){return null;}});</script></tw-storydata>',
  );
  const Story = await bootStory({ html });
  await Story.waitForActions();
  expect(document.querySelector('input')?.value).toBe('initial');
  expect(Story.get('missing')).toBeUndefined();
  expect(document.querySelector('.error')).toBeNull();
});
