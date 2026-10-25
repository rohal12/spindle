// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory, storyVariables } from '../../src/headless';
import { storyHtml } from './story-html';

it('isolates automation values while retaining snapshot aliases and history (#658)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables:
        '$date = new Date("2020-01-01")\n$alias = null\n$bytes = new Uint8Array([1, 2])\n$view = null\n$box = null',
      StoryInit: `{do}
class Box { constructor() { this.date = new Date('2020-01-01'); } }
Story.registerClass('Box', Box);
Story.set('box', new Box());
$alias = $date;
$view = new Uint8Array($bytes.buffer);
{/do}`,
      Start: '{textbox $date}{textbox $alias} [[Next]]',
      Next: 'End',
    }),
  });
  const actions = Story.getActions().filter((a) => a.type === 'textbox');
  expect(actions[0]!.value).toBe(actions[1]!.value);
  (actions[0]!.value as Date).setUTCFullYear(1999);
  const snapshot = storyVariables();
  expect(snapshot.date).toBe(snapshot.alias);
  expect((snapshot.bytes as Uint8Array).buffer).toBe(
    (snapshot.view as Uint8Array).buffer,
  );
  (snapshot.date as Date).setUTCFullYear(1988);
  (snapshot.bytes as Uint8Array)[0] = 9;
  (snapshot.box as { date: Date }).date.setUTCFullYear(1977);
  const unchanged = () => {
    expect((Story.get('date') as Date).getUTCFullYear()).toBe(2020);
    expect((Story.get('box') as { date: Date }).date.getUTCFullYear()).toBe(
      2020,
    );
    expect(Array.from(Story.get('bytes') as Uint8Array)).toEqual([1, 2]);
  };
  unchanged();
  Story.goto('Next');
  await Story.waitForActions();
  Story.back();
  await Story.waitForActions();
  unchanged();
});
