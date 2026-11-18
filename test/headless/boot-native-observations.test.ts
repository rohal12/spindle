// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('reads live native fields and excludes SVG definitions in public observations (#742, #743)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      Start:
        '<svg><title>Title</title><desc>Description</desc><defs><text>Unused</text></defs><text>Visible</text></svg>\n<textarea>Original</textarea> <input value="Before"> <select><option>Red</option><option>Blue</option></select> {dialog "Open"}Popup{/dialog}',
      StoryContext:
        '<svg><title>Context title</title><defs><text>Context unused</text></defs><text>Context visible</text></svg>',
      Popup:
        '<svg><title>Dialog title</title><defs><text class="error">Dialog unused</text></defs><text>Dialog visible</text></svg>',
    }),
  });
  document.querySelector('textarea')!.value = 'Edited';
  (document.querySelector('.passage input') as HTMLInputElement).value =
    'After';
  document.querySelector('select')!.value = 'Blue';
  const observation = Story.observe();
  expect(observation.text).toContain('Visible');
  expect(observation.text).toContain('[textarea: "Edited"]');
  expect(observation.text).toContain('[input: "After"]');
  expect(observation.text).toContain('[select: "Blue"]');
  expect(observation.text).not.toMatch(/Title|Description|Unused|Original|Red/);
  expect(observation.context).toBe('Context visible');
  const opened = await Story.step('open-dialog:"Open"');
  expect(opened.dialogs).toEqual([
    { passage: 'Popup', text: 'Dialog visible' },
  ]);
  expect(opened.errors).toEqual([]);
});
