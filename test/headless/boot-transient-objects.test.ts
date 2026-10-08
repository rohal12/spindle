// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('unregistered transient objects in mutation code', () => {
  it('keep their prototype (#321)', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$answer = 0',
        StoryTransients: '%engine = {}',
        Start: '{button "Use engine"}{set $answer = %engine.read()}{/button}',
      }),
    });
    class Engine {
      read() {
        return 42;
      }
    }
    const engine = new Engine();
    Story.set('%engine', engine);
    await Story.waitForActions();
    Story.performAction(
      Story.getActions().find((a) => a.label === 'Use engine')!.id,
    );
    await Story.waitForActions();
    expect(Story.get('answer')).toBe(42);
    expect(Story.get('%engine')).toBe(engine);
  });
});
