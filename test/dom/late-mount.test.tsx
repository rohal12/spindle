// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import type { StoryData, Passage as PassageData } from '../../src/parser';

import '../../src/components/macros/PassageDisplay';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function start(passages: PassageData[], vars: Record<string, unknown>) {
  const data: StoryData = {
    name: 'Test',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
  useStoryStore.getState().init(data, vars);
  installStoryAPI();
}

const Story = () => window.Story;

describe('macros that mount in a passage that was left (#352)', () => {
  let container: HTMLElement;
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    document.body.removeChild(container);
    useStoryStore.getState().setTransition(null);
    errors.mockRestore();
  });

  function show(passages: PassageData[], vars: Record<string, unknown> = {}) {
    start(passages, { flag: false, ...vars });
    useStoryStore.getState().setTransition({ type: 'none' });
    act(() => {
      render(<>{renderNodes(parseMarkup('{passage}'))}</>, container);
    });
  }

  // The branch shows when $flag is set. Its code needs the temporary
  // variable the passage set when it began, which the destination does not have.
  const BRANCH =
    '{do}_lead = "a"{/do}{if $flag}{do}Story.set("late", true){/do}{do}_seen = _lead.length{/do}{/if}';

  it('does not run code when state set just before a navigation shows a branch', () => {
    show([makePassage(1, 'Start', BRANCH), makePassage(2, 'Other', 'Other')]);
    act(() => {
      Story().set({ flag: true });
      Story().goto('Other');
    });
    expect(container.querySelector('.passage')?.textContent).toBe('Other');
    expect(Story().get('late')).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not run code when a link sets state and goes on', () => {
    show([
      makePassage(
        1,
        'Start',
        BRANCH + '{link "Go" "Other"}{set $flag = true}{/link}',
      ),
      makePassage(2, 'Other', 'Other'),
    ]);
    act(() => (container.querySelector('a') as HTMLElement).click());
    expect(container.querySelector('.passage')?.textContent).toBe('Other');
    expect(Story().get('late')).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([
    ['{set}', '{set $late = true}'],
    ['{unset}', '{unset $other}'],
    ['{goto}', '{goto "Wrong"}'],
  ])('does not run %s that mounts after the navigation', (_, branch) => {
    show(
      [
        makePassage(1, 'Start', `{if $flag}${branch}{/if}`),
        makePassage(2, 'Other', 'Other'),
        makePassage(3, 'Wrong', 'Wrong'),
      ],
      { other: 1 },
    );
    act(() => {
      Story().set({ flag: true });
      Story().goto('Other');
    });
    expect(useStoryStore.getState().currentPassage).toBe('Other');
    expect(Story().get('late')).toBeUndefined();
    expect(Story().get('other')).toBe(1);
  });

  it('does not compute a {computed} that mounts after the navigation', () => {
    show([
      makePassage(
        1,
        'Start',
        '{do}_lead = {n: 1}{/do}{if $flag}{computed $late = _lead.n}{/if}',
      ),
      makePassage(2, 'Other', 'Other'),
    ]);
    act(() => {
      Story().set({ flag: true });
      Story().goto('Other');
    });
    expect(Story().get('late')).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not count an {include} that mounts after the navigation', () => {
    show([
      makePassage(1, 'Start', '{if $flag}{include "Part"}{/if}'),
      makePassage(2, 'Other', 'Other'),
      makePassage(3, 'Part', 'Part'),
    ]);
    act(() => {
      Story().set({ flag: true });
      Story().goto('Other');
    });
    expect(useStoryStore.getState().renderCounts?.Part).toBeUndefined();
  });

  it('still runs the macros of a passage that navigates while it renders', () => {
    show([
      makePassage(
        1,
        'Start',
        '{do}Story.goto("Other"){/do}{set $a = 1}{if $a === 1}{set $b = 2}{/if}',
      ),
      makePassage(2, 'Other', 'Other'),
    ]);
    expect(useStoryStore.getState().currentPassage).toBe('Other');
    expect(Story().get('a')).toBe(1);
    expect(Story().get('b')).toBe(2);
  });

  it('still runs the macros that mount while the passage is on display', () => {
    show([makePassage(1, 'Start', '{if $flag}{set $late = true}{/if}')]);
    act(() => Story().set({ flag: true }));
    expect(Story().get('late')).toBe(true);
  });
});
