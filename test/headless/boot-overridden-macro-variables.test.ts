// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { defineMacro } from '../../src/define-macro';
import { storyHtml } from './story-html';

it('validates other passages after StoryInit overrides markup parameters (#601)', async () => {
  defineMacro({
    name: 'caption',
    parameters: [{ name: 'value', type: 'string', holds: 'markup' }],
    render: (_props, ctx) => ctx.resolve!(ctx.args.value as string),
  });
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$other = 1',
      StoryInit: `{do}Story.defineMacro({ name: 'caption', parameters: [{ name: 'value', type: 'string' }], render(props, ctx) { return 'INIT:' + ctx.args.value; } });{/do}`,
      Start: '{caption "{$missing}"}',
    }),
  });
  await Story.waitForActions();
  expect(document.querySelector('.passage')?.textContent).toContain(
    'INIT:{$missing}',
  );
  expect(document.querySelector('.error')).toBeNull();
});
