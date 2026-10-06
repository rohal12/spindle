// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { bootStory } from '../../src/headless';
import { getWidget } from '../../src/widgets/widget-registry';

// A widget passage declaring a parameter named __proto__ is refused, as
// the {widget} macro refuses it in passage text: no namespace holds a
// variable by that name (see src/utils/namespace.ts). The other widgets in
// the passage still register, and the story boots.
const STORY_HTML = `<!doctype html>
<html>
  <body>
    <tw-storydata name="Reserved Widget Param" startnode="1" ifid="RESERVED-WIDGET-PARAM" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">[{ok 1}]&lt;b title="{ok 2}"&gt;x&lt;/b&gt;{bad 3}&lt;i title="{bad 4}"&gt;y&lt;/i&gt;</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$gold = 0</tw-passagedata>
      <tw-passagedata pid="3" name="Widgets" tags="widget">{widget "bad" @__proto__}({@x}){/widget}
{widget "ok" @toString}&lt;{@toString}&gt;{/widget}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

describe('bootStory with a widget parameter named __proto__', () => {
  it('refuses that widget with an error and registers the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bootStory({ html: STORY_HTML });

    expect(getWidget('bad')).toBeUndefined();
    expect(getWidget('ok')?.params).toEqual(['@toString']);
    expect(
      error.mock.calls.some((args) =>
        /widget "bad".*"@__proto__" cannot be used as a variable name/.test(
          args.map(String).join(' '),
        ),
      ),
    ).toBe(true);

    const passage = document.querySelector('.passage')!;
    expect(passage.textContent).toContain('[<1>]');
    expect(passage.querySelector('b')!.getAttribute('title')).toBe('<2>');
    // Invoking the refused widget reports it, in text and in attributes
    expect(passage.querySelector('i')!.getAttribute('title')).toBe('');
    expect(passage.querySelectorAll('.error').length).toBe(2);
    error.mockRestore();
  });
});
