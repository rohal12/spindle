// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Random hooks" startnode="1" ifid="HEADLESS-SAVE-HOOKS-PRNG" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{set $roll = random()}Roll: {$roll}</tw-passagedata>
      <tw-passagedata pid="2" name="Other" tags="">Other passage.</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInit" tags="">{do}Story.prng.init('hooks', false){/do}</tw-passagedata>
      <tw-passagedata pid="4" name="StoryVariables" tags="">$roll = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save and load hooks drawing random numbers', () => {
  it('a load continues the random sequence the saved game continues with', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    const roll = Story.get('roll');
    expect(Story.prng.pull).toBe(1);

    const hookRolls: number[] = [];
    Story.on('beforesave', () => hookRolls.push(Story.random()));
    Story.on('aftersave', () => hookRolls.push(Story.random()));
    await Story.save('slot');
    expect(hookRolls).toHaveLength(2);
    // Continuing play after the save
    const continued = [Story.random(), Story.random()];

    Story.on('afterload', () => hookRolls.push(Story.random()));
    Story.goto('Other');
    await Story.waitForActions();
    await Story.load('slot');
    await Story.waitForActions();

    expect(hookRolls).toHaveLength(3);
    // The passage replayed its roll, and the game goes on as it did
    expect(Story.get('roll')).toBe(roll);
    expect([Story.random(), Story.random()]).toEqual(continued);
  });
});
