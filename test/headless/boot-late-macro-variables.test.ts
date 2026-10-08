// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('variable references in markup of a macro StoryInit defines', () => {
  it('are checked against the declarations (#325)', async () => {
    const error = await bootStory({
      html: storyHtml({
        StoryVariables: '$n = 0',
        StoryInit: `{do}
Story.defineMacro({
  name: 'label',
  interpolate: true,
  parameters: [{ name: 'text', type: 'string', holds: 'markup' }],
  render(props, ctx) { return ctx.resolve(ctx.args.text); }
});
{/do}`,
        Start: '{label "{$undeclared}"}',
      }),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('undeclared');
  });
});
