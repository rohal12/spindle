// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyContextElement } from '../../src/story-context-passage';
import {
  observableErrors,
  observableText,
} from '../../src/observe/observable-text';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('a StoryContext that throws while rendering', () => {
  it('shows the error as text in the element and does not throw', async () => {
    await bootStory({
      html: storyHtml({
        StoryVariables: '$n = 0',
        StoryInit: `{do}
Story.defineMacro({
  name: 'boom',
  render() { throw new Error('exploded'); }
});
{/do}`,
        Start: 'Hello',
        StoryContext: 'Before {boom}',
      }),
    });
    const el = storyContextElement()!;
    expect(el).not.toBeNull();
    expect(observableText(el, undefined, el)).toContain(
      'StoryContext: exploded',
    );
    expect(observableErrors(el, undefined, el)).toHaveLength(1);
  });
});
