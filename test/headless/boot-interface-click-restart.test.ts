// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Interface click" startnode="1" ifid="HEADLESS-INTERFACE-CLICK" format="spindle" format-version="0.0.0">
      <tw-passagedata pid="1" name="Start" tags="">Number: {$n}</tw-passagedata>
      <tw-passagedata pid="2" name="StoryInterface" tags="">{button "Schedule"}{timed 50ms}{set $n += 1}{/timed}{/button}{button "Restart now"}{do}Story.restart(){/do}{set $n = 2}{timed 50ms}{set $n += 100}{/timed}{/button}{link "Schedule and restart"}{timed 50ms}{set $n += 100}{/timed}{do}Story.restart(){/do}{set $n = 3}{/link}{passage}</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$n = 0</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  )!;

// Separate file: Spindle's module state allows one story per module instance.
describe('pending click bodies of StoryInterface (#401)', () => {
  it('are cancelled by a restart or a load', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    await Story.waitForActions();

    // Control: left alone, the body writes
    button('Schedule').click();
    await wait(100);
    expect(Story.get('n')).toBe(1);

    Story.restart();
    await Story.waitForActions();
    button('Schedule').click();
    Story.restart();
    await wait(100);
    expect(Story.get('n')).toBe(0);

    await Story.save('slot');
    button('Schedule').click();
    await Story.load('slot');
    await wait(100);
    expect(Story.get('n')).toBe(0);

    // Synchronous code finishes in order, but the old body's timers are
    // cancelled even when replacement happens during its own render.
    button('Restart now').click();
    expect(Story.get('n')).toBe(2);
    await wait(100);
    expect(Story.get('n')).toBe(2);

    document.querySelector<HTMLAnchorElement>('a.macro-link')!.click();
    expect(Story.get('n')).toBe(3);
    await wait(100);
    expect(Story.get('n')).toBe(3);

    // The controls work in the replacement game
    Story.restart();
    await Story.waitForActions();
    button('Schedule').click();
    await wait(100);
    expect(Story.get('n')).toBe(1);
  });
});
