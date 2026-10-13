// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with an input macro StoryInit defines', () => {
  it('rejects it in StoryContext', async () => {
    const error = await bootStory({
      html: storyHtml({
        StoryVariables: '$n = 0',
        StoryInit: `{do}
Story.defineMacro({
  name: 'field',
  storeVar: true,
  parameters: [{ name: 'variable', type: 'variable', role: 'write' }],
  render() { return null; }
});
{/do}`,
        Start: 'Hello',
        StoryContext: '{field $n}',
      }),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(
      'StoryContext: {field} is not allowed; StoryContext is display-only',
    );
  });
});
