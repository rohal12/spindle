// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';

const SCRIPT = `
window.GameDate = class GameDate extends Date {
  day() { return this.getUTCDate(); }
};
Story.registerClass('GameDate', GameDate);
Story.on('storyinit', function () {
  Story.set('date', new GameDate('2026-01-02T00:00:00Z'));
});
`;

const STORY_HTML = `<!doctype html>
<html>
  <body>
    <div id="root"></div>
    <tw-storydata name="Registered dates" startnode="1" ifid="HEADLESS-REGISTERED-DATES" format="spindle" format-version="0.0.0">
      <script role="script" id="twine-user-script" type="text/twine-javascript">${SCRIPT}</script>
      <tw-passagedata pid="1" name="Start" tags="">Day {print $date.day()}</tw-passagedata>
      <tw-passagedata pid="2" name="Later" tags="">{do}$date.setUTCDate($date.day() + 1);{/do}Later</tw-passagedata>
      <tw-passagedata pid="3" name="StoryVariables" tags="">$date = null</tw-passagedata>
    </tw-storydata>
  </body>
</html>`;

type Dated = Date & { day(): number };

// Separate file: Spindle's module state allows one story per module instance.
describe('a registered Date subclass (#393)', () => {
  it('keeps its class and time through reads, mutation, saves and history', async () => {
    const Story = await bootStory({ html: STORY_HTML });
    Story.setTransition({ type: 'none' });
    await Story.waitForActions();
    const GameDate = (window as unknown as Record<string, new () => Date>)
      .GameDate!;
    const day = () => {
      const date = Story.get('date') as Dated;
      expect(date).toBeInstanceOf(GameDate);
      return date.day();
    };

    expect(document.getElementById('root')!.textContent).toContain('Day 2');
    expect(day()).toBe(2);

    await Story.save('start');
    await Story.load('start');
    await Story.waitForActions();
    expect(day()).toBe(2);

    Story.goto('Later');
    await Story.waitForActions();
    expect(day()).toBe(3);

    await Story.save('later');
    Story.back();
    await Story.waitForActions();
    expect(day()).toBe(2);

    await Story.load('later');
    await Story.waitForActions();
    expect(day()).toBe(3);
  });
});
