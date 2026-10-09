// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const NODE =
  '(() =&gt; { const node = { name: "Alice" }; node.self = node; return node; })()';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Cyclic defaults" startnode="1" ifid="HEADLESS-CYCLIC-DEFAULTS" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Name: {$node.name} {%link.name}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryVariables" tags="">$node = ${NODE}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryTransients" tags="">%link = ${NODE.replace('Alice', 'Bob')}</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

type Node = { name: string; self: Node };

// Separate file: Spindle's module state allows one story per module instance.
describe('a cyclic object as a declared default (#405)', () => {
  it('boots, keeping the backreference', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    expect(document.getElementById('root')!.textContent).toContain(
      'Name: Alice Bob',
    );
    const node = Story.get('node') as Node;
    expect(node.self).toBe(node);
    const link = Story.get('%link') as Node;
    expect(link.self).toBe(link);
  });
});
