// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
window.Inventory = class Inventory extends Array { label = 'initial'; };
Story.registerClass('Inventory', Inventory);
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Array fields" startnode="1" ifid="HEADLESS-SAVE-HOOKS-ARRAY-FIELDS" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">{$bag.label}</tw-passagedata>
      <tw-passagedata pid="2" name="Other" tags="">Other passage.</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInit" tags="">{do}$bag = new Inventory(1, 2); $bag.tag = 'extra';{/do}</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$bag = null</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks writing fields of an Array subclass (#490)', () => {
  it('a load keeps the fields the hooks wrote', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    expect(Story.get('bag.label')).toBe('initial');

    const off = Story.on('beforesave', () => {
      Story.set('bag.label', 'saved');
      Story.set('bag.added', 'new');
      Story.set('bag.tag', undefined);
    });
    await Story.save('metadata');
    off();
    expect(Story.get('bag.label')).toBe('saved');

    Story.goto('Other');
    await Story.waitForActions();
    await Story.load('metadata');
    await Story.waitForActions();

    expect(Story.get('bag.label')).toBe('saved');
    expect(Story.get('bag.added')).toBe('new');
    expect(Story.get('bag.tag')).toBeUndefined();
    const bag = Story.get('bag') as unknown[];
    expect([...bag]).toEqual([1, 2]);
  });
});
