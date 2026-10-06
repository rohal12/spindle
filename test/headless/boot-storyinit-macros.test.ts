// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

// Macros StoryInit defines (docs/custom-macros.md does it in a {do}) are
// known when the other passages are validated, block macros included.
const STORY_HTML = `<!doctype html>
<html>
  <body>
    <tw-storydata name="StoryInit Macros" startnode="1" ifid="STORYINIT-MACROS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">{alert}Careful!{/alert} {shout hi}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInit" tags="">{do}
Story.defineMacro({ name: "alert", block: true, render: (props, ctx) =&gt;
  ctx.h("div", { class: "alert" }, ctx.renderNodes(props.children || [])) });
Story.defineMacro({ name: "shout", render: (props, ctx) =&gt;
  ctx.h("b", null, props.rawArgs.toUpperCase()) });
{/do}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$gold = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

describe('bootStory with macros defined in StoryInit', () => {
  it('validates the other passages against them', async () => {
    await bootStory({ html: STORY_HTML });
    const passage = document.querySelector('.passage')!;
    expect(passage.querySelector('.alert')!.textContent).toBe('Careful!');
    expect(passage.querySelector('b')!.textContent).toBe('HI');
  });
});
