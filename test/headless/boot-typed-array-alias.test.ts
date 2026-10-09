// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('typed arrays assigned onto another variable’s buffer', () => {
  it('share the buffer after the commit (#324)', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$view1 = []\n$view2 = []\n$same = false',
        Start: `{button "Alias buffers"}{set $view2 = new Uint8Array($view1.buffer)}{/button}
{button "Compare"}{set $same = $view1.buffer === $view2.buffer}{/button}
{button "Slice buffer"}{set $view2 = new Uint8Array($view1.buffer, 1)}{/button}`,
      }),
    });
    await Story.waitForActions();
    Story.set({
      view1: new Uint8Array([3, 4]),
      view2: new Uint8Array([3, 4]),
    });
    await Story.waitForActions();
    const run = async (label: string) => {
      Story.performAction(
        Story.getActions().find((a) => a.label === label)!.id,
      );
      await Story.waitForActions();
    };
    // Story.get() hands out isolated copies (#429), so the store's own
    // buffers are compared by the story's code
    const shared = async () => {
      await run('Compare');
      return Story.get('same');
    };

    await run('Alias buffers');
    expect(await shared()).toBe(true);
    await run('Slice buffer');
    expect([...(Story.get('view2') as Uint8Array)]).toEqual([4]);
    expect(await shared()).toBe(true);
  });
});
