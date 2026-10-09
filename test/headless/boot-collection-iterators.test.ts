// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
window.Inventory = class Inventory extends Map {
  *[Symbol.iterator]() {
    for (const [key, value] of super.entries()) {
      if (value.available) yield [key, value];
    }
  }
};
Story.registerClass('Inventory', Inventory);
Story.on('storyinit', function () {
  Story.set('bag', new Inventory([
    ['sword', { available: true }],
    ['torch', { available: false }],
  ]));
});
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Collection iterators" startnode="1" ifid="HEADLESS-COLLECTION-ITERATORS" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">{button "Add potion"}{set $bag.set("potion", {available: true})}{/button}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$bag = null</tw-passagedata>
      <tw-passagedata pid="3" name="Next" tags="">Next</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('a registered Map subclass that overrides its iterator (#394)', () => {
  it('keeps the entries its iterator skips through mutations and saves', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();
    const keys = () => [
      ...Map.prototype.keys.call(Story.get('bag') as Map<string, unknown>),
    ];
    expect(keys()).toEqual(['sword', 'torch']);

    Story.performAction(
      Story.getActions().find((a) => a.label === 'Add potion')!.id,
    );
    await Story.waitForActions();
    expect(keys()).toEqual(['sword', 'torch', 'potion']);
    expect((Story.get('bag') as Map<string, unknown>).has('torch')).toBe(true);

    // A load restores the start of the passage saved in
    Story.goto('Next');
    await Story.waitForActions();
    await Story.save('slot');
    await Story.load('slot');
    await Story.waitForActions();
    expect(keys()).toEqual(['sword', 'torch', 'potion']);
  });
});
