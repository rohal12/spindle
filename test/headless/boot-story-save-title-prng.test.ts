// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Random titles" startnode="1" ifid="HEADLESS-SAVE-TITLE-PRNG" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{set $n = randomInt(1, 1000)}Number: {$n}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{do}Story.prng.init('titles', false){/do}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
      <tw-passagedata pid="4" name="SaveTitle" tags="">return "Roll " + Story.randomInt(1, 1000);</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save titles drawing random numbers (#375)', () => {
  it('generating a title does not advance the random sequence', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    const pull = Story.prng.pull;

    await Story.save('slot');
    expect(Story.prng.pull).toBe(pull);
    // An overwrite generates the title again
    await Story.save('slot');
    expect(Story.prng.pull).toBe(pull);

    Story.saves.setTitleGenerator(() => 'Roll ' + Story.randomInt(1, 1000));
    await Story.save('other');
    expect(Story.prng.pull).toBe(pull);
  });

  it('a throwing generator does not advance it either', async () => {
    const Story = (globalThis as any).Story ?? (window as any).Story;
    const pull = Story.prng.pull;
    Story.saves.setTitleGenerator(() => {
      Story.randomInt(1, 1000);
      throw new Error('no title');
    });
    await Story.save('third');
    expect(Story.prng.pull).toBe(pull);
  });
});
