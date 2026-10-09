// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
window.Engine = class Engine {
  constructor() { this.count = 0; }
  tick() { return ++this.count; }
};
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Transient defaults" startnode="1" ifid="HEADLESS-TRANSIENT-DEFAULTS" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">Engine {print typeof %engine.tick}</tw-passagedata>
      <tw-passagedata pid="2" name="Next" tags="">Next</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
      <tw-passagedata pid="4" name="StoryTransients" tags="">%engine = new Engine()</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

type Engine = { count: number; tick(): number };

// Separate file: Spindle's module state allows one story per module instance.
describe('an unregistered instance as a StoryTransients default (#398)', () => {
  it('stays an instance of its class at boot, restart and load', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    const EngineClass = (window as unknown as Record<string, new () => object>)
      .Engine!;
    const engine = () => {
      const value = Story.get('%engine') as Engine;
      expect(value).toBeInstanceOf(EngineClass);
      expect(typeof value.tick).toBe('function');
      return value;
    };

    expect(document.getElementById('root')!.textContent).toContain(
      'Engine function',
    );
    expect(engine().count).toBe(0);
    expect(engine().tick()).toBe(1);

    Story.goto('Next');
    await Story.waitForActions();
    await Story.save('slot');
    await Story.load('slot');
    await Story.waitForActions();
    engine();

    Story.restart();
    await Story.waitForActions();
    engine();
  });
});
