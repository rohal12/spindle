// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

it('observes CSS visibility and logical typewriter progress without layout (#767-#769)', async () => {
  const Story = await bootStory({
    html: storyHtml({
      StoryVariables: '$word = "AB"',
      Start:
        '<style>.closed { content-visibility:hidden }.shown { display:block }</style>' +
        'Visible.<div id="panel" class="closed">Secret {button "Choice"}{/button}<span class="error">Error</span></div>' +
        '<div hidden class="shown">Shown {button "Shown choice"}{/button}<span class="error">Shown error</span></div>' +
        '<div hidden="until-found">Find secret</div>',
      StoryContext:
        'Context<div style="content-visibility:hidden">Context secret</div>',
      Typed:
        'Before. {type 1s}AB {button "Go"}{/button}<span class="error">Oops</span><input value="secret">{/type}',
      Nested: '{type 1s}A{type 2s}BC{/type}D{/type}',
      Reactive: '{type 1s}{$word}{/type}',
    }),
  });
  await Story.waitForActions();
  let seen = Story.observe();
  expect(seen.context).toBe('Context');
  expect(seen.text).toContain('Shown');
  expect(seen.text).not.toContain('Secret');
  expect(seen.text).not.toContain('Find secret');
  expect(seen.actions.map((a) => a.label)).toEqual(['Shown choice']);
  expect(seen.errors).toEqual(['Shown error']);
  document.querySelector('#panel')!.classList.remove('closed');
  seen = Story.observe();
  expect(seen.text).toContain('Secret');
  expect(seen.actions.map((a) => a.label)).toContain('Choice');
  expect(seen.errors).toEqual(['Error', 'Shown error']);

  // Leave timeout/rAF scheduling real so waitForActions still settles renders.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await Story.waitForActions();
    return Story.observe();
  };
  try {
    await act(async () => {
      Story.goto('Typed');
    });
    await Story.waitForActions();
    expect(Story.observe().text).toBe('Before.');
    expect(Story.observe().actions).toEqual([]);
    expect(Story.observe().errors).toEqual([]);
    seen = await tick(2000);
    expect(seen.text).toBe('Before. AB');
    seen = await tick(2000);
    expect(seen.text).toBe('Before. AB G');
    expect(seen.actions).toEqual([]);
    seen = await tick(1000);
    expect(seen.actions.map((a) => a.label)).toEqual(['Go']);
    seen = await tick(1000);
    expect(seen.errors).toEqual(['O']);
    expect(seen.text).not.toContain('secret');
    seen = await tick(3000);
    expect(seen.text).toContain('AB GoOops[input: "secret"]');
    expect(seen.errors).toEqual(['Oops']);

    await act(async () => {
      Story.goto('Nested');
    });
    await Story.waitForActions();
    expect((await tick(2000)).text).toBe('AB');
    expect((await tick(1000)).text).toBe('AB');
    expect((await tick(1000)).text).toBe('ABCD');

    await act(async () => {
      Story.goto('Reactive');
    });
    await Story.waitForActions();
    expect((await tick(2000)).text).toBe('AB');
    await act(async () => {
      Story.set('word', 'ABCD');
    });
    await Story.waitForActions();
    expect(Story.observe().text).toBe('AB');
    expect((await tick(1000)).text).toBe('ABC');
    expect((await tick(1000)).text).toBe('ABCD');
  } finally {
    vi.useRealTimers();
  }
});
