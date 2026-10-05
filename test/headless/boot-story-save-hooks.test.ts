// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Hooks" startnode="1" ifid="HEADLESS-SAVE-HOOKS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{set $visits = $visits + 1}Ext: {$ext}
[[Other]]</tw-passagedata>
      <tw-passagedata pid="2" name="Other" tags="">Elsewhere</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$ext = 0
$visits = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory save hooks', () => {
  it('a load restores the variables a beforesave handler wrote (#227)', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();
    expect(Story.get('visits')).toBe(1);

    Story.on('beforesave', () => Story.set('ext', 42));
    await Story.save('s');
    expect((await Story.exportSave('s'))!.save.payload.variables['ext']).toBe(
      42,
    );

    Story.set('ext', 0);
    // Leave the saved passage, so waitForActions() below waits for the
    // load to mount it again
    Story.goto('Other');
    await Story.waitForActions();
    await Story.load('s');
    expect(Story.get('ext')).toBe(42);
    await Story.waitForActions();
    // The passage ran once on top of its entry state, not on top of the
    // saved result
    expect(Story.get('visits')).toBe(1);
    expect(document.querySelector('.passage')!.textContent).toContain(
      'Ext: 42',
    );
  });
});
