// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Computed" startnode="1" ifid="HEADLESS-COMPUTED-UNDEFINED" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{computed $result = $source.missing}
Result: {$result}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$source = {}
$result = 99</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

// Separate file: Spindle's module state allows one story per module instance.
describe('bootStory with a computed that starts out undefined', () => {
  it('applies the undefined first result over the default (#234)', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    expect(Story.get('result')).toBeUndefined();
    const text = document.getElementById('root')!.textContent;
    expect(text).toContain('Result:');
    expect(text).not.toContain('99');
  });
});
