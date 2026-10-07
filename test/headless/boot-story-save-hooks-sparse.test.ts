// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Sparse hooks" startnode="1" ifid="HEADLESS-SAVE-HOOKS-SPARSE" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Start.</tw-passagedata>
      <tw-passagedata pid="2" name="Other" tags="">Other passage.</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$items = [1, 2, 3]
$grown = [1]
$filled = [1, , 3]</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks writing sparse arrays (#313)', () => {
  it('a load keeps the holes and elements the hooks made', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.on('beforesave', () => {
      const items = (Story.get('items') as unknown[]).slice();
      delete items[1];
      Story.set('items', items);
      const grown = (Story.get('grown') as unknown[]).slice();
      grown.length = 4;
      Story.set('grown', grown);
      const filled = (Story.get('filled') as unknown[]).slice();
      filled[1] = undefined;
      Story.set('filled', filled);
    });
    await Story.save('sparse');
    Story.goto('Other');
    await Story.waitForActions();
    await Story.load('sparse');
    await Story.waitForActions();

    const items = Story.get('items') as unknown[];
    expect(items.length).toBe(3);
    expect(1 in items).toBe(false);
    const grown = Story.get('grown') as unknown[];
    expect(grown.length).toBe(4);
    expect(3 in grown).toBe(false);
    const filled = Story.get('filled') as unknown[];
    expect(1 in filled).toBe(true);
    expect(filled[1]).toBeUndefined();
  });
});
