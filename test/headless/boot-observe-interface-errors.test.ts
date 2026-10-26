// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('observes interface errors once while filtering hidden errors and snapshots (#677)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '',
      StoryInterface:
        '<header>{print null.header}</header><aside>{print null.sidebar}</aside><div hidden>{print null.hidden}</div>{passage}',
      Start: '{print null.passage} [[Next]]',
      Next: 'Next',
      Popup: '{print null.dialog}',
      StoryContext: '{print null.context}',
    }),
  });
  Story.setTransition({ type: 'none' });
  await Story.waitForActions();
  const errors = () => Story.observe().errors;
  expect(errors()).toHaveLength(4);
  for (const name of ['header', 'sidebar', 'passage', 'context']) {
    expect(errors().filter((e) => e.includes(`'${name}'`))).toHaveLength(1);
  }
  const outside = document.createElement('div');
  outside.className = 'error';
  outside.textContent = 'Outside story root';
  document.body.append(outside);
  Story.openDialog('Popup');
  await Story.waitForActions();
  expect(errors()).toHaveLength(5);
  Story.closeDialog();
  await Story.waitForActions();
  await Story.step('link:Next');
  expect(errors()).toHaveLength(3);
  expect(errors().join(' ')).not.toMatch(/hidden|passage|dialog|Outside/);
});
