// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { getWidget } from '../../src/widgets/widget-registry';

// Widget parameters are `@` locals (docs/widgets.md). A widget defined in a
// [widget]-tagged passage reads its parameters as the {widget} macro does in
// StoryInit: words starting with `$` or `_` are not parameters, so they take
// no argument.
const STORY_HTML = `<!doctype html>
<html>
  <body>
    <tw-storydata name="Widget Params" startnode="1" ifid="WIDGET-PARAMS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">[{Tagged "a" "b"}][{Init "a" "b"}]</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$label = ""</tw-passagedata>
      <tw-passagedata pid="3" name="StoryInit" tags="">{widget "Init" $label _note @value}{@value}{/widget}</tw-passagedata>
      <tw-passagedata pid="4" name="Widgets" tags="widget">{widget "Tagged" $label _note @value}{@value}{/widget}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

describe('bootStory with widget parameters', () => {
  it('takes only @ parameters, in widget passages as in StoryInit', async () => {
    await bootStory({ html: STORY_HTML });

    expect(getWidget('Init')?.params).toEqual(['@value']);
    expect(getWidget('Tagged')?.params).toEqual(['@value']);

    const passage = document.querySelector('.passage')!;
    expect(passage.textContent).toBe('[a][a]');
  });
});
