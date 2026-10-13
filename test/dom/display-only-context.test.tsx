// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { defineMacro } from '../../src/define-macro';
import { DisplayOnlyContext } from '../../src/display-only';
import '../../src/components/macros/Set';
import '../../src/components/macros/Button';
import type { Passage, StoryData } from '../../src/parser';

const start: Passage = {
  pid: 1,
  name: 'Start',
  tags: [],
  metadata: {},
  content: '',
};
const story: StoryData = {
  name: 'Test',
  startNode: 1,
  ifid: 'test',
  format: 'spindle',
  formatVersion: '0.1.0',
  passages: new Map([['Start', start]]),
  passagesById: new Map([[1, start]]),
  userCSS: '',
  userScript: '',
};

// A user macro that changes the story through each of ctx's writers
for (const [name, write] of [
  ['writemutate', (ctx: any) => ctx.mutate('$n = 9')],
  ['writeupdate', (ctx: any) => ctx.update('n', 9)],
  ['writevalue', (ctx: any) => ctx.setValue(9)],
] as const) {
  defineMacro(
    {
      name,
      storeVar: name === 'writevalue',
      render(_props, ctx) {
        try {
          write(ctx);
          return 'wrote';
        } catch (err) {
          return (err as Error).message;
        }
      },
    },
    'user',
  );
}

function renderDisplayOnly(markup: string): HTMLElement {
  const el = document.createElement('div');
  act(() => {
    render(
      <DisplayOnlyContext.Provider value={true}>
        {renderNodes(parseMarkup(markup))}
      </DisplayOnlyContext.Provider>,
      el,
    );
  });
  return el;
}

describe('DisplayOnlyContext', () => {
  beforeEach(() => {
    useStoryStore.getState().init(story, { n: 1 });
  });

  it('shows an acting macro as an error instead of running it', () => {
    const el = renderDisplayOnly('{Set $n = 2}');
    expect(useStoryStore.getState().variables.n).toBe(1);
    expect(el.querySelector('.error')?.textContent).toContain(
      'StoryContext is display-only: {set} cannot change the story',
    );
  });

  it.each(['writemutate', 'writeupdate', 'writevalue "$n"'])(
    "refuses a user macro's write ({%s})",
    (call) => {
      const el = renderDisplayOnly(`{${call}}`);
      expect(useStoryStore.getState().variables.n).toBe(1);
      expect(el.textContent).toContain('StoryContext is display-only');
    },
  );

  it("carries over into a button's body, which renders detached", () => {
    const el = renderDisplayOnly('{button "B"}{set $n = 2}{/button}');
    act(() => el.querySelector('button')!.click());
    expect(useStoryStore.getState().variables.n).toBe(1);
  });
});
