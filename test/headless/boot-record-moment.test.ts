// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { loadSession } from '../../src/saves/save-manager';
import { storyHtml } from './story-html';

const WARDROBE =
  '{button "Wardrobe"}{do}Story.openDialog("Wardrobe"){/do}{/button}';

// Separate file: Spindle's module state allows one story per module instance.
it('Story.recordMoment() keeps a change made in a dialog over the passage', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$worn = "none"\n$x = 0\n$hits = 0',
      Start: `{watch "$x > 0" run "$hits += 1" once}Worn: {$worn} ${WARDROBE} [[Next]] {forward}`,
      Next: `{set $x = 1}Hits: {$hits} ${WARDROBE}`,
      Wardrobe:
        '{button "Hat"}{do}$worn = "hat"; Story.recordMoment(){/do}{/button}' +
        '{button "Scarf"}{do}$worn = "scarf"; Story.recordMoment(){/do}{/button}',
    }),
  });
  const text = () => document.querySelector('.passage')?.textContent;
  const renders: string[] = [];
  Story.on('passagerender', (passage) => renders.push(passage));
  await Story.waitForActions();

  // The change is made over the passage, which stays as it is
  await Story.step('button:"Wardrobe"');
  await Story.step('button:"Hat"');
  expect(Story.isDialogOpen()).toBe(true);
  expect(Story.passage).toBe('Start');
  expect(renders).toEqual([]);
  expect(text()).toContain('Worn: hat');
  Story.closeDialog();
  await Story.waitForActions();

  // The session (a page refresh) and a save hold it
  expect(loadSession('TEST-STORY')!.history[0]!.variables).toMatchObject({
    worn: 'hat',
  });
  await Story.save('hat');
  Story.set('worn', 'gloves');
  await Story.load('hat');
  await Story.waitForActions();
  expect(Story.get('worn')).toBe('hat');
  expect(text()).toContain('Worn: hat');

  // A watcher the passage consumed as it rendered did its work in the
  // recorded state: a load does not bring it back to fire again
  await Story.step('link:Next');
  expect(Story.get('hits')).toBe(1);
  await Story.step('button:"Wardrobe"');
  await Story.step('button:"Scarf"');
  Story.closeDialog();
  await Story.save('scarf');
  await Story.load('scarf');
  await Story.waitForActions();
  expect(Story.get('worn')).toBe('scarf');
  expect(Story.get('hits')).toBe(1);
  expect(text()).toContain('Hits: 1');
  Story.set('x', 0);
  Story.set('x', 1);
  await Story.waitForActions();
  expect(Story.get('hits')).toBe(1);

  // Each moment has its own recorded state
  Story.back();
  await Story.waitForActions();
  expect(Story.get('worn')).toBe('hat');
  const forward = () =>
    Story.getActions().find((action) => action.id === 'forward:forward');
  expect(forward()).toMatchObject({ disabled: false });

  // Recording what is recorded already keeps the moments after this one
  await Story.step('button:"Wardrobe"');
  await Story.step('button:"Hat"');
  Story.closeDialog();
  await Story.waitForActions();
  expect(forward()).toMatchObject({ disabled: false });
  Story.forward();
  await Story.waitForActions();
  expect(Story.get('worn')).toBe('scarf');

  // A change recorded after going back is new play: {forward} has nowhere to go
  Story.back();
  await Story.waitForActions();
  const rendered = renders.length;
  await Story.step('button:"Wardrobe"');
  await Story.step('button:"Scarf"');
  Story.closeDialog();
  await Story.waitForActions();
  expect(renders.length).toBe(rendered);
  expect(Story.passage).toBe('Start');
  expect(Story.get('worn')).toBe('scarf');
  expect(forward()).toMatchObject({ disabled: true });
});
