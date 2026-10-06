// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Nested hooks" startnode="1" ifid="HEADLESS-SAVE-HOOKS-NESTED" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{set $state.count = $state.count + 1}Count: {$state.count}</tw-passagedata>
      <tw-passagedata pid="2" name="Other" tags="">Other passage.</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$state = {count: 0, engine: 0}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks writing inside an object', () => {
  it('a load runs the passage on its entry state plus the hook writes (#232)', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    expect(Story.get('state')).toEqual({ count: 1, engine: 0 });

    Story.on('beforesave', () => Story.set('state.engine', 42));
    await Story.save('slot');
    // Leave the saved passage, so waitForActions() below waits for the
    // load to mount it again
    Story.goto('Other');
    await Story.waitForActions();
    await Story.load('slot');
    await Story.waitForActions();

    expect(Story.get('state')).toEqual({ count: 1, engine: 42 });
    expect(document.querySelector('.passage')!.textContent).toContain(
      'Count: 1',
    );
  });
});
