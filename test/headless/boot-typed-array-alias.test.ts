// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('typed arrays assigned onto another variable’s buffer', () => {
  it('share the buffer after the commit (#324)', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$view1 = []\n$view2 = []',
        Start: `{button "Alias buffers"}{set $view2 = new Uint8Array($view1.buffer)}{/button}
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
    const shared = () =>
      (Story.get('view1') as Uint8Array).buffer ===
      (Story.get('view2') as Uint8Array).buffer;

    await run('Alias buffers');
    expect(shared()).toBe(true);
    await run('Slice buffer');
    expect([...(Story.get('view2') as Uint8Array)]).toEqual([4]);
    expect(shared()).toBe(true);
  });
});
