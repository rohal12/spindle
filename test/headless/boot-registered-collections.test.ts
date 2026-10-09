// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
window.Inventory = class Inventory extends Array {
  total() { return this.length; }
};
Story.registerClass('Inventory', Inventory);
window.Pouch = class Pouch extends Map {
  constructor(entries) { super(entries); this.owner = 'Ada'; }
  total() { return this.size; }
};
Story.registerClass('Pouch', Pouch);
window.Tags = class Tags extends Set {
  total() { return this.size; }
};
Story.registerClass('Tags', Tags);
Story.on('storyinit', function () {
  Story.set('pouch', new Pouch([['sword', 1]]));
});
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Registered collections" startnode="1" ifid="HEADLESS-REGISTERED-COLLECTIONS" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">Bag {print typeof $bag.total}</tw-passagedata>
      <tw-passagedata pid="2" name="Room" tags="">{do}$bag.push("rope"); $pouch.set("rope", 2); $tags.add("wet");{/do}Room</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInit" tags="">{do}$bag = new Inventory("sword", "torch"); $tags = new Tags(["dry"]);{/do}</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$bag = null
$pouch = null
$tags = null</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

type Counted = { total(): number };

// Separate file: Spindle's module state allows one story per module instance.
describe('registered Array, Map and Set subclasses (#391)', () => {
  it('keep their class through assignment, mutation, saves and history', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    const w = window as unknown as Record<string, new () => object>;
    const check = (bag: number, pouch: number, tags: number) => {
      const got = {
        bag: Story.get('bag') as Counted,
        pouch: Story.get('pouch') as Counted & { owner: string },
        tags: Story.get('tags') as Counted,
      };
      expect(got.bag).toBeInstanceOf(w.Inventory!);
      expect(got.pouch).toBeInstanceOf(w.Pouch!);
      expect(got.tags).toBeInstanceOf(w.Tags!);
      expect(got.pouch.owner).toBe('Ada');
      expect([got.bag.total(), got.pouch.total(), got.tags.total()]).toEqual([
        bag,
        pouch,
        tags,
      ]);
    };

    expect(document.getElementById('root')!.textContent).toContain(
      'Bag function',
    );
    check(2, 1, 1);

    await Story.save('start');
    await Story.load('start');
    await Story.waitForActions();
    check(2, 1, 1);

    Story.goto('Room');
    await Story.waitForActions();
    check(3, 2, 2);

    await Story.save('room');
    Story.back();
    await Story.waitForActions();
    check(2, 1, 1);

    await Story.load('room');
    await Story.waitForActions();
    check(3, 2, 2);
    Story.back();
    await Story.waitForActions();
    check(2, 1, 1);
  });
});
