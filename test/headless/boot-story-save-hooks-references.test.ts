// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Hook references" startnode="1" ifid="HEADLESS-SAVE-HOOKS-REFS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Start.</tw-passagedata>
      <tw-passagedata pid="2" name="Other" tags="">Other passage.</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$a = { n: 0 }
$b = { n: 0 }
$c = { n: 1 }
$d = { n: 1 }</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks making references (#302)', () => {
  it('a load keeps what the hooks made one object one object', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();

    Story.on('beforesave', () => {
      const shared = { n: 5 };
      Story.set({ a: shared, b: shared });
      // Equal content, another object: only the reference changes
      Story.set('d', Story.get('c'));
    });
    await Story.save('slot');
    expect(Story.get('a')).toBe(Story.get('b'));

    Story.goto('Other');
    await Story.waitForActions();
    await Story.load('slot');
    await Story.waitForActions();

    expect(Story.get('a')).toBe(Story.get('b'));
    Story.set('a.n', 9);
    expect(Story.get('b.n')).toBe(9);
    expect(Story.get('c')).toBe(Story.get('d'));
    Story.set('c.n', 3);
    expect(Story.get('d.n')).toBe(3);
  });
});
